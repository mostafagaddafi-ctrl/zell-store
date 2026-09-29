/**
 * مؤشر الجاهزية: الإشعارات شغّالة؟ الشحن متظبط؟ فيه منتجات نشطة وليها صور؟
 */
import { loadSettings, settingNumber, settingRecord, settingString } from '../lib/db'

export type ReadinessCheck = {
  key: string
  label: string
  ok: boolean
  detail: string
}

export default async function (): Promise<{ checks: ReadinessCheck[]; readyCount: number; total: number }> {
  const settings = await loadSettings()

  const productsResult = await supabase.query<{ active_count: number; with_image: number }>(
    `select
       count(*) filter (where is_active)::int as active_count,
       count(*) filter (where is_active and image_url is not null and image_url <> '')::int as with_image
     from products`,
  )
  const products = productsResult.data[0] ?? { active_count: 0, with_image: 0 }

  const failedResult = await supabase.query<{ failed: number }>(
    `select count(*)::int as failed
     from orders
     where notified_at is null and notify_error is not null and created_at >= now() - interval '7 days'`,
  )
  const failed = failedResult.data[0]?.failed ?? 0

  const notifyEmail = settingString(settings, 'notify_email')
  const whatsapp = settingString(settings, 'whatsapp_number')
  const rates = settingRecord(settings, 'shipping_rates')
  const shippingDefault = settingNumber(settings, 'shipping_default_piastres', 0)

  const checks: ReadinessCheck[] = [
    {
      key: 'notifications',
      label: 'إشعارات الطلبات',
      ok: notifyEmail.length > 0 && failed === 0,
      detail: !notifyEmail
        ? 'مفيش إيميل إشعارات في الإعدادات'
        : failed > 0
          ? `${failed} إشعار فشل في آخر ٧ أيام`
          : `الإشعارات بتروح على ${notifyEmail}`,
    },
    {
      key: 'shipping',
      label: 'جدول الشحن',
      ok: Object.keys(rates).length > 0 && shippingDefault > 0,
      detail:
        Object.keys(rates).length === 0
          ? 'مفيش محافظات في جدول الشحن'
          : shippingDefault <= 0
            ? 'سعر الشحن الافتراضي بصفر'
            : `${Object.keys(rates).length} محافظة مضبوطة`,
    },
    {
      key: 'products',
      label: 'المنتجات النشطة',
      ok: products.active_count > 0,
      detail: products.active_count > 0 ? `${products.active_count} منتج نشط` : 'مفيش منتجات نشطة للبيع',
    },
    {
      key: 'images',
      label: 'صور المنتجات',
      ok: products.active_count > 0 && products.with_image === products.active_count,
      detail:
        products.active_count === 0
          ? 'مفيش منتجات نشطة'
          : products.with_image === products.active_count
            ? 'كل المنتجات النشطة ليها صور'
            : `${products.active_count - products.with_image} منتج من غير صورة`,
    },
    {
      key: 'whatsapp',
      label: 'زر واتساب',
      ok: /^\d{10,15}$/.test(whatsapp),
      detail: whatsapp ? `رقم واتساب: ${whatsapp}` : 'مفيش رقم واتساب في الإعدادات',
    },
  ]

  return { checks, readyCount: checks.filter((c) => c.ok).length, total: checks.length }
}
