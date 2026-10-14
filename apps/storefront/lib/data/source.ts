import { parsePeriodTimes, type DeliveryPeriodTime, type StoreCollection, type StoreProduct, type StoreSettings } from '@zell/core'
import { getFallbackCollections, getFallbackProducts, getFallbackSettings } from '../catalog'
import { fetchStorefrontFromSupabase } from './queries'
import { restRpc } from './rpc'
import { parseCheckoutFee, type CheckoutFee } from '../orders/confirmationFee'
import type { CheckoutDeliverySettings } from '../orders/deliverySettings'
import { readCheckoutDeliverySettings } from './deliverySettings'
import type { ShippingOptions } from '@zell/core'
import { readCheckoutShippingOptions } from './shippingOptions'

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
/*
 * تذكير للإعداد: المتغير ده لازم يكون متظبط في كل بيئة بتبني المشروع —
 * Vercel (Production و Preview) و GitHub Actions. مفيش قيمة افتراضية
 * عن قصد: بناء فاشل أوضح بكتير من متجر شغّال بأسعار قديمة.
 */
export type DataSource = 'fallback' | 'supabase'

export type StorefrontData = {
  source: DataSource
  products: StoreProduct[]
  settings: StoreSettings
  collections: StoreCollection[]
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
      collections: getFallbackCollections(),
    }
  }

  const { products, settings, collections } = await fetchStorefrontFromSupabase()
  return { source, products, settings, collections }
}

export async function getStorefrontProducts(): Promise<StoreProduct[]> {
  const data = await getStorefrontData()
  return data.products
}

export async function getStorefrontSettings(): Promise<StoreSettings> {
  const data = await getStorefrontData()
  return data.settings
}

export async function getStorefrontCollections(): Promise<StoreCollection[]> {
  const data = await getStorefrontData()
  return data.collections
}

export async function getStorefrontProductById(id: number): Promise<StoreProduct | undefined> {
  if (!Number.isFinite(id)) return undefined
  const products = await getStorefrontProducts()
  return products.find((product) => product.id === id)
}

/**
 * 0021-D — أوقات فترات التسليم للـ Checkout من الداتابيز (zell_checkout_delivery_periods، service_role).
 * fallback (CI والتطوير) أو أي فشل = null: الفورم بيعرض أسماء الفترات من غير أوقات، والطلب مايقعش.
 */
export async function getCheckoutPeriods(): Promise<DeliveryPeriodTime[] | null> {
  if (resolveDataSource() === 'fallback') return null
  try {
    const result = await restRpc<unknown>('zell_checkout_delivery_periods', {})
    return result.ok ? parsePeriodTimes(result.data) : null
  } catch {
    return null
  }
}

/**
 * 0021-A P2 — إعداد رسوم التأكيد للـ Checkout (zell_checkout_confirmation_fee، service_role).
 * fallback (CI والتطوير) أو أي فشل أو الدالة مش موجودة = null: مفيش سطر مقدم، والطلب مايقعش (المعتمد لقطة الداتابيز).
 */
export async function getCheckoutConfirmationFee(): Promise<CheckoutFee | null> {
  if (resolveDataSource() === 'fallback') return null
  try {
    const result = await restRpc<unknown>('zell_checkout_confirmation_fee', {})
    return result.ok ? parseCheckoutFee(result.data) : null
  } catch {
    return null
  }
}

/**
 * 0021-D2 — إعداد موعد التسليم للـ Checkout (zell_checkout_delivery_settings، service_role).
 * fallback (CI والتطوير) أو أي فشل = null: اختيار الموعد والسطر مخفيين، والطلب شغّال من غير موعد.
 */
export async function getCheckoutDeliverySettings(): Promise<CheckoutDeliverySettings | null> {
  if (resolveDataSource() === 'fallback') return null
  return readCheckoutDeliverySettings()
}

/**
 * EXPRESS-SHIPPING W2 — إعداد الشحن السريع ومدة الشحن للـ Checkout (zell_shipping_options_checkout، service_role).
 * fallback (CI والتطوير) أو أي فشل = null: اختيار «شحن عادي / شحن سريع» مايظهرش، والطلب عادي.
 */
export async function getCheckoutShippingOptions(): Promise<ShippingOptions | null> {
  if (resolveDataSource() === 'fallback') return null
  return readCheckoutShippingOptions()
}
