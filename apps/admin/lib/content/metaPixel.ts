import { META_PIXEL_ID_PATTERN } from '@zell/core'

/**
 * META-PIXEL — خانة «معرّف Meta Pixel» في «المحتوى» (docs/contracts/META-PIXEL.md §٢-١). منطق خالص.
 *
 * الحقل metaPixelId على كائن settings.hero. اللوحة لازم تقراه (readHero) وتكتبه دايمًا (validateHero)،
 * وإلا بيضيع مع أول حفظ. فاضي = الـ Pixel مقفول. القيمة نص دايمًا.
 */

export const META_PIXEL_TITLE = 'Meta Pixel'

export const META_PIXEL_LABEL = 'معرّف Meta Pixel'

export const META_PIXEL_HINT = 'من 10 إلى 20 رقمًا، أو اتركه فارغًا'

export const META_PIXEL_NOTE =
  'اترك الخانة فارغة لإيقاف Meta Pixel. قبل تعبئتها يجب تعديل نص سياسة الخصوصية، وإيقاف «Automatic advanced matching» في إعدادات Events Manager.'

export const META_PIXEL_INVALID = 'يجب أن يتكون معرّف Meta Pixel من 10 إلى 20 رقمًا فقط، أو أن يُترك فارغًا.'

/** التحقق في السيرفر (validateHero): الغايب أو الفاضي = ''، وأرقام 10–20 بعد شيل المسافات = القيمة، وأي حاجة تانية = رفض. */
export function checkMetaPixelId(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: '' }
  if (typeof raw !== 'string') return { ok: false, message: META_PIXEL_INVALID }
  const value = raw.trim()
  if (value === '') return { ok: true, value: '' }
  return META_PIXEL_ID_PATTERN.test(value) ? { ok: true, value } : { ok: false, message: META_PIXEL_INVALID }
}
