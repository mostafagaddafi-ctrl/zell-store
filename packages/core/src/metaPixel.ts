/**
 * META-PIXEL (docs/contracts/META-PIXEL.md §٢-١) — قيمة Pixel ID من «المحتوى» (settings.hero.metaPixelId).
 *
 * القيمة نص دايمًا، عمرها ما تتحوّل لرقم. صالحة = أرقام من 10 لـ 20 بعد شيل المسافات من الأطراف.
 * فاضية أو غلط = '' = الـ Pixel مقفول. نفس القاعدة في اللوحة وقت الحفظ وفي المتجر وقت العرض.
 */
export const META_PIXEL_ID_PATTERN = /^[0-9]{10,20}$/

export function normalizeMetaPixelId(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  return META_PIXEL_ID_PATTERN.test(value) ? value : ''
}
