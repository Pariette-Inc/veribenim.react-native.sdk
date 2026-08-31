# @veribenim/react-native

KVKK & GDPR rıza yönetimi — React Native (iOS & Android) uygulamaları için.

> Web SDK'ları (`@veribenim/core`, `@veribenim/react`) **mobilde çalışmaz.**
> Tarayıcı React'i `<div>` ve `<button>` çizer; React Native'de bu bileşenler
> yoktur. Daha önemlisi: React Native `fetch`'i `Origin` başlığı göndermez,
> web uçları bu başlığı zorunlu tutar — istekler 403 döner. Bu paket native
> kanalı (imzalı istek) kullanır.

Saf JavaScript — native modül yok, `pod install` yok, **Expo managed workflow
ile çalışır**.

## Kurulum

```bash
npm install @veribenim/react-native
# Rızanın uygulama kapandıktan sonra da hatırlanması için:
npm install @react-native-async-storage/async-storage
```

AsyncStorage kurulu değilse SDK belleğe düşer ve rıza yalnızca o oturum
boyunca hatırlanır — yani uygulama her açıldığında ziyaretçiye tekrar sorulur.

## Kurulum öncesi

Konsolda uygulamanızı **mobil site** olarak ekleyin ve package name / bundle
id'yi girin (`com.sirket.uygulama`). SDK'daki `appIdentifier` bununla birebir
aynı olmalı — el sıkışma bu eşleşmeye dayanır.

## Kullanım

```tsx
import { VeribenimProvider, ConsentBanner, useVeribenim } from '@veribenim/react-native';

export default function App() {
  return (
    <VeribenimProvider config={{ appIdentifier: 'com.sirket.uygulama', platform: 'android' }}>
      <RootNavigator />
      <ConsentBanner />
    </VeribenimProvider>
  );
}
```

`<ConsentBanner />` hazır bir alt sayfa çizer. Kendi tasarımınızı istiyorsanız
onu hiç kullanmayın — `useVeribenim()` tüm kararları verir:

```tsx
const { needsConsent, acceptAll, rejectAll, save, isAllowed } = useVeribenim();
```

## Ölçüm ve reklam kütüphanelerini bağlama

Rıza yalnızca **uygulandığında** anlamlıdır. Kütüphaneleri bu kapıdan geçirin:

```tsx
import analytics from '@react-native-firebase/analytics';
import { useConsentEffect, toConsentModeV2 } from '@veribenim/react-native';

useConsentEffect(async (prefs) => {
  await analytics().setConsent(toConsentModeV2(prefs));
  await analytics().setAnalyticsCollectionEnabled(prefs.analytics);
});
```

## iOS — ATT sırası

Apple, ATT prompt'undan önce kendi izin ekranınızı göstermenize izin verir ama
ATT'yi **atlamanıza** izin vermez. Doğru sıra: önce Veribenim rızası, sonra
pazarlama kabul edildiyse ATT.

```tsx
import { requestTrackingPermission } from 'react-native-tracking-transparency';

<ConsentBanner
  onDecided={async () => {
    if (veribenim.shouldRequestTracking) await requestTrackingPermission();
  }}
/>
```

Ters sıra App Store reddi sebebidir. SDK ATT'yi kendisi çağırmaz — hangi
kütüphaneyi kullanacağınız uygulamanın kararıdır.

## Tasarım notları

- **Önce diske, sonra ağa.** Ağ hatasında ziyaretçinin kararı kaybolmaz ve
  banner bir sonraki açılışta ikinci kez çıkmaz.
- **Offline kuyruk.** Gönderilemeyen rıza kaydı diskte bekler. Rıza ispatı
  (KVKK Md.3) veri sorumlusundadır — kaybolmamalı.
- **İmzalı istekler.** Her rıza kaydı HMAC-SHA256 ile imzalanır; imza gövdeyi
  ve zaman damgasını kapsar. Sunucu, iOS ve Android SDK'larıyla aynı algoritma
  — çapraz dil testi bunu sabitler.
- **`strictly_necessary` kapatılamaz.** Ne API'den ne arayüzden.
- **Sıfır bağımlılık.** SHA-256 dahil her şey pakette; `react-native-quick-crypto`
  gibi native bir bağımlılık Expo uyumluluğunu kırardı.

## Kardeş SDK'lar

| Platform | Paket |
|---|---|
| Web (React/Vue/Next/Nuxt) | `@veribenim/core` + framework paketleri |
| iOS native (Swift) | `Pariette-Inc/veribenim.swift.sdk` |
| Android native (Kotlin) | `Pariette-Inc/veribenim.kotlin.sdk` |

## Test

```bash
npm test
```
