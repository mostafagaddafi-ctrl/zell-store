'use client'

/**
 * بناء رابط الدخول بمسار داخلي معقّم.
 *
 * ⚠️ نسخة **مكرّرة** من قواعد lib/auth/nextPath.ts عن قصد: الملف ده
 * بيتحمّل في المتصفح، و nextPath.ts عليه server-only. لو القواعد
 * اتغيّرت في أي ناحية، لازم الاتنين يتغيّروا مع بعض.
 *
 * التعقيم هنا طبقة تانية مش الأساسية — السيرفر بيعقّم next تاني في
 * صفحة الدخول وفي الحارس.
 */

const UNSAFE = /[\u0000-\u001F\u007F\s]/
const BACKSLASH = '/' + String.fromCharCode(92)
const BLOCKED = ['/login', '/403', '/auth/']

export function loginLink(path: string): string {
  if (path === '') return '/login'
  if (UNSAFE.test(path)) return '/login'
  if (!path.startsWith('/')) return '/login'
  if (path.startsWith('//')) return '/login'
  if (path.startsWith(BACKSLASH)) return '/login'
  for (const prefix of BLOCKED) {
    if (path === prefix || path.startsWith(prefix)) return '/login'
  }
  return '/login?next=' + encodeURIComponent(path)
}
