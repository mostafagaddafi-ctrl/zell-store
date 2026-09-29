/**
 * توليد رقم الطلب — يعتمد على Web Crypto فقط (متاح في Node 19+ والمتصفح وVercel).
 * الصيغة: FLM-XXXXXX بأبجدية من غير O/0/I/1 لتفادي اللبس عند القراءة الصوتية.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

export function generateOrderNumber(prefix = 'FLM'): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    const byte = bytes[i] ?? 0
    code += ALPHABET.charAt(byte % ALPHABET.length)
  }
  return prefix + '-' + code
}

export function isValidOrderNumber(value: string): boolean {
  return /^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value)
}

/** هل الخطأ ده تكرار لرقم الطلب؟ (لإعادة المحاولة بدل الفشل) */
export function isDuplicateOrderNumberError(err: unknown): boolean {
  const message = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase()
  return (
    message.includes('order_number') ||
    message.includes('duplicate key') ||
    message.includes('unique constraint') ||
    message.includes('23505')
  )
}
