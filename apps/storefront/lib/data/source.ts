/**
 * مصدر بيانات المتجر — نقطة الدخول الوحيدة للصفحات.
 *
 * الهدف من الملف ده إن الصفحات ما تعرفش من فين البيانات جاية.
 * النهارده كلها fallback؛ بعد الموافقة بنبدّل التنفيذ هنا بس
 * والصفحات ما تتغيّرش ولا سطر.
 *
 * 🔒 المفتاح مقفول على 'fallback' عمدًا.
 * تبديله دلوقتي هيرجّع صفر منتجات، لأن RLS شغّال على Production
 * و anon/authenticated مالهمش أي صلاحية قراءة. لازم سياسات القراءة
 * تتراجع وتتوافق عليها الأول — التفاصيل في docs/PHASE-2-PLAN.md.
 */
import type { StoreProduct, StoreSettings } from '@zell/core'
import { getFallbackProducts, getFallbackSettings } from '../catalog'

export type DataSource = 'fallback' | 'supabase'

export type StorefrontData = {
  source: DataSource
  products: StoreProduct[]
  settings: StoreSettings
}

/**
 * ⚠️ ما تغيّرش القيمة دي من غير موافقة صريحة.
 * الشرط: سياسات RLS للقراءة العامة اتنفّذت واتراجعت على staging.
 */
const DATA_SOURCE: DataSource = 'fallback'

export async function getStorefrontData(): Promise<StorefrontData> {
  if (DATA_SOURCE === 'fallback') {
    return {
      source: 'fallback',
      products: getFallbackProducts(),
      settings: getFallbackSettings(),
    }
  }

  // القراءة من Supabase هتتكتب في الكوميت اللي بعد الموافقة.
  // متعمّد إنها ترمي خطأ بدل ما ترجّع مصفوفة فاضية: فشل صريح
  // أحسن من متجر بيعرض صفر منتجات من غير ما حد ياخد باله.
  throw new Error('مصدر Supabase لسه مش مربوط — راجع docs/PHASE-2-PLAN.md')
}

export async function getStorefrontProducts(): Promise<StoreProduct[]> {
  const data = await getStorefrontData()
  return data.products
}

export async function getStorefrontSettings(): Promise<StoreSettings> {
  const data = await getStorefrontData()
  return data.settings
}

export async function getStorefrontProductById(id: number): Promise<StoreProduct | undefined> {
  if (!Number.isFinite(id)) return undefined
  const products = await getStorefrontProducts()
  return products.find((product) => product.id === id)
}
