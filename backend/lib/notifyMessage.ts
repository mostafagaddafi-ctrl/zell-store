/**
 * نص إشعار الطلب — TypeScript صافي بدون أي اعتماد على المنصّة.
 * نفس النص بيتبعت على تليجرام (بعد النقل لـ Vercel) أو على الإيميل (داخل Retool).
 */
import { formatLength, formatPiastres } from './pricing'

export type OrderNotificationItem = {
  product_name_ar: string
  length_cm: number
  width_cm: number
  unit_price_piastres: number
  line_total_piastres: number
}

export type OrderNotificationInput = {
  order_number: string
  items: OrderNotificationItem[]
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  notes?: string | null
}

export function buildOrderNotificationSubject(order: OrderNotificationInput, storeName: string): string {
  return `طلب جديد ${order.order_number} — ${storeName}`
}

/** نص عادي (مناسب لتليجرام وللإيميل). */
export function buildOrderNotificationText(order: OrderNotificationInput, storeName: string): string {
  const lines = [`🧾 طلب جديد — ${storeName}`, `رقم الطلب: ${order.order_number}`, '']

  for (const item of order.items) {
    lines.push(
      `• ${item.product_name_ar} — ${formatLength(item.length_cm)} × ${item.width_cm} سم` +
        ` = ${formatPiastres(item.line_total_piastres)}`,
    )
  }

  lines.push(
    '',
    `إجمالي الأصناف: ${formatPiastres(order.subtotal_piastres)}`,
    `الشحن: ${order.shipping_piastres === 0 ? 'مجاني' : formatPiastres(order.shipping_piastres)}`,
    `الإجمالي: ${formatPiastres(order.total_piastres)} (دفع عند الاستلام)`,
    '',
    `العميل: ${order.customer_name}`,
    `الموبايل: ${order.customer_phone}`,
    `المحافظة: ${order.governorate}`,
    `العنوان: ${order.address}`,
  )
  if (order.notes && order.notes.trim()) lines.push(`ملاحظات: ${order.notes.trim()}`)
  return lines.join('\n')
}

/** نسخة HTML للإيميل. */
export function buildOrderNotificationHtml(order: OrderNotificationInput, storeName: string): string {
  const itemsHtml = order.items
    .map(
      (item) =>
        `<li style="margin-bottom:6px">${escapeHtml(item.product_name_ar)} — ` +
        `${escapeHtml(formatLength(item.length_cm))} × ${item.width_cm} سم = ` +
        `<strong>${escapeHtml(formatPiastres(item.line_total_piastres))}</strong></li>`,
    )
    .join('')

  const rows: Array<[string, string]> = [
    ['رقم الطلب', order.order_number],
    ['إجمالي الأصناف', formatPiastres(order.subtotal_piastres)],
    ['الشحن', order.shipping_piastres === 0 ? 'مجاني' : formatPiastres(order.shipping_piastres)],
    ['الإجمالي', `${formatPiastres(order.total_piastres)} — دفع عند الاستلام`],
    ['العميل', order.customer_name],
    ['الموبايل', order.customer_phone],
    ['المحافظة', order.governorate],
    ['العنوان', order.address],
  ]
  if (order.notes && order.notes.trim()) rows.push(['ملاحظات', order.notes.trim()])

  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 12px;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join('')

  return `<div dir="rtl" style="font-family:system-ui,sans-serif">
  <h2 style="margin:0 0 12px">طلب جديد — ${escapeHtml(storeName)}</h2>
  <ul style="padding-inline-start:18px;font-size:14px">${itemsHtml}</ul>
  <table style="border-collapse:collapse;font-size:14px">${body}</table>
</div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
