import { webViewConsentScript } from '../webview';
import { GRANTED, DENIED } from '../types';

describe('webViewConsentScript', () => {
  it('bundle\'ın beklediği globali yazar', () => {
    const script = webViewConsentScript(GRANTED, 'oturum-1');

    expect(script).toContain('window.__VERIBENIM_INITIAL_CONSENT__');
    expect(script.trim().endsWith('true;')).toBe(true);
  });

  it('üretilen script çalıştırılınca doğru nesneyi verir', () => {
    const script = webViewConsentScript(
      { strictly_necessary: true, functional: true, analytics: false, marketing: true },
      'oturum-1',
    );

    // Script'i gerçekten çalıştır — dize eşleştirmek yerine davranışı ölç.
    const sandbox: { __VERIBENIM_INITIAL_CONSENT__?: unknown } = {};
    new Function('window', script)(sandbox);

    expect(sandbox.__VERIBENIM_INITIAL_CONSENT__).toEqual({
      categories: { functional: true, analytics: false, marketing: true },
      sessionId: 'oturum-1',
    });
  });

  it('zorunlu kategori gönderilmez — bundle onu zaten açık sayar', () => {
    const sandbox: { __VERIBENIM_INITIAL_CONSENT__?: { categories: Record<string, boolean> } } = {};
    new Function('window', webViewConsentScript(DENIED))(sandbox);

    expect(sandbox.__VERIBENIM_INITIAL_CONSENT__!.categories).not.toHaveProperty('strictly_necessary');
  });

  /** U+2028 JSON'da geçerli ama JS kaynağında satır sonu — kaçırılmazsa script bölünür. */
  it('satır ayırıcı karakter script\'i bozmaz', () => {
    const script = webViewConsentScript(GRANTED, 'oturum kirik');

    const sandbox: { __VERIBENIM_INITIAL_CONSENT__?: { sessionId: string } } = {};
    expect(() => new Function('window', script)(sandbox)).not.toThrow();
    expect(sandbox.__VERIBENIM_INITIAL_CONSENT__!.sessionId).toBe('oturum kirik');
  });

  it('tırnak içeren oturum kimliği script\'i kırmaz', () => {
    const sandbox: { __VERIBENIM_INITIAL_CONSENT__?: { sessionId: string } } = {};
    const nasty = `o'tur"um\\`;

    expect(() => new Function('window', webViewConsentScript(GRANTED, nasty))(sandbox)).not.toThrow();
    expect(sandbox.__VERIBENIM_INITIAL_CONSENT__!.sessionId).toBe(nasty);
  });
});
