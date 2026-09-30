/**
 * تنظيف معامل next.
 *
 * الهدف: منع إعادة التوجيه المفتوحة. أي قيمة مش مسار داخلي
 * ببداية شرطة واحدة بترجع '/' من غير أي محاولة إصلاح.
 *
 * مرفوض: //evil.com و https://evil.com و /\evil.com و أي حرف تحكم
 * أو مسافة، و/login و/403 و/auth/* عشان مانعملش حلقة توجيه.
 */

const CONTROL_OR_SPACE = /[\u0000-\u001F\u007F\s]/
const DUMMY_ORIGIN = 'https://admin.invalid'
const BLOCKED_PREFIXES = ['/login', '/403', '/auth/']

export function sanitizeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '/'
  if (raw === '') return '/'
  if (CONTROL_OR_SPACE.test(raw)) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  if (raw.startsWith('/\\')) return '/'

  let parsed: URL
  try {
    parsed = new URL(raw, DUMMY_ORIGIN)
  } catch {
    return '/'
  }
  if (parsed.origin !== DUMMY_ORIGIN) return '/'

  const path = parsed.pathname + parsed.search + parsed.hash
  if (!path.startsWith('/') || path.startsWith('//')) return '/'
  for (const prefix of BLOCKED_PREFIXES) {
    if (path === prefix || path.startsWith(prefix)) return '/'
  }

  return path
}
