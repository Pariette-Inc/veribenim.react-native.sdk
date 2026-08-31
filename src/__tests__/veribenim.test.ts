import { Veribenim } from '../veribenim';
import { MemoryStorage } from '../storage';
import { signatureHeaders } from '../client';
import { hmacSha256 } from '../hmac';
import type { DeviceSession } from '../types';

/** Sahte fetch — istekleri kaydeder, sıradaki yanıtı döner. */
class FakeFetch {
  responses: Array<{ status: number; body: unknown }> = [];
  calls: Array<{ url: string; init?: RequestInit }> = [];

  handler = async (url: string, init?: RequestInit) => {
    this.calls.push({ url, init });

    if (this.responses.length === 0) throw new Error('ağ yok');

    const next = this.responses.shift()!;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    } as Response;
  };

  install() {
    (globalThis as { fetch?: unknown }).fetch = this.handler;
  }
}

const HANDSHAKE = {
  status: true,
  token: 'env-token',
  device_token: 'dev-token',
  secret: 's3cr3t',
  expires_at: '2099-01-01T00:00:00+00:00',
};

const config = {
  appIdentifier: 'com.ornek.uygulama',
  platform: 'android' as const,
  apiUrl: 'https://api.test',
};

function make(net: FakeFetch, storage = new MemoryStorage()) {
  net.install();
  return { vb: new Veribenim(config, storage), storage };
}

describe('imzalama', () => {
  const session: DeviceSession = {
    environment_token: 'env-token',
    device_token: 'dev-token',
    secret: 's3cr3t',
    expires_at: Date.now() + 86_400_000,
  };

  it('üç başlığı da üretir', () => {
    const h = signatureHeaders(session, '{}', 1_700_000_000_000);
    expect(h['X-VB-App']).toBe('dev-token');
    expect(h['X-VB-Timestamp']).toBe('1700000000');
    expect(h['X-VB-Signature']).toBe(hmacSha256('s3cr3t', 'dev-token.1700000000.{}'));
  });

  it('gövde değişince imza değişir', () => {
    const now = 1_700_000_000_000;
    const a = signatureHeaders(session, '{"a":1}', now)['X-VB-Signature'];
    const b = signatureHeaders(session, '{"a":2}', now)['X-VB-Signature'];
    expect(a).not.toBe(b);
  });
});

describe('rıza akışı', () => {
  it('karar verilmeden önce rıza gerekir', async () => {
    const { vb } = make(new FakeFetch());
    await vb.init();
    expect(vb.needsConsent()).toBe(true);
  });

  it('kabul kalıcı olur ve kategorileri açar', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const { vb, storage } = make(net);
    await vb.init();

    await vb.acceptAll();

    expect(vb.needsConsent()).toBe(false);
    expect(vb.isAllowed('analytics')).toBe(true);
    expect(await storage.getItem('veribenim.consent.record')).toBeTruthy();
    expect(JSON.parse((await storage.getItem('veribenim.consent.queue'))!)).toEqual([]);
  });

  it('red yalnızca zorunluyu açık bırakır', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const { vb } = make(net);
    await vb.init();

    await vb.rejectAll();

    expect(vb.isAllowed('strictly_necessary')).toBe(true);
    expect(vb.isAllowed('analytics')).toBe(false);
    expect(vb.isAllowed('marketing')).toBe(false);
  });

  it('zorunlu kategori kapatılamaz', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const { vb } = make(net);
    await vb.init();

    await vb.save({ strictly_necessary: false, analytics: true } as never);

    expect(vb.isAllowed('strictly_necessary')).toBe(true);
    expect(vb.isAllowed('analytics')).toBe(true);
  });

  /** Ağ yokken karar KAYBOLMAMALI — rıza ispatı veri sorumlusundadır. */
  it('ağ hatası kararı düşürmez, kuyruğa alır', async () => {
    const { vb, storage } = make(new FakeFetch()); // hiç yanıt yok → her istek hata
    await vb.init();

    await vb.acceptAll();

    expect(vb.needsConsent()).toBe(false);
    const queue = JSON.parse((await storage.getItem('veribenim.consent.queue'))!);
    expect(queue).toHaveLength(1);
  });

  it('ağ dönünce kuyruk boşalır', async () => {
    const net = new FakeFetch();
    const { vb, storage } = make(net);
    await vb.init();

    await vb.acceptAll();
    expect(JSON.parse((await storage.getItem('veribenim.consent.queue'))!)).toHaveLength(1);

    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    await vb.flush();

    expect(JSON.parse((await storage.getItem('veribenim.consent.queue'))!)).toEqual([]);
  });

  /** 403 = oturum düştü veya modül kapandı. Oturum atılır, kayıt korunur. */
  it('403 oturumu atar ama rızayı silmez', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 403, body: {} },
    ];
    const { vb, storage } = make(net);
    await vb.init();

    await vb.acceptAll();

    expect(await storage.getItem('veribenim.consent.session')).toBeNull();
    expect(JSON.parse((await storage.getItem('veribenim.consent.queue'))!)).toHaveLength(1);
    expect(vb.needsConsent()).toBe(false);
  });

  it('rıza kaydı imzalı gider, el sıkışma imzasız', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const { vb } = make(net);
    await vb.init();

    await vb.acceptAll();

    const [handshake, consent] = net.calls;
    expect(handshake.url).toBe('https://api.test/api/app/session');
    expect((handshake.init?.headers as Record<string, string>)['X-VB-Signature']).toBeUndefined();

    expect(consent.url).toBe('https://api.test/api/v/env-token/c');
    const headers = consent.init?.headers as Record<string, string>;
    const body = consent.init?.body as string;
    expect(headers['X-VB-Signature']).toBe(
      hmacSha256('s3cr3t', `dev-token.${headers['X-VB-Timestamp']}.${body}`),
    );
  });

  it('beyanı mobil kapsamla ister', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: { status: true, categories: [], current_consents: null } },
    ];
    const { vb } = make(net);
    await vb.init();

    await vb.fetchDisclosure();

    expect(net.calls[1].url).toContain('/api/preferences/env-token?platform=mobile');
  });

  it('kayıt eskiyince rıza yeniden gerekir', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const storage = new MemoryStorage();
    net.install();
    const vb = new Veribenim({ ...config, reconsentDays: 30 }, storage);
    await vb.init();

    await vb.acceptAll();
    expect(vb.needsConsent()).toBe(false);

    const in40Days = Date.now() + 40 * 86_400_000;
    expect(vb.needsConsent(in40Days)).toBe(true);
  });

  it('uygulama yeniden açılınca karar diskten okunur', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const storage = new MemoryStorage();
    net.install();

    const first = new Veribenim(config, storage);
    await first.init();
    await first.acceptAll();

    // Aynı depo, yeni örnek — uygulamanın yeniden açılışı.
    const second = new Veribenim(config, storage);
    await second.init();

    expect(second.needsConsent()).toBe(false);
    expect(second.isAllowed('marketing')).toBe(true);
  });

  it('bozuk kayıt uygulamayı kilitlemez', async () => {
    const storage = new MemoryStorage();
    await storage.setItem('veribenim.consent.record', '{bozuk json');
    new FakeFetch().install();

    const vb = new Veribenim(config, storage);
    await vb.init();

    expect(vb.needsConsent()).toBe(true);
  });

  it('ATT yalnızca pazarlama rızasından ve iOS\'ta sorulur', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    net.install();

    const ios = new Veribenim({ ...config, platform: 'ios' }, new MemoryStorage());
    await ios.init();
    await ios.save({ analytics: true, marketing: false });
    expect(ios.shouldRequestTracking).toBe(false);

    net.responses = [{ status: 200, body: {} }];
    await ios.acceptAll();
    expect(ios.shouldRequestTracking).toBe(true);

    const android = new Veribenim(config, new MemoryStorage());
    await android.init();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    await android.acceptAll();
    expect(android.shouldRequestTracking).toBe(false);
  });

  it('abone mevcut durumla ve değişimde çağrılır', async () => {
    const net = new FakeFetch();
    net.responses = [
      { status: 200, body: HANDSHAKE },
      { status: 200, body: {} },
    ];
    const { vb } = make(net);
    await vb.init();

    const seen: boolean[] = [];
    const off = vb.onConsentChange((p) => seen.push(p.analytics));

    await vb.acceptAll();
    off();
    await vb.rejectAll();

    expect(seen).toEqual([false, true]);
  });
});
