/**
 * TRACK-ORDER v2 W2-A — بيانات تجربة مشتركة لحالات «تتبّع طلبك» (suite track). مش بتتستخدم في المتجر نفسه.
 * الشكل = رد zell_checkout_track_order (v2) زي backend/db/migrations/0021tr2_track_order_v2.sql بالظبط.
 */

import { parseTrackedOrder, type TrackedOrder } from './trackOrder'

export const meterItem = { product_name_ar: 'فيلم عازل', length_cm: 300, width_cm: 100, quantity: 1, sale_unit: 'meter', line_total_piastres: 156000 }
export const pieceItem = { product_name_ar: 'أداة تركيب', length_cm: null, width_cm: null, quantity: 2, sale_unit: 'piece', line_total_piastres: 30000 }

export const T0 = '2026-10-13T10:00:00+00:00'
export const T1 = '2026-10-13T12:00:00+00:00'
export const T2 = '2026-10-14T09:00:00+00:00'
export const T3 = '2026-10-15T15:00:00+00:00'
export const T4 = '2026-10-17T11:00:00+00:00'

/** مبالغ متسقة: المتبقي = الإجمالي − (المدفوع − المردود). */
export function money(over: Record<string, number> = {}): Record<string, number> {
  const base: Record<string, number> = {
    items_piastres: 186000,
    discount_piastres: 0,
    shipping_piastres: 5000,
    installation_piastres: 0,
    travel_piastres: 0,
    total_piastres: 191000,
    confirmation_fee_piastres: 0,
    paid_piastres: 0,
    refunded_piastres: 0,
    ...over,
  }
  const net = (base['paid_piastres'] ?? 0) - (base['refunded_piastres'] ?? 0)
  return { ...base, net_paid_piastres: net, remaining_piastres: Math.max((base['total_piastres'] ?? 0) - net, 0), ...over }
}

export function history(...entries: Array<[string, string]>): Array<{ status: string; at: string }> {
  return entries.map(([status, at]) => ({ status, at }))
}

export function sampleResponse(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_number: 'FLM-MRFVB3',
    status: 'confirmed',
    created_at: T0,
    total_piastres: 191000,
    items: [meterItem, pieceItem],
    delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' },
    customer: { name: 'عميل تجربة', phone: '01000000000', address: 'شارع التجربة ١٢', governorate: 'القاهرة', area: 'المعادي' },
    history: history(['new', T0], ['confirmed', T1]),
    money: money(),
    shipping: { method: 'standard', days_min: 2, days_max: 5 },
    confirmed_delivery: null,
    shipment: null,
    updates: [],
    ...over,
  }
}

/** طلب جاهز للعرض من نفس الحارس. بيرمي لو بيانات التجربة نفسها غلط (CI بيقع بوضوح). */
export function orderOf(over: Record<string, unknown> = {}): TrackedOrder {
  const order = parseTrackedOrder(sampleResponse(over))
  if (order === null) throw new Error('track fixture rejected by the guard: ' + JSON.stringify(Object.keys(over)))
  return order
}
