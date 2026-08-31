import { VeribenimApiClient, isSessionUsable } from './client';
import { ConsentStore, resolveDefaultStorage, type VeribenimStorage } from './storage';
import {
  DENIED,
  GRANTED,
  normalizePreferences,
  type ConsentAction,
  type ConsentCategory,
  type ConsentPreferences,
  type ConsentRecord,
  type DeviceSession,
  type PreferencesResponse,
  type VeribenimConfig,
} from './types';

/** RFC 4122 gerektirmeyen, çakışma olasılığı ihmal edilebilir oturum kimliği. */
function sessionId(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

/**
 * Veribenim mobil rıza yöneticisi (React Native).
 *
 * iOS (`VeribenimKit`) ve Android (Kotlin) SDK'larıyla aynı sözleşme; burada
 * saf JS olmasının sebebi React Native'in ihtiyaç duyulan her şeyi zaten
 * JS'ten sunması: `fetch`, AsyncStorage ve `@react-native-firebase/analytics`
 * → `setConsent()`. Native modül eklemek, paketi Expo managed workflow'da
 * kullanılamaz hâle getirirdi.
 *
 * ```ts
 * const vb = new Veribenim({ appIdentifier: 'com.ornek.uygulama', platform: 'android' });
 * await vb.init();
 * if (vb.needsConsent()) { /* rıza ekranını göster *\/ }
 * await vb.acceptAll();
 * if (vb.isAllowed('analytics')) { /* ölçüm başlat *\/ }
 * ```
 */
export class Veribenim {
  private readonly api: VeribenimApiClient;
  private readonly store: ConsentStore;
  private readonly reconsentDays: number;

  private session: DeviceSession | null = null;
  private record: ConsentRecord | null = null;
  private latestVersion: string | null = null;
  private observers: Array<(prefs: ConsentPreferences) => void> = [];
  private ready = false;

  constructor(
    private readonly config: VeribenimConfig,
    storage?: VeribenimStorage,
  ) {
    this.api = new VeribenimApiClient(config);
    this.store = new ConsentStore(storage ?? resolveDefaultStorage(config.debug));
    this.reconsentDays = config.reconsentDays ?? 365;
  }

  /**
   * Diskteki kararı yükler ve bekleyen kuyruğu boşaltmayı dener.
   *
   * Uygulama açılışında BİR KEZ çağrılmalı ve beklenmelidir: öncesinde
   * `needsConsent()` her zaman true döner, çünkü henüz kayıt okunmamıştır.
   */
  async init(): Promise<void> {
    this.record = await this.store.loadRecord();
    this.session = await this.store.loadSession();
    this.ready = true;

    this.notify();
    // Ağ yoksa sessizce başarısız olur; kuyruk diskte bekler.
    void this.flush();
  }

  // ── Durum sorgulama ────────────────────────────────────────────────────────

  get preferences(): ConsentPreferences {
    return this.record?.preferences ?? DENIED;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Rıza gerekiyor mu? Üç sebepten biri: hiç karar yok, karar eskidi,
   * veya sunucudaki beyan sürümü değişti.
   */
  needsConsent(now: number = Date.now()): boolean {
    if (!this.record) return true;

    const ageDays = (now - this.record.decided_at) / 86_400_000;
    if (ageDays > this.reconsentDays) return true;

    if (
      this.latestVersion &&
      this.record.consent_version &&
      this.latestVersion !== this.record.consent_version
    ) {
      return true;
    }

    return false;
  }

  /** Ölçüm/reklam kütüphaneleri bu kapıdan geçmeli. */
  isAllowed(category: ConsentCategory): boolean {
    return this.preferences[category];
  }

  /**
   * iOS: ATT prompt'u şimdi gösterilmeli mi?
   *
   * Apple, ATT'den ÖNCE kendi izin ekranınızı göstermenize izin verir ama
   * ATT'yi atlamanıza izin vermez. Doğru sıra: önce Veribenim rızası, sonra
   * `marketing === true` ise ATT. SDK ATT'yi kendisi çağırmaz — hangi
   * kütüphaneyle çağıracağınız (ör. react-native-tracking-transparency)
   * uygulamanın kararı.
   */
  get shouldRequestTracking(): boolean {
    return this.config.platform === 'ios' && this.preferences.marketing;
  }

  /** Rıza değiştiğinde tetiklenir; abone olur olmaz mevcut durumla bir kez çağrılır. */
  onConsentChange(handler: (prefs: ConsentPreferences) => void): () => void {
    this.observers.push(handler);
    handler(this.preferences);

    return () => {
      this.observers = this.observers.filter((h) => h !== handler);
    };
  }

  private notify() {
    const prefs = this.preferences;
    this.observers.forEach((h) => h(prefs));
  }

  // ── Karar yazma ────────────────────────────────────────────────────────────

  acceptAll = () => this.decide(GRANTED, 'accept_all');
  rejectAll = () => this.decide(DENIED, 'reject_all');
  withdraw = () => this.decide(DENIED, 'withdraw');

  /** Kategori bazlı kaydetme — tercih merkezi ekranı bunu çağırır. */
  save = (prefs: Partial<ConsentPreferences>) =>
    this.decide(normalizePreferences(prefs), 'save_preferences');

  private async decide(prefs: ConsentPreferences, action: ConsentAction): Promise<void> {
    const id = this.record?.session_id ?? sessionId();
    const now = Date.now();

    const record: ConsentRecord = {
      preferences: prefs,
      action,
      decided_at: now,
      consent_version: this.latestVersion,
      session_id: id,
    };

    // Önce DİSKE, sonra ağa. Ters sırada, ağ hatasında ziyaretçinin kararı hiç
    // var olmamış gibi olur ve banner bir sonraki açılışta yeniden çıkardı.
    // Kullanıcı aynı soruyu iki kez cevaplamamalı.
    this.record = record;
    await this.store.saveRecord(record);
    this.notify();

    const queue = await this.store.loadQueue();
    queue.push({ action, preferences: prefs, session_id: id, occurred_at: now });
    await this.store.saveQueue(queue);

    await this.flush();
  }

  // ── Sunucu iletişimi ───────────────────────────────────────────────────────

  private async ensureSession(): Promise<DeviceSession> {
    if (isSessionUsable(this.session)) return this.session;

    const fresh = await this.api.handshake();
    this.session = fresh;
    await this.store.saveSession(fresh);
    return fresh;
  }

  /**
   * Sunucudaki beyanı çeker: kategoriler, metinler ve banner ayarları.
   * Rıza ekranını buradan gelen veriyle çizin — kategori listesi konsoldan
   * yönetilir, uygulamaya gömülmez.
   */
  async fetchDisclosure(): Promise<PreferencesResponse> {
    const session = await this.ensureSession();
    return this.api.preferences(session.environment_token, this.record?.session_id);
  }

  /**
   * Kuyruğu boşaltmayı dener. Ağ yoksa kayıtlar diskte kalır ve bir sonraki
   * açılışta yeniden denenir — rıza ispatı (KVKK Md.3) kaybolmaz.
   */
  async flush(): Promise<void> {
    const queue = await this.store.loadQueue();
    if (queue.length === 0) return;

    let session: DeviceSession;
    try {
      session = await this.ensureSession();
    } catch {
      return; // ağ yok / modül kapalı — kuyruk bekler
    }

    const remaining = [];

    for (const entry of queue) {
      try {
        await this.api.logConsent(session, entry);
      } catch (err) {
        // 403 → oturum düşmüş veya modül kapanmış. Yeniden el sıkışılsın diye
        // oturum atılır; kayıt kuyrukta kalır, hiçbir koşulda silinmez.
        if ((err as { status?: number })?.status === 403) {
          this.session = null;
          await this.store.clearSession();
        }
        remaining.push(entry);
      }
    }

    await this.store.saveQueue(remaining);
  }
}
