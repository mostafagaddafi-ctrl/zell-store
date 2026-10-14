'use server'

import 'server-only'
import { restRpc } from '../../lib/data/rpc'
import { TRACK_NOT_FOUND_MESSAGE, normalizeTrackCode, parseTrackedOrder, type TrackState } from '../../lib/orders/trackOrder'

/**
 * TRACK-ORDER W2 — Server Action لصفحة «تتبّع طلبك» (العقد docs/contracts/TRACK-ORDER.md §٣ و§٤).
 *
 * 🔒 النداء من السيرفر بس بمفتاح الخدمة (restRpc، زي الإيصال)، والمفتاح عمره ما يوصل للمتصفح.
 * 🔒 الكود جاي في body الفورم (POST)، مش في الرابط (لا query ولا path)، ومابيتكتبش في أي لوج.
 *
 *   • الكود بيتظبّط الأول (normalizeTrackCode). أي إدخال غلط = **مفيش نداء للداتابيز**.
 *   • رسالة واحدة لكل الحالات الغلط: شكل غلط · مش موجود · خطأ مؤقت · شكل رد مش متوقع.
 *   • المتصفح بياخد الحقول المعروفة بس (parseTrackedOrder)، من غير أي بيانات عميل.
 */
export async function trackOrderAction(_previous: TrackState, formData: FormData): Promise<TrackState> {
  const notFound: TrackState = { status: 'not_found', message: TRACK_NOT_FOUND_MESSAGE }

  const raw = formData.get('code')
  if (typeof raw !== 'string') return notFound
  const orderNumber = normalizeTrackCode(raw)
  if (orderNumber === null) return notFound

  try {
    const result = await restRpc<unknown>('zell_checkout_track_order', { p_order_number: orderNumber })
    if (!result.ok) {
      console.error('[track] lookup failed :: status ' + String(result.status))
      return notFound
    }
    // null = شكل غلط أو مش موجود (الدالة مابتفرّقش بينهم عن قصد).
    if (result.data === null) return notFound
    const order = parseTrackedOrder(result.data)
    if (order === null || order.orderNumber !== orderNumber) {
      console.error('[track] unexpected projection shape')
      return notFound
    }
    return { status: 'found', order }
  } catch (error) {
    console.error('[track] rpc threw :: ' + (error instanceof Error ? error.name : 'unknown'))
    return notFound
  }
}
