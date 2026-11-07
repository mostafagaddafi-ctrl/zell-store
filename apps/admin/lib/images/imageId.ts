/**
 * IMAGE-DELETE (C1، معالجة B1) — معرّف صورة المنتج (bigint في Postgres) كنص دقيق.
 *
 * JSON.parse بيقرّب أي رقم أكبر من Number.MAX_SAFE_INTEGER (مثلًا 9007199254740993 بيبقى 9007199254740992)،
 * وString() بعدها مابترجّعش الأصل. عشان كده: النص لازم يكون أرقام موجبة في مدى bigint، والرقم مقبول بس لو صحيح آمن.
 * أي حاجة تانية = null، والمستخدم لازم يرفض أو يعتبر النتيجة غير مؤكدة (مايبعتش المعرّف لأي كتابة).
 * القراية بتطلب id::text من PostgREST، فالنص الدقيق هو الطبيعي، والرقم الآمن مقبول للتوافق.
 */
const INT8_MAX = '9223372036854775807'

export function exactImageId(value: unknown): string | null {
  if (typeof value === 'string') {
    if (!/^[1-9][0-9]{0,18}$/.test(value)) return null
    if (value.length === INT8_MAX.length && value > INT8_MAX) return null
    return value
  }
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return null
}
