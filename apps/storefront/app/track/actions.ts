'use server'

import 'server-only'
import { restRpc } from '../../lib/data/rpc'
import { getStorefrontSettings } from '../../lib/data/source'
import { runTrackLookup, type TrackLookupResult } from '../../lib/orders/trackLookup'
import type { TrackState } from '../../lib/orders/trackOrder'

/**
 * TRACK-ORDER — Server Action لصفحة «تتبّع طلبك» (العقود docs/contracts/TRACK-ORDER.md §٣ و§٤ · TRACK-ORDER-v2.md §١٧-١).
 *
 * 🔒 النداء من السيرفر بس بمفتاح الخدمة (restRpc، زي الإيصال)، والمفتاح عمره ما يوصل للمتصفح.
 * 🔒 الكود جاي في body الفورم (POST)، مش في الرابط (لا query ولا path)، ومابيتكتبش في أي لوج.
 *
 * المنطق كله في lib/orders/trackLookup.ts (من غير I/O، والحالات بتشغّله بنداءات وهمية). هنا التوصيل بس:
 *   • lookup ← zell_checkout_track_order · loadWhatsapp ← إعدادات المتجر (رقم ورسالة واتساب) بعد ما الطلب يتلاقي.
 */
export async function trackOrderAction(_previous: TrackState, formData: FormData): Promise<TrackState> {
  return runTrackLookup(formData.get('code'), {
    lookup: async (orderNumber): Promise<TrackLookupResult> => {
      const result = await restRpc<unknown>('zell_checkout_track_order', { p_order_number: orderNumber })
      return result.ok ? { ok: true, data: result.data } : { ok: false, status: result.status }
    },
    loadWhatsapp: async () => {
      const settings = await getStorefrontSettings()
      return { number: settings.whatsappNumber, message: settings.whatsappMessage }
    },
    log: (line) => {
      console.error(line)
    },
  })
}
