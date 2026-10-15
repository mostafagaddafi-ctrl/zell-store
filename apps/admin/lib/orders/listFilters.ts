/**
 * EXPRESS-SHIPPING §١٢ — علامة وفلتر نوع الشحن في قايمة الطلبات (docs/contracts/EXPRESS-SHIPPING.md §١٢). منطق خالص
 * (من غير server-only ولا أي استيراد قيمة برّه المجلد)، فحالات suite list-filters بتشغّله فعليًا.
 *
 *   • المصدر لقطة الطلب orders.shipping_method بس: 'express' = سريع · 'standard' = عادي · NULL (طلب قبل الميزة) أو أي قيمة
 *     تانية = من غير علامة، ومابيدخلش فلتر سريع ولا عادي (بيظهر في «الكل» بس). الإعداد الحالي مالوش دخل.
 *   • قيمة الرابط من قايمة ثابتة بالحرف؛ أي حاجة تانية (غايبة · فاضية · متكررة · غلط) = «الكل». جزء الاستعلام من قايمة ثابتة،
 *     والقيمة الخام من الرابط ماتدخلش الاستعلام أبدًا.
 *   • nextOrdersQuery = نفس قواعد فورم الفلاتر: تغيير أي فلتر بيشيل page ويحافظ على الباقي، والحالة والمتابعة زي ما هم
 *     (اختيار واحد بيشيل التاني)، ونوع الشحن مستقل عنهم.
 */

export type OrderShippingType = 'express' | 'standard'
export type ShippingTypeFilter = 'all' | OrderShippingType

export const SHIPPING_TYPE_FILTERS: readonly ShippingTypeFilter[] = ['all', 'express', 'standard']

/** النصوص رسمية، و«شحن عادي» و«شحن سريع» ثابتين (العقد §١٠ بند ٥). */
export const SHIPPING_TYPE_LABELS: Readonly<Record<OrderShippingType, string>> = {
  express: 'شحن سريع',
  standard: 'شحن عادي',
}

export const SHIPPING_TYPE_FILTER_LABELS: Readonly<Record<ShippingTypeFilter, string>> = {
  all: 'كل أنواع الشحن',
  express: SHIPPING_TYPE_LABELS.express,
  standard: SHIPPING_TYPE_LABELS.standard,
}

export const SHIPPING_TYPE_FILTER_ARIA = 'فلتر نوع الشحن'

/** علامة الطلب من اللقطة. NULL أو أي قيمة غير 'express' و'standard' بالحرف = null (من غير علامة). */
export function orderShippingType(raw: unknown): OrderShippingType | null {
  return raw === 'express' || raw === 'standard' ? raw : null
}

/** قيمة الرابط: نص واحد من القايمة الثابتة بالحرف، وإلا 'all' (ومنها المعامل المتكرر اللي بيوصل array). */
export function readShippingTypeFilter(raw: unknown): ShippingTypeFilter {
  if (typeof raw !== 'string') return 'all'
  return raw === 'express' || raw === 'standard' ? raw : 'all'
}

const QUERY_PARTS: Readonly<Record<OrderShippingType, string>> = {
  express: 'shipping_method=eq.express',
  standard: 'shipping_method=eq.standard',
}

/** جزء استعلام PostgREST من القايمة الثابتة بس. «الكل» = null (من غير شرط). */
export function shippingTypeQueryPart(filter: unknown): string | null {
  const value = readShippingTypeFilter(filter)
  return value === 'all' ? null : QUERY_PARTS[value]
}

/** قيمة نوع الشحن من رابط الصفحة الحالي (المعامل لازم يبقى مرة واحدة). */
export function shippingFilterFromQuery(query: string): ShippingTypeFilter {
  const params = new URLSearchParams(query)
  const all = params.getAll('shipping')
  return all.length === 1 ? readShippingTypeFilter(all[0]) : 'all'
}

export type OrdersFilterChange = { search?: string; status?: string; followUp?: string; shipping?: ShippingTypeFilter }

/**
 * الرابط الجديد بعد تغيير فلتر (أو ضغط «بحث»): نفس قواعد الفورم بالحرف + نوع الشحن.
 * draftSearch = اللي مكتوب في خانة البحث دلوقتي. page بيتشال دايمًا (أول صفحة).
 */
export function nextOrdersQuery(current: string, draftSearch: string, next: OrdersFilterChange): string {
  const query = new URLSearchParams(current)
  const status = query.get('status') ?? 'all'
  const followUp = query.get('followup') ?? ''
  const shipping = shippingFilterFromQuery(current)

  const nextSearch = next.search ?? draftSearch
  let nextStatus = next.status ?? status
  let nextFollowUp = next.followUp ?? followUp
  if (next.followUp !== undefined && next.followUp !== '') nextStatus = 'all'
  if (next.status !== undefined && next.status !== 'all') nextFollowUp = ''
  const nextShipping = readShippingTypeFilter(next.shipping ?? shipping)

  if (nextSearch.trim() === '') query.delete('search')
  else query.set('search', nextSearch.trim())

  if (nextStatus === 'all') query.delete('status')
  else query.set('status', nextStatus)

  if (nextFollowUp === '') query.delete('followup')
  else query.set('followup', nextFollowUp)

  if (nextShipping === 'all') query.delete('shipping')
  else query.set('shipping', nextShipping)

  query.delete('page')
  return query.toString()
}
