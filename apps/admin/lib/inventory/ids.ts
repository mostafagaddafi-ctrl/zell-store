/**
 * فحوص المعرّفات — منطق خالص.
 * القيم دي بتيجي من الواجهة لـ Server Actions، فالسيرفر بيعيد فحصها قبل أي نداء.
 */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** معرّف bigint جاي كرقم JSON: صحيح موجب في حدود الأمان. */
export function parseDbId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return null
  return value
}

/** version في جداول 0020: integer يبدأ من 1. */
export function parseVersion(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) return null
  return value
}
