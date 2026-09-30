import 'server-only'

import type { StoreProduct, StoreSettings } from '@zell/core'
import {
  PUBLIC_SETTING_KEYS,
  toStoreLogo,
  toStoreProducts,
  toStoreSettings,
  type ProductImageRow,
  type ProductRow,
  type SettingRow,
  type SiteImageRow,
} from './mappers'
import { restGet, supabaseProjectUrl } from './supabaseServer'

/** ٥ دقايق. تعديل سعر من الداشبورد يبان خلال المدة دي كحد أقصى. */
export const REVALIDATE_SECONDS = 300

const PRODUCT_COLUMNS = [
  'id',
  'name_ar',
  'name_en',
  'brand',
  'description_ar',
  'image_url',
  'images',
  'before_image',
  'after_image',
  'price_per_meter_piastres',
  'width_cm',
  'min_length_cm',
  'step_cm',
  'max_length_cm',
].join(',')

const PRODUCT_IMAGE_COLUMNS = [
  'id',
  'product_id',
  'bucket',
  'object_path',
  'kind',
  'alt_text',
  'sort_order',
  'is_primary',
  'width_px',
  'height_px',
].join(',')

const SITE_IMAGE_COLUMNS = [
  'id',
  'bucket',
  'object_path',
  'kind',
  'alt_text',
  'is_active',
  'width_px',
  'height_px',
].join(',')

/**
 * فلتر PostgREST من نوع in.(...).
 *
 * كل قيمة بتتحاط بين علامتي تنصيص وبتتشفّر — عشان لو اتضاف مفتاح فيه
 * فاصلة أو قوس أو مسافة لاحقًا، الاستعلام ما يتكسرش بصمت. الأقواس
 * والفواصل الفاصلة بين العناصر بتفضل حرفية لأنها جزء من صيغة PostgREST.
 */
function inFilter(values: readonly string[]): string {
  const quoted = values.map((value) => '"' + encodeURIComponent(value) + '"').join(',')
  return 'in.(' + quoted + ')'
}

/**
 * أربع طلبات متوازية (مش رحلة شبكة واحدة) — بينتهوا في وقت أبطأ واحد فيهم.
 * القراءة فقط: مفيش أي كتابة ولا تعديل على أي جدول أو ملف.
 */
export async function fetchStorefrontFromSupabase(): Promise<{
  products: StoreProduct[]
  settings: StoreSettings
}> {
  const supabaseUrl = supabaseProjectUrl()

  const [productRows, imageRows, settingRows, logoRows] = await Promise.all([
    restGet<ProductRow>(
      'products',
      'select=' + PRODUCT_COLUMNS + '&is_active=eq.true&order=sort_order.asc,id.asc',
      REVALIDATE_SECONDS,
    ),
    restGet<ProductImageRow>(
      'product_images',
      'select=' + PRODUCT_IMAGE_COLUMNS + '&kind=eq.gallery&order=is_primary.desc,sort_order.asc,id.asc',
      REVALIDATE_SECONDS,
    ),
    restGet<SettingRow>(
      'settings',
      'select=key,value&key=' + inFilter(PUBLIC_SETTING_KEYS),
      REVALIDATE_SECONDS,
    ),
    // المفروض لوجو نشط واحد بس. id.desc دفاعيًا: لو القيد اتكسر يومًا
    // ما، بناخد الأحدث مش الأقدم.
    restGet<SiteImageRow>(
      'site_images',
      'select=' + SITE_IMAGE_COLUMNS + '&kind=eq.logo&is_active=eq.true&order=id.desc&limit=1',
      REVALIDATE_SECONDS,
    ),
  ])

  // متجر بصفر منتجات عطل مش حالة طبيعية — نفشل بوضوح بدل ما نعرض صفحة فاضية
  if (productRows.length === 0) {
    throw new Error('مفيش منتجات نشطة راجعة من الداتابيز')
  }

  const products = toStoreProducts(productRows, imageRows, supabaseUrl)

  // الإعدادات الأول عشان نعرف اسم المتجر كبديل لنص اللوجو
  const baseSettings = toStoreSettings(settingRows, null)
  const logoRow = logoRows[0]
  const logo = logoRow ? toStoreLogo(logoRow, supabaseUrl, baseSettings.storeName) : null

  return { products, settings: { ...baseSettings, logo } }
}
