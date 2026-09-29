/**
 * توليد رقم الطلب — TypeScript صافي، يعتمد على Web Crypto فقط.
 * الصيغة: FLM-XXXXXX بأبجدية من غير O/0/I/1 لتفادي اللبس عند القراءة الصوتية.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 حرف: بدون O و 0 و I و 1
const CODE_LENGTH = 6

export function generateOrderNumber(prefix = 'FLM'): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[(bytes[i] as number) % ALPHABET.length]
  }
  return `${prefix}-${code}`
}

/** هل الخطأ ده تكرار لرقم الطلب؟ (لإعادة المحاولة بدل الفشل) */
export function isDuplicateOrderNumberError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message ?? err ?? '').toLowerCase()
  return (
    message.includes('order_number') ||
    message.includes('duplicate key') ||
    message.includes('unique constraint') ||
    message.includes('23505')
  )
}
