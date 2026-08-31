import type { ConsentPreferences } from './types';

/**
 * Uygulama içi WebView'a enjekte edilecek script.
 *
 * NEDEN GEREKLİ: hibrit uygulamada ziyaretçi rızayı native ekranda verir,
 * sonra bir WebView açılır ve oradaki web bannerı aynı soruyu İKİNCİ KEZ
 * sorar. Bu script native kararı bundle'a tohumlar; bundle `lastInteraction`
 * işaretini görüp banner'ı hiç açmaz ve rızaya uyan scriptleri yükler.
 *
 * Bundle tarafındaki karşılığı: `applyInjectedConsent()`
 * (veribenim.api/resources/views/bundle/default.blade.php).
 *
 * KULLANIM — `injectedJavaScriptBeforeContentLoaded` ile verilmelidir:
 *
 * ```tsx
 * const { veribenim, preferences } = useVeribenim();
 *
 * <WebView
 *   source={{ uri: 'https://sirket.com/hesabim' }}
 *   injectedJavaScriptBeforeContentLoaded={webViewConsentScript(preferences)}
 * />
 * ```
 *
 * `injectedJavaScript` (sonra çalışan varyant) YETMEZ: bundle o noktada çoktan
 * başlamış ve banner'ı göstermiş olur.
 */
export function webViewConsentScript(
  preferences: ConsentPreferences,
  sessionId?: string | null,
): string {
  // JSON.stringify iki kez: bir kez veri için, bir kez de o dizeyi JS
  // kaynağına güvenle gömmek için. Elle tırnak kaçırmak, içinde ' geçen bir
  // sessionId'de script'i bozardı.
  const payload = JSON.stringify({
    categories: {
      functional: preferences.functional,
      analytics: preferences.analytics,
      marketing: preferences.marketing,
    },
    sessionId: sessionId ?? undefined,
  });

  // JSON'u JS kaynağına gömerken JSON.stringify tırnakları ve ters bölüyü
  // kaçırır ama U+2028/U+2029'u kaçırmaz — bunlar JSON'da geçerli, JavaScript
  // kaynağında ise satır sonu sayılır ve script'i ortadan bölerdi.
  const literal = JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  // Sondaki `true;` RN'in isteğidir: enjekte edilen script'in son ifadesi
  // iOS tarafında değerlendiriliyor, nesne dönmek uyarı üretir.
  return `window.__VERIBENIM_INITIAL_CONSENT__ = JSON.parse(${literal}); true;`;
}
