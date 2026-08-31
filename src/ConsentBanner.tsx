import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useVeribenim } from './react';
import type { ConsentCategory, ConsentCategoryInfo, ConsentPreferences } from './types';

export interface ConsentBannerProps {
  /** Ana renk. Konsoldaki banner ayarlarıyla eşleştirin. */
  accentColor?: string;
  /** Metinleri kendiniz vermek isterseniz. Verilmezse sunucudan gelen beyan kullanılır. */
  title?: string;
  message?: string;
  /** Ziyaretçi karar verdikten sonra çağrılır — ATT prompt'unu burada gösterin. */
  onDecided?: (prefs: ConsentPreferences) => void;
}

const OPTIONAL: ConsentCategory[] = ['functional', 'analytics', 'marketing'];

const FALLBACK_LABELS: Record<ConsentCategory, string> = {
  strictly_necessary: 'Zorunlu',
  functional: 'İşlevsel',
  analytics: 'Analitik',
  marketing: 'Pazarlama',
};

/**
 * Hazır rıza ekranı.
 *
 * Kendi tasarımınızı çizmek isterseniz bu bileşeni hiç kullanmayın —
 * `useVeribenim()` tüm kararları verir. Bu bileşen "hızlı başlangıç" içindir.
 *
 * KVKK Rehberi No:69 Bölüm 7.3 gereği "Reddet" butonu "Kabul Et" ile aynı
 * görsel ağırlıkta ve aynı ekranda durur; gizlenemez, ikinci adıma atılamaz.
 */
export function ConsentBanner({
  accentColor = '#059669',
  title,
  message,
  onDecided,
}: ConsentBannerProps) {
  const { needsConsent, ready, acceptAll, rejectAll, save, fetchDisclosure } = useVeribenim();

  const [categories, setCategories] = useState<ConsentCategoryInfo[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<ConsentCategory, boolean>>({
    strictly_necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    if (!needsConsent) return;

    // Beyan sunucudan gelir: kategori listesi ve metinler konsoldan yönetilir,
    // uygulamaya gömülmez. Ağ yoksa yerel yedek metinlerle devam edilir —
    // ziyaretçi rıza veremeden kilitli kalmamalı.
    fetchDisclosure()
      .then((res) => setCategories(res.categories ?? []))
      .catch(() => setCategories([]));
  }, [needsConsent, fetchDisclosure]);

  if (!ready || !needsConsent) return null;

  const run = async (fn: () => Promise<void>, prefs: ConsentPreferences) => {
    setBusy(true);
    try {
      await fn();
      onDecided?.(prefs);
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (id: ConsentCategory) =>
    categories.find((c) => c.id === id)?.label ?? FALLBACK_LABELS[id];

  const visibleOptional = OPTIONAL.filter(
    (id) => categories.length === 0 || categories.some((c) => c.id === id),
  );

  return (
    <Modal transparent animationType="slide" visible onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title ?? 'Gizlilik Tercihleriniz'}</Text>

          <Text style={styles.message}>
            {message ??
              'Uygulamayı geliştirmek ve size uygun içerik sunmak için cihazınızda ' +
                'tanımlayıcılar kullanıyoruz. Zorunlu olanlar dışındakiler yalnızca ' +
                'izninizle çalışır.'}
          </Text>

          {detailsOpen && (
            <ScrollView style={styles.details}>
              {visibleOptional.map((id) => (
                <View key={id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{labelFor(id)}</Text>
                    {categories
                      .find((c) => c.id === id)
                      ?.cookies.slice(0, 3)
                      .map((t) => (
                        <Text key={t.id} style={styles.rowSub}>
                          {t.name}
                          {t.storage_type ? ` · ${t.storage_type}` : ''}
                        </Text>
                      ))}
                  </View>
                  <Switch
                    value={draft[id]}
                    onValueChange={(v) => setDraft((d) => ({ ...d, [id]: v }))}
                    trackColor={{ true: accentColor, false: '#cbd5e1' }}
                  />
                </View>
              ))}

              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{labelFor('strictly_necessary')}</Text>
                  <Text style={styles.rowSub}>Uygulamanın çalışması için gerekli — kapatılamaz.</Text>
                </View>
                <Switch value disabled trackColor={{ true: '#94a3b8', false: '#cbd5e1' }} />
              </View>
            </ScrollView>
          )}

          {/* Kabul ve Reddet aynı ağırlıkta — KVKK Rehberi No:69 Bölüm 7.3. */}
          <View style={styles.actions}>
            <Pressable
              disabled={busy}
              style={[styles.button, styles.secondary]}
              onPress={() =>
                run(rejectAll, {
                  strictly_necessary: true,
                  functional: false,
                  analytics: false,
                  marketing: false,
                })
              }
            >
              <Text style={styles.secondaryText}>Reddet</Text>
            </Pressable>

            <Pressable
              disabled={busy}
              style={[styles.button, { backgroundColor: accentColor }]}
              onPress={() =>
                run(acceptAll, {
                  strictly_necessary: true,
                  functional: true,
                  analytics: true,
                  marketing: true,
                })
              }
            >
              <Text style={styles.primaryText}>Tümünü Kabul Et</Text>
            </Pressable>
          </View>

          {detailsOpen ? (
            <Pressable
              disabled={busy}
              style={styles.linkButton}
              onPress={() => run(() => save(draft), { ...draft, strictly_necessary: true })}
            >
              <Text style={[styles.link, { color: accentColor }]}>Seçimimi Kaydet</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.linkButton} onPress={() => setDetailsOpen(true)}>
              <Text style={[styles.link, { color: accentColor }]}>Tercihleri Yönet</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 32,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  message: { fontSize: 14, lineHeight: 21, color: '#475569' },
  details: { marginTop: 16, maxHeight: 260 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowText: { flex: 1, paddingRight: 16 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  rowSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  secondary: { backgroundColor: '#f1f5f9' },
  secondaryText: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  primaryText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  linkButton: { marginTop: 14, alignItems: 'center' },
  link: { fontSize: 13, fontWeight: '700' },
});
