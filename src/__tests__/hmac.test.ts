import { hmacSha256, sha256, utf8 } from '../hmac';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('sha256', () => {
  // NIST bilinen cevaplar — implementasyonun kendisi doğru mu.
  it('boş girdi', () => {
    expect(hex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('abc', () => {
    expect(hex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  // 55 → 56 → 64 bayt: padding'in blok sınırına taştığı yer. Buradaki bir hata
  // kısa mesajlarda görünmez, uzun rıza gövdesinde sessizce yanlış imza üretir.
  it('padding blok sınırında', () => {
    expect(hex(sha256(utf8('a'.repeat(55))))).toBe(
      '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    );
    expect(hex(sha256(utf8('a'.repeat(56))))).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    );
    expect(hex(sha256(utf8('a'.repeat(64))))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    );
  });
});

describe('utf8', () => {
  it('Türkçe karakterleri doğru kodlar', () => {
    // "ç" = U+00E7 → 0xC3 0xA7
    expect(Array.from(utf8('ç'))).toEqual([0xc3, 0xa7]);
    // "ğ" = U+011F → 0xC4 0x9F
    expect(Array.from(utf8('ğ'))).toEqual([0xc4, 0x9f]);
  });

  it('surrogate çiftini tek kod noktası olarak kodlar', () => {
    // 🍪 U+1F36A → F0 9F 8D AA
    expect(Array.from(utf8('🍪'))).toEqual([0xf0, 0x9f, 0x8d, 0xaa]);
  });
});

describe('hmacSha256', () => {
  // RFC 4231 Test Case 2 — HMAC'in kendisi doğru mu.
  it('RFC 4231 vektörü', () => {
    expect(hmacSha256('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  /**
   * ÇAPRAZ DİL SÖZLEŞMESİ — bu test kırılırsa native isteklerin tamamı 403 döner.
   *
   * Beklenen değer PHP'den alındı (uydurulmuş sabit değil):
   *   php -r 'echo hash_hmac("sha256",
   *     "dev-token.1700000000." . json_encode(["action"=>"accept_all"]), "s3cr3t");'
   *
   * Aynı değer VeribenimKit (Swift/CryptoKit) ve Kotlin (javax.crypto)
   * testlerinde de sabitlenmiştir.
   */
  it('sunucu, iOS ve Android ile aynı imzayı üretir', () => {
    expect(hmacSha256('s3cr3t', 'dev-token.1700000000.{"action":"accept_all"}')).toBe(
      '78ae089b104fd31c6509393ffd15e1b9c4875b43877de1a69bcf55399bbe9ff7',
    );
  });

  it('blok boyundan uzun anahtarı özetler', () => {
    const long = 'k'.repeat(100);
    expect(hmacSha256(long, 'x')).toHaveLength(64);
  });
});
