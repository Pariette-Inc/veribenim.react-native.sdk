import type { ConsentRecord, DeviceSession, QueuedConsent } from './types';

/** React Native (Metro) modül kapsamında sağlar; Node tiplerine bağımlı kalmamak için. */
declare const require: ((id: string) => unknown) | undefined;

/**
 * Kalıcı depo arayüzü.
 *
 * Arayüz olması test için değil DOĞRULUK için: Expo kullanan uygulama
 * `expo-secure-store`, bare RN `@react-native-async-storage/async-storage`
 * getirebilsin. SDK hiçbirini zorunlu bağımlılık yapmaz.
 */
export interface VeribenimStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY = {
  record: 'veribenim.consent.record',
  session: 'veribenim.consent.session',
  queue: 'veribenim.consent.queue',
} as const;

/** Uygulama ömrü boyunca bellekte tutar — test ve fallback için. */
export class MemoryStorage implements VeribenimStorage {
  private map = new Map<string, string>();

  async getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
}

/**
 * AsyncStorage'ı çalışma anında çözer.
 *
 * `require` ile çözmemizin sebebi: paket kurulu değilse import satırı
 * bundle'ı komple kırardı. Böyle olunca yoksa belleğe düşer ve uygulama
 * çalışmaya devam eder — rıza yalnızca o oturum boyunca hatırlanır ve
 * `debug` açıksa uyarı basılır.
 */
export function resolveDefaultStorage(debug = false): VeribenimStorage {
  // `typeof` bildirilmemiş bir isimde bile güvenlidir; bu yüzden ESM
  // çıktısında `require` olmasa da ReferenceError atmaz. eval KULLANILMIYOR:
  // Metro onu uyarıyla karşılıyor ve bazı ortamlar eval'i tamamen bloklar.
  if (typeof require === 'undefined') return new MemoryStorage();

  try {
    const mod = require('@react-native-async-storage/async-storage') as
      | { default?: VeribenimStorage }
      | VeribenimStorage;
    const AsyncStorage = (mod as { default?: VeribenimStorage })?.default ?? (mod as VeribenimStorage);

    if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
      return AsyncStorage;
    }
  } catch {
    // yutulur — aşağıdaki uyarı yeterli
  }

  if (debug) {
    console.warn(
      '[Veribenim] @react-native-async-storage/async-storage bulunamadı. ' +
        'Rıza yalnızca bu oturum boyunca hatırlanacak; uygulama kapanınca ' +
        'ziyaretçiye tekrar sorulur. Kalıcılık için paketi kurun veya ' +
        'kendi storage uygulamanızı geçin.',
    );
  }

  return new MemoryStorage();
}

/** JSON serileştirme + bozuk kayda karşı savunma. */
export class ConsentStore {
  constructor(private readonly storage: VeribenimStorage) {}

  private async read<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // Bozuk JSON kalıcı bir kilide dönüşmemeli: okunamayan kayıt yok sayılır,
      // ziyaretçiye yeniden sorulur. Sessizce çökmekten iyidir.
      return null;
    }
  }

  private async write(key: string, value: unknown): Promise<void> {
    try {
      await this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Disk dolu / izin yok. Karar bellekte yaşamaya devam eder.
    }
  }

  loadRecord = () => this.read<ConsentRecord>(KEY.record);
  saveRecord = (record: ConsentRecord) => this.write(KEY.record, record);
  clearRecord = () => this.storage.removeItem(KEY.record).catch(() => undefined);

  loadSession = () => this.read<DeviceSession>(KEY.session);
  saveSession = (session: DeviceSession) => this.write(KEY.session, session);
  clearSession = () => this.storage.removeItem(KEY.session).catch(() => undefined);

  async loadQueue(): Promise<QueuedConsent[]> {
    const queue = await this.read<QueuedConsent[]>(KEY.queue);
    return Array.isArray(queue) ? queue : [];
  }
  saveQueue = (queue: QueuedConsent[]) => this.write(KEY.queue, queue);
}
