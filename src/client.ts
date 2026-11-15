import { hmacSha256 } from './hmac';
import type {
  DeviceSession,
  PreferencesResponse,
  QueuedConsent,
  VeribenimConfig,
} from './types';

/** Bugünkü üretim adresi; `VeribenimConfig.apiUrl` ile değiştirilebilir. */
export const DEFAULT_API_URL = 'https://live.veribenim.com';

/** Paket sürümü — `user_agent` alanına girer. package.json ile aynı tutun. */
export const SDK_VERSION = '1.0.0';

/** Sunucu `app_version` / `os_version` için `max:32` doğrular; uzunu el sıkışmayı 422'ye düşürür. */
const VERSION_MAX_LENGTH = 32;
const clip = (v?: string) => (v == null ? undefined : v.slice(0, VERSION_MAX_LENGTH));

/**
 * Dört mobil SDK'da aynı biçim: `VeribenimSDK/<sürüm> (<platform>[ <os>]; <dil>)`.
 * Sunucudaki `BotDetector` kalıplarından (`okhttp`, `axios/`, `node-fetch` …)
 * hiçbirini içermemeli — aksi hâlde her mobil rıza bot sayılır.
 */
export function defaultUserAgent(platform: string, osVersion?: string): string {
  const os = osVersion ? `${platform} ${osVersion}` : platform;
  return `VeribenimSDK/${SDK_VERSION} (${os}; react-native)`;
}

export class VeribenimError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'VeribenimError';
  }
}

/**
 * İstek imzalama başlıkları.
 *
 * Sunucu karşılığı: `AppDeviceSession::verifySignature`
 * (veribenim.api/app/Models/AppDeviceSession.php).
 *
 * İmzalanan dize: `"{deviceToken}.{timestamp}.{ham gövde}"`
 *   • timestamp → replay penceresi (sunucu ±5 dk kabul eder)
 *   • gövde     → imza başka bir gövdeye yapıştırılamasın diye
 *
 * DİKKAT: `body` burada gönderilecek dizenin TA KENDİSİ olmalı. Ayrı bir
 * `JSON.stringify` çağrısıyla yeniden üretilirse anahtar sırası değişebilir
 * ve imza tutmaz.
 */
export function signatureHeaders(
  session: DeviceSession,
  body: string,
  now: number = Date.now(),
): Record<string, string> {
  const ts = Math.floor(now / 1000);

  return {
    'X-VB-App': session.device_token,
    'X-VB-Timestamp': String(ts),
    'X-VB-Signature': hmacSha256(session.secret, `${session.device_token}.${ts}.${body}`),
  };
}

/**
 * Veribenim API istemcisi.
 *
 * Uçlar `veribenim.api/routes/api.php` ile birebir:
 *   POST /api/app/session          → el sıkışma (imzasız; imzalayacak sır henüz yok)
 *   GET  /api/preferences/{token}  → kategori beyanı (?platform=mobile)
 *   POST /api/v/{token}/c          → rıza kaydı (imzalı)
 */
export class VeribenimApiClient {
  private readonly baseUrl: string;

  constructor(private readonly config: VeribenimConfig) {
    this.baseUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  }

  private log(...args: unknown[]) {
    if (this.config.debug) console.log('[Veribenim]', ...args);
  }

  async handshake(): Promise<DeviceSession> {
    const body = JSON.stringify({
      app_identifier: this.config.appIdentifier,
      platform: this.config.platform,
      app_version: clip(this.config.appVersion),
      os_version: clip(this.config.osVersion),
    });

    const res = await fetch(`${this.baseUrl}/api/app/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });

    // 404 = uygulama bulunamadı VEYA mobil rıza modülü kapalı. Sunucu bu ikisini
    // bilerek ayırmıyor (numaralandırma kanalı); SDK da ayırt etmeye çalışmaz.
    if (!res.ok) {
      this.log('el sıkışma başarısız', res.status);
      throw new VeribenimError('El sıkışma başarısız', res.status);
    }

    const json = (await res.json()) as {
      token: string;
      device_token: string;
      secret: string;
      expires_at: string;
    };

    const expires = Date.parse(json.expires_at);

    return {
      environment_token: json.token,
      device_token: json.device_token,
      secret: json.secret,
      expires_at: Number.isNaN(expires) ? Date.now() + 30 * 86_400_000 : expires,
    };
  }

  async preferences(token: string, sessionId?: string | null): Promise<PreferencesResponse> {
    const query = new URLSearchParams({ platform: 'mobile' });
    if (sessionId) query.set('session_id', sessionId);

    const res = await fetch(`${this.baseUrl}/api/preferences/${token}?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) throw new VeribenimError('Beyan alınamadı', res.status);

    return (await res.json()) as PreferencesResponse;
  }

  async logConsent(session: DeviceSession, entry: QueuedConsent): Promise<void> {
    // Alanlar `ConsentController::log` doğrulamasıyla birebir. `platform`
    // GÖNDERİLMEZ: sunucu damgayı imzalı cihaz oturumundan okur.
    // `user_agent` şart: sunucu boş değeri bot sayar (BotDetector: empty_ua).
    const body = JSON.stringify({
      action: entry.action,
      consents: entry.preferences,
      session_id: entry.session_id,
      user_agent: this.config.userAgent ?? defaultUserAgent(this.config.platform, this.config.osVersion),
    });

    const res = await fetch(`${this.baseUrl}/api/v/${session.environment_token}/c`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...signatureHeaders(session, body),
      },
      body,
    });

    // Sınıflandırma çağıranda (`Veribenim.flush`): 403/404 yeniden el
    // sıkışma, 400/422 kalıcı ret, geri kalanı yeniden denenir.
    if (!res.ok) throw new VeribenimError('Rıza kaydedilemedi', res.status);
  }
}

/** Cihaz oturumu hâlâ kullanılabilir mi? Sınırda yenilemek için 1 saat pay bırakılır. */
export function isSessionUsable(session: DeviceSession | null, now = Date.now()): session is DeviceSession {
  return !!session && session.expires_at - now > 3_600_000;
}
