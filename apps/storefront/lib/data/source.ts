import type { StoreProduct, StoreSettings } from '@zell/core'
import { getFallbackProducts, getFallbackSettings } from '../catalog'
import { fetchStorefrontFromSupabase } from './queries'

/**
 * مصدر بيانات المتجر — نقطة الدخول الوحيدة للصفحات.
 *
 * المصدر بيتحدد من متغير بيئة **صريح**، مفيش استنتاج ولا fallback ضمني:
 *
 *   STOREFRONT_DATA_SOURCE=fallback   ← GitHub Actions والتطوير المحلي
 *   STOREFRONT_DATA_SOURCE=supabase   ← Vercel بعد ضبط المتغيرات
 *
 * قيمة ناقصة أو غير معروفة = خطأ صريح. خطأ إعداد صامت أسوأ بكتير من
 * بناء فاشل، لأنه بيوصل للزباين بأسعار قديمة من غير ما حد ياخد باله.
 */
export type DataSource = 'fallback' | 'supabase'

export type StorefrontData = {
  source: DataSource
  products: StoreProduct[]
  settings: StoreSettings
}

function resolveDataSource(): DataSource {
  const raw = (process.env['STOREFRONT_DATA_SOURCE'] ?? '').trim()

  if (raw === 'fallback') return 'fallback'
  if (raw === 'supabase') return 'supabase'

  if (raw === '') {
    throw new Error('STOREFRONT_DATA_SOURCE مش متظبط. القيم المسموحة: fallback أو supabase')
  }
  throw new Error('STOREFRONT_DATA_SOURCE فيه قيمة غير معروفة. المسموح: fallback أو supabase')
}

export async function getStorefrontData(): Promise<StorefrontData> {
  const source = resolveDataSource()

  if (source === 'fallback') {
    return {
      source,
      products: getFallbackProducts(),
      settings: getFallbackSettings(),
    }
  }

  const { products, settings } = await fetchStorefrontFromSupabase()
  return { source, products, settings }
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
