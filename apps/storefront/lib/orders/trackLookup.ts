/**
 * TRACK-ORDER v2 W2-A — منطق Server Action «تتبّع طلبك» من غير أي I/O مباشر (العقد docs/contracts/TRACK-ORDER-v2.md §١٧-١).
 *
 * app/track/actions.ts بيوصّل النداءات الحقيقية (restRpc بمفتاح الخدمة · إعدادات المتجر)، والحالات بتشغّل نفس الدالة
 * بنداءات وهمية (suite track): الكود الغلط مابيناديش الداتابيز · الرد بيتنقّى قبل المتصفح · فشل واتساب مابيضيّعش الطلب.
 *
 *   • الكود بيتظبّط الأول (normalizeTrackCode). أي إدخال غلط = **مفيش نداء**.
 *   • رسالة واحدة لكل الحالات الغلط: شكل غلط · مش موجود · خطأ مؤقت · شكل رد مش متوقع.
 *   • إعداد واتساب بيتقري **بعد** ما يتلاقي طلب صالح بس. فشل القراية أو رقم غير صالح = الزرار بيستخبّى، والنتيجة تفضل.
 *   • اللوج: أسماء الأخطاء بس، من غير الكود ولا أي بيانات طلب.
 */

import { TRACK_NOT_FOUND_MESSAGE, normalizeTrackCode, parseTrackedOrder, type TrackState } from './trackOrder'
import { trackWhatsappHref } from './trackView'

export type TrackLookupResult = { ok: true; data: unknown } | { ok: false; status: number }

export type TrackLookupDeps = {
  lookup: (orderNumber: string) => Promise<TrackLookupResult>
  loadWhatsapp: () => Promise<{ number: string; message: string }>
  log: (line: string) => void
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

export async function runTrackLookup(raw: unknown, deps: TrackLookupDeps): Promise<TrackState> {
  const notFound: TrackState = { status: 'not_found', message: TRACK_NOT_FOUND_MESSAGE }
  if (typeof raw !== 'string') return notFound
  const orderNumber = normalizeTrackCode(raw)
  if (orderNumber === null) return notFound

  let result: TrackLookupResult
  try {
    result = await deps.lookup(orderNumber)
  } catch (error) {
    deps.log('[track] rpc threw :: ' + errorName(error))
    return notFound
  }
  if (!result.ok) {
    deps.log('[track] lookup failed :: status ' + String(result.status))
    return notFound
  }
  // null = شكل غلط أو مش موجود (الدالة مابتفرّقش بينهم عن قصد).
  if (result.data === null) return notFound
  const order = parseTrackedOrder(result.data)
  if (order === null || order.orderNumber !== orderNumber) {
    deps.log('[track] unexpected projection shape')
    return notFound
  }

  let whatsappHref: string | null = null
  try {
    const whatsapp = await deps.loadWhatsapp()
    whatsappHref = trackWhatsappHref(whatsapp.number, whatsapp.message, order.orderNumber)
  } catch (error) {
    deps.log('[track] whatsapp settings unavailable :: ' + errorName(error))
  }
  return { status: 'found', order, whatsappHref }
}
