import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Veribenim } from './veribenim';
import type {
  ConsentCategory,
  ConsentPreferences,
  PreferencesResponse,
  VeribenimConfig,
} from './types';
import type { VeribenimStorage } from './storage';

interface ContextValue {
  veribenim: Veribenim;
  preferences: ConsentPreferences;
  needsConsent: boolean;
  ready: boolean;
  isAllowed: (category: ConsentCategory) => boolean;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  save: (prefs: Partial<ConsentPreferences>) => Promise<void>;
  withdraw: () => Promise<void>;
  fetchDisclosure: () => Promise<PreferencesResponse>;
}

const VeribenimContext = createContext<ContextValue | null>(null);

export interface VeribenimProviderProps {
  config: VeribenimConfig;
  storage?: VeribenimStorage;
  children: React.ReactNode;
}

/**
 * Uygulamayı sarar, açılışta diskteki kararı yükler.
 *
 * `ready` false olduğu sürece `needsConsent` de false döner — aksi hâlde
 * uygulama her açılışta, disk okunmadan önceki o birkaç milisaniyede rıza
 * ekranını yanıp söndürürdü.
 */
export function VeribenimProvider({ config, storage, children }: VeribenimProviderProps) {
  const veribenim = useMemo(() => new Veribenim(config, storage), []);
  const [preferences, setPreferences] = useState<ConsentPreferences>(veribenim.preferences);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = veribenim.onConsentChange((prefs) => {
      setPreferences(prefs);
      setTick((t) => t + 1);
    });

    veribenim.init().finally(() => setReady(true));

    return unsubscribe;
  }, [veribenim]);

  const value = useMemo<ContextValue>(
    () => ({
      veribenim,
      preferences,
      ready,
      // Disk okunmadan "rıza gerekiyor" demek ekranı yanıp söndürür.
      needsConsent: ready && veribenim.needsConsent(),
      isAllowed: (c) => veribenim.isAllowed(c),
      acceptAll: () => veribenim.acceptAll(),
      rejectAll: () => veribenim.rejectAll(),
      save: (p) => veribenim.save(p),
      withdraw: () => veribenim.withdraw(),
      fetchDisclosure: () => veribenim.fetchDisclosure(),
    }),
    [veribenim, preferences, ready, tick],
  );

  return <VeribenimContext.Provider value={value}>{children}</VeribenimContext.Provider>;
}

export function useVeribenim(): ContextValue {
  const ctx = useContext(VeribenimContext);
  if (!ctx) {
    throw new Error('useVeribenim, <VeribenimProvider> içinde çağrılmalıdır.');
  }
  return ctx;
}

/**
 * Tek kategori için kapı — ölçüm başlatan efektlerde kullanışlı.
 *
 * ```tsx
 * const analyticsAllowed = useConsent('analytics');
 * useEffect(() => { if (analyticsAllowed) analytics().setAnalyticsCollectionEnabled(true); },
 *   [analyticsAllowed]);
 * ```
 */
export function useConsent(category: ConsentCategory): boolean {
  return useVeribenim().isAllowed(category);
}

/**
 * Rıza değiştiğinde bir kez çalışan yan etki — Firebase/AppsFlyer köprüsü.
 *
 * `useEffect` yerine bunu kullanmak, ilk render'da da mevcut durumla
 * çağrılmayı garanti eder.
 */
export function useConsentEffect(handler: (prefs: ConsentPreferences) => void): void {
  const { veribenim } = useVeribenim();
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => veribenim.onConsentChange((p) => ref.current(p)), [veribenim]);
}

/** Google Consent Mode v2 eşlemesi — @react-native-firebase/analytics'e verilir. */
export function toConsentModeV2(prefs: ConsentPreferences) {
  return {
    analytics_storage: prefs.analytics ? 'granted' : 'denied',
    ad_storage: prefs.marketing ? 'granted' : 'denied',
    ad_user_data: prefs.marketing ? 'granted' : 'denied',
    ad_personalization: prefs.marketing ? 'granted' : 'denied',
  } as const;
}
