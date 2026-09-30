/**
 * قراءة بيانات الاتصال الخاصة بالمصادقة.
 *
 * الملف ده **مالوش** server-only عن قصد: الـ middleware بيشتغل على
 * Edge runtime ومايقدرش يستورد next/headers ولا server-only.
 *
 * 🔒 قاعدة ثابتة: ممنوع أي متغير هنا يبقى NEXT_PUBLIC_.
 * المفتاح المجهول (anon) مش سر، لكن مالوش لزمة في المتصفح لأن
 * تسجيل الدخول كله Server Action.
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY **ممنوع** يتقرا من هنا. ده ملف
 * المصادقة، وبيستخدم المفتاح المجهول بس.
 */

export type AuthCredentials = { url: string; anonKey: string }

export function authCredentials(): AuthCredentials {
  const url = (process.env['SUPABASE_URL'] ?? '').trim()
  if (url === '') throw new Error('SUPABASE_URL مش متظبط في متغيرات البيئة')

  const anonKey = (process.env['SUPABASE_ANON_KEY'] ?? '').trim()
  if (anonKey === '') throw new Error('SUPABASE_ANON_KEY مش متظبط في متغيرات البيئة')

  return { url: url.replace(/\/+$/, ''), anonKey }
}
