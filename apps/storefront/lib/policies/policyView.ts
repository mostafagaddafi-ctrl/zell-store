/**
 * POLICY-PAGES — عرض صفحات السياسات في المتجر (منطق خالص). التاريخ بتوقيت القاهرة.
 */

const POLICY_TIME_ZONE = 'Africa/Cairo'

/** «آخر تحديث» — تاريخ بالعربي بتوقيت القاهرة، أو null لو القيمة غايبة أو مش تاريخ. */
export function formatPolicyDate(iso: string | null): string | null {
  if (iso === null || iso === '') return null
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Intl.DateTimeFormat('ar-EG', { timeZone: POLICY_TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(time))
}
