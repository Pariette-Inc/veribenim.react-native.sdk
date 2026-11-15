/**
 * API sözleşmesini sabitleyen testler — Swift `ContractTests.swift`, Kotlin
 * `ContractTest.kt` ve Flutter `contract_test.dart` ile aynı senaryolar.
 *
 * Kaynak: veribenim.api → `AppSessionController::issue`, `ConsentController::log`,
 * `PreferenceCenterController::show`, `EnvironmentOriginCheck::handleNativeRequest`
 * ve `tests/Feature/MobileConsentTest.php`.
 */
import { Veribenim } from '../veribenim';
import { MemoryStorage } from '../storage';
import { VeribenimApiClient, VeribenimError, SDK_VERSION } from '../client';
import { hmacSha256 } from '../hmac';
import type { VeribenimConfig } from '../types';

type Reply = { status: number; body: unknown };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** Sıralı yanıt veren, istekleri kaydeden sahte fetch. Yanıt yoksa ağ hatası. */
class Scripted {
  queue: Reply[];
  calls: Call[] = [];
  /** Doluysa ilk rıza isteği bu Promise çözülene dek bekletilir. */
  gate: Promise<void> | null = null;
  arrived!: Promise<void>;
  private markArrived!: () => void;

  constructor(...replies: Reply[]) {
    this.queue = replies;
    this.arrived = new Promise((r) => (this.markArrived = r));
  }

  get consentCalls() {
    return this.calls.filter((c) => c.url.endsWith('/c'));
  }
  get handshakeCalls() {
    return this.calls.filter((c) => c.url.endsWith('/api/app/session'));
  }

  install() {
    (globalThis as { fetch?: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
      this.calls.push({
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined,
      });
      if (url.endsWith('/c') && this.gate) {
        const g = this.gate;
        this.gate = null;
        this.markArrived();
        await g;
      }
      const next = this.queue.shift();
      if (!next) throw new TypeError('Network request failed');
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
      } as Response;
    };
    return this;
  }
}

const handshake = (token = 'env-token', device = 'dev-token', secret = 's3cr3t'): Reply => ({
  status: 200,
  body: { status: true, token, device_token: device, secret, expires_at: '2099-01-01T00:00:00+00:00' },
});
const OK: Reply = { status: 200, body: { status: true, message: 'Consent recorded', consent_renewal_required: false } };
const reply = (status: number, body: unknown = {}): Reply => ({ status, body });

/** Sunucudaki `BotDetector::BOT_PATTERNS` içinden UA'ya karışabilecekler. */
const BOT_PATTERNS = [
  'bot/', 'crawler', 'spider', 'scraper', 'fetcher', 'wget/', 'curl/', 'python-requests',
  'go-http-client', 'ruby', 'java/', 'apache-httpclient', 'okhttp', 'axios/', 'node-fetch',
  'got/', 'headlesschrome', 'whatsapp',
];

const baseConfig: VeribenimConfig = {
  appIdentifier: 'com.ornek.uygulama',
  platform: 'android',
  apiUrl: 'https://api.test',
  appVersion: '1.4.2',
  osVersion: '14',
};

async function make(net: Scripted, storage = new MemoryStorage(), config: Partial<VeribenimConfig> = {}) {
  net.install();
  const vb = new Veribenim({ ...baseConfig, ...config }, storage);
  await vb.init();
  return vb;
}

const json = (c: Call) => JSON.parse(c.body ?? '{}') as Record<string, unknown>;
const queueOf = async (s: MemoryStorage) => JSON.parse((await s.getItem('veribenim.consent.queue')) ?? '[]') as Array<{ action: string }>;

describe('el sıkışma', () => {
  it('istek biçimi', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net)).acceptAll();

    const c = net.handshakeCalls[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://api.test/api/app/session');
    expect(c.headers['Content-Type']).toBe('application/json');
    expect(c.headers.Accept).toBe('application/json');
    expect(c.headers['X-VB-App']).toBeUndefined();
    expect(json(c)).toEqual({
      app_identifier: 'com.ornek.uygulama',
      platform: 'android',
      app_version: '1.4.2',
      os_version: '14',
    });
  });

  it('boş sürüm alanları gönderilmez', async () => {
    const net = new Scripted(handshake()).install();
    await new VeribenimApiClient({ appIdentifier: 'a', platform: 'ios', apiUrl: 'https://api.test' }).handshake();
    expect(Object.keys(json(net.calls[0])).sort()).toEqual(['app_identifier', 'platform']);
  });

  it('uzun sürüm 32 karaktere kırpılır (sunucu max:32)', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net, undefined, { appVersion: '9'.repeat(60) })).acceptAll();
    expect((json(net.handshakeCalls[0]).app_version as string).length).toBe(32);
  });

  it('adresin sonundaki / çift bölü üretmez', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net, undefined, { apiUrl: 'https://api.test/' })).acceptAll();
    expect(net.calls.map((c) => c.url)).toEqual([
      'https://api.test/api/app/session',
      'https://api.test/api/v/env-token/c',
    ]);
  });

  it('oturum saklanır ve yeniden kullanılır', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted(handshake(), OK, OK);
    const vb = await make(net, storage);
    await vb.acceptAll();
    await vb.rejectAll();

    expect(net.handshakeCalls).toHaveLength(1);
    const saved = JSON.parse((await storage.getItem('veribenim.consent.session'))!);
    expect(saved).toMatchObject({ environment_token: 'env-token', device_token: 'dev-token', secret: 's3cr3t' });
    expect(new Date(saved.expires_at).getUTCFullYear()).toBe(2099);
  });

  it('oturum yeniden açılışta da kullanılır', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted(handshake(), OK, OK);
    await (await make(net, storage)).acceptAll();
    await (await make(net, storage)).rejectAll();
    expect(net.handshakeCalls).toHaveLength(1);
  });

  it('süresi dolmak üzere olan oturum yenilenir', async () => {
    const storage = new MemoryStorage();
    await storage.setItem('veribenim.consent.session', JSON.stringify({
      environment_token: 'old-env', device_token: 'old-dev', secret: 'x', expires_at: Date.now() + 600_000,
    }));
    const net = new Scripted(handshake(), OK);
    await (await make(net, storage)).acceptAll();

    expect(net.handshakeCalls).toHaveLength(1);
    expect(net.consentCalls[0].url).toBe('https://api.test/api/v/env-token/c');
  });

  it('el sıkışma 404 → karar kuyrukta bekler (bilinmeyen uygulama = modül kapalı)', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted(reply(404, { status: false }));
    const vb = await make(net, storage);
    await vb.acceptAll();

    expect(net.calls).toHaveLength(1);
    expect(await storage.getItem('veribenim.consent.session')).toBeNull();
    expect(await queueOf(storage)).toHaveLength(1);
    expect(vb.needsConsent()).toBe(false);
  });
});

describe('rıza kaydı', () => {
  it('gövde sözleşmeyle birebir', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net)).save({ functional: true, marketing: true });

    const c = net.consentCalls[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://api.test/api/v/env-token/c');
    expect(c.headers.Origin).toBeUndefined();

    const b = json(c);
    // `platform` gövdede olmamalı: sunucu damgayı imzalı oturumdan okur.
    expect(Object.keys(b).sort()).toEqual(['action', 'consents', 'session_id', 'user_agent']);
    expect(b.action).toBe('save_preferences');
    expect(b.consents).toEqual({ strictly_necessary: true, functional: true, analytics: false, marketing: true });
    expect(typeof b.session_id).toBe('string');
  });

  it('aksiyonlar sunucu enum değerlerine eşlenir, session_id sabit kalır', async () => {
    const net = new Scripted(handshake(), OK, OK, OK, OK);
    const vb = await make(net);
    await vb.acceptAll();
    await vb.save({ analytics: true });
    await vb.rejectAll();
    await vb.withdraw();

    const bodies = net.consentCalls.map(json);
    expect(bodies.map((b) => b.action)).toEqual(['accept_all', 'save_preferences', 'reject_all', 'withdraw']);
    expect(new Set(bodies.map((b) => b.session_id)).size).toBe(1);
  });

  it('user_agent gönderilir ve bot kalıbı içermez (sunucu boş UA\'yı bot sayar)', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net)).acceptAll();

    const ua = json(net.consentCalls[0]).user_agent as string;
    expect(ua).toBe(`VeribenimSDK/${SDK_VERSION} (android 14; react-native)`);
    for (const p of BOT_PATTERNS) expect(ua.toLowerCase()).not.toContain(p);
  });

  it('özel user_agent kullanılır', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net, undefined, { userAgent: 'Penyu/3.1 (iPhone)' })).acceptAll();
    expect(json(net.consentCalls[0]).user_agent).toBe('Penyu/3.1 (iPhone)');
  });

  it('imza gönderilen dizeyi ve saniye cinsinden zamanı kapsar', async () => {
    const net = new Scripted(handshake(), OK);
    await (await make(net)).acceptAll();

    const c = net.consentCalls[0];
    const ts = Number(c.headers['X-VB-Timestamp']);
    expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(5);
    expect(c.headers['X-VB-App']).toBe('dev-token');
    expect(c.headers['X-VB-Signature']).toBe(hmacSha256('s3cr3t', `dev-token.${ts}.${c.body}`));
  });
});

describe('hata durumları', () => {
  it('403 → bir kez yeniden el sıkışır ve aynı kaydı yeni oturumla dener', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted(
      handshake(),
      reply(403, { status: false, message: 'Unauthorized device' }),
      handshake('new-env', 'new-dev', 'new'),
      OK,
    );
    await (await make(net, storage)).acceptAll();

    expect(net.handshakeCalls).toHaveLength(2);
    expect(net.consentCalls).toHaveLength(2);
    expect(net.consentCalls[1].url).toBe('https://api.test/api/v/new-env/c');
    expect(net.consentCalls[1].headers['X-VB-App']).toBe('new-dev');
    expect(await queueOf(storage)).toHaveLength(0);
  });

  it('iki kez 403 → durur, oturum atılır, kayıt kalır', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted(handshake(), reply(403), handshake(), reply(403), OK);
    await (await make(net, storage)).acceptAll();

    expect(net.calls).toHaveLength(4);
    expect(await storage.getItem('veribenim.consent.session')).toBeNull();
    expect(await queueOf(storage)).toHaveLength(1);
  });

  it('402 kota → kuyruk ve sıra korunur', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted();
    const vb = await make(net, storage);
    await vb.acceptAll();
    await vb.withdraw();
    expect(await queueOf(storage)).toHaveLength(2);

    net.queue.push(handshake(), reply(402, { status: false, message: 'Impression quota exceeded' }));
    await vb.flush();

    expect(net.consentCalls).toHaveLength(1);
    expect((await queueOf(storage)).map((e) => e.action)).toEqual(['accept_all', 'withdraw']);
  });

  it('422 → yalnızca o kayıt atılır, sıradaki gider', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted();
    const vb = await make(net, storage);
    await vb.acceptAll();
    await vb.rejectAll();

    net.queue.push(handshake(), reply(422, { message: 'invalid' }), OK);
    await vb.flush();

    expect(net.consentCalls).toHaveLength(2);
    expect(await queueOf(storage)).toHaveLength(0);
  });

  it.each([429, 500, 503])('%i geçicidir: kuyruk ve oturum korunur', async (status) => {
    const storage = new MemoryStorage();
    await (await make(new Scripted(handshake(), reply(status)), storage)).acceptAll();
    expect(await queueOf(storage)).toHaveLength(1);
    expect(await storage.getItem('veribenim.consent.session')).not.toBeNull();
  });

  it('çevrimdışı kuyruk ağ dönünce sırayla gider', async () => {
    const storage = new MemoryStorage();
    const net = new Scripted();
    const vb = await make(net, storage);
    await vb.acceptAll();
    await vb.withdraw();

    net.queue.push(handshake(), OK, OK);
    await vb.flush();

    expect(net.consentCalls.map((c) => json(c).action)).toEqual(['accept_all', 'withdraw']);
    expect(await queueOf(storage)).toHaveLength(0);
  });

  it('boşaltma sürerken verilen karar kaybolmaz, iki kez gitmez', async () => {
    const storage = new MemoryStorage();
    let open!: () => void;
    const net = new Scripted(handshake(), OK, OK);
    net.gate = new Promise((r) => (open = r));
    const vb = await make(net, storage);

    const first = vb.acceptAll();
    await net.arrived;
    const second = vb.rejectAll();
    await new Promise((r) => setTimeout(r, 20));
    open();
    await Promise.all([first, second]);

    expect(net.consentCalls.map((c) => json(c).action)).toEqual(['accept_all', 'reject_all']);
    expect(await queueOf(storage)).toHaveLength(0);
  });
});

describe('tercih okuma', () => {
  it('istek biçimi', async () => {
    const net = new Scripted(handshake(), OK, { status: 200, body: { status: true, categories: [], current_consents: null } });
    const vb = await make(net);
    await vb.acceptAll();
    await vb.fetchDisclosure();

    const c = net.calls[net.calls.length - 1];
    const url = new URL(c.url);
    expect(c.method).toBe('GET');
    expect(url.pathname).toBe('/api/preferences/env-token');
    expect(url.searchParams.get('platform')).toBe('mobile');
    expect(url.searchParams.get('session_id')).toBe(json(net.consentCalls[0]).session_id);
    expect(c.headers['X-VB-Signature']).toBeUndefined();
  });

  it('hata yanıtı VeribenimError olarak yükselir', async () => {
    const vb = await make(new Scripted(handshake(), reply(404, { status: false })));
    await expect(vb.fetchDisclosure()).rejects.toMatchObject({ name: 'VeribenimError', status: 404 });
    expect(new VeribenimError('x', 1)).toBeInstanceOf(Error);
  });
});
