/**
 * Platformun otoritatif rıza kategorileri.
 *
 * Web SDK'sı (`@veribenim/core`), iOS (`VeribenimKit`), Android (Kotlin) ve
 * sunucu (`CookieProvider::SIGNAL_CATEGORIES`) ile birebir aynı dört anahtar.
 * Mobilde kategori isimleri değişmez — değişen, altındaki teknolojidir:
 * çerez yerine cihaz tanımlayıcısı.
 */
export type ConsentCategory =
  | 'strictly_necessary'
  | 'functional'
  | 'analytics'
  | 'marketing';

export const CONSENT_CATEGORIES: ConsentCategory[] = [
  'strictly_necessary',
  'functional',
  'analytics',
  'marketing',
];

/**
 * Kategori bazlı rıza durumu.
 *
 * `strictly_necessary` her zaman `true` — reddedilemez. Tip düzeyinde
 * `true` olarak sabitlemiyoruz çünkü sunucudan gelen JSON'u da bu tiple
 * okuyoruz; onun yerine `normalizePreferences` her girişte zorluyor.
 */
export interface ConsentPreferences {
  strictly_necessary: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

export const DENIED: ConsentPreferences = {
  strictly_necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
};

export const GRANTED: ConsentPreferences = {
  strictly_necessary: true,
  functional: true,
  analytics: true,
  marketing: true,
};

/** Zorunlu kategoriyi daima açık hâle getirir; eksik alanları kapalı sayar. */
export function normalizePreferences(input: Partial<ConsentPreferences> | null | undefined): ConsentPreferences {
  return {
    strictly_necessary: true,
    functional: !!input?.functional,
    analytics: !!input?.analytics,
    marketing: !!input?.marketing,
  };
}

export type ConsentAction = 'accept_all' | 'reject_all' | 'save_preferences' | 'withdraw';

/** Kaydedilmiş rıza — karar + ne zaman ve hangi beyan sürümüne verildiği. */
export interface ConsentRecord {
  preferences: ConsentPreferences;
  action: ConsentAction;
  decided_at: number;
  /** Sunucudaki beyan sürümü; değişirse rıza yeniden sorulur. */
  consent_version: string | null;
  session_id: string;
}

/** Ağ yokken diske yazılan rıza kaydı — rıza ispatı kaybolmamalı. */
export interface QueuedConsent {
  action: ConsentAction;
  preferences: ConsentPreferences;
  session_id: string;
  occurred_at: number;
}

/** Cihaz oturumu — sunucudaki `app_device_sessions` satırının istemci tarafı. */
export interface DeviceSession {
  environment_token: string;
  device_token: string;
  /** Paylaşılan sır. AsyncStorage'da yaşar, asla loglanmaz. */
  secret: string;
  expires_at: number;
}

/** GET /api/preferences/{token}?platform=mobile yanıtı. */
export interface PreferencesResponse {
  status: boolean;
  environment_name?: string;
  banner_settings?: Record<string, unknown>;
  active_regulations?: string[];
  categories: ConsentCategoryInfo[];
  current_consents: ConsentPreferences | null;
  platform?: string;
}

export interface ConsentCategoryInfo {
  id: ConsentCategory;
  label: string;
  label_en: string;
  required: boolean;
  cookies: TrackerInfo[];
}

export interface TrackerInfo {
  id: number;
  name: string;
  description?: string;
  mandatory?: boolean;
  is_enabled_by_default?: boolean;
  /** Mobilde 'device_id' / 'app_storage' — 'cookie' DEĞİL (KVKK Rehberi No:69). */
  storage_type?: string;
}

export interface VeribenimConfig {
  /** Bundle id (iOS) / package name (Android) — konsolda kayıtlı değerle aynı olmalı. */
  appIdentifier: string;
  platform: 'ios' | 'android';
  /** Varsayılan: https://live.veribenim.com */
  apiUrl?: string;
  /** Rıza kaç gün sonra yeniden sorulsun. Beyan sürümü değişirse zaten sorulur. */
  reconsentDays?: number;
  appVersion?: string;
  osVersion?: string;
  debug?: boolean;
}
