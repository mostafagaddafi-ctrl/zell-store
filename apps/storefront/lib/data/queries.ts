import 'server-only'

import type { StoreCollection, StoreProduct, StoreSettings } from '@zell/core'
import {
  PUBLIC_SETTING_KEYS,
  toStoreCollections,
  toStoreProducts,
  toStoreSiteImage,
  toStoreSettings,
  type CollectionRow,
  type ProductCollectionRow,
  type ProductImageRow,
  type ProductRow,
  type SettingRow,
  type SiteImageRow,
  attachWidths,
  type ProductWidthRow,
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
  'lock_width',
  'compare_at_piastres',
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

const COLLECTION_COLUMNS = [
  'id',
  'slug',
  'title_ar',
  'subtitle_ar',
  'show_on_home',
  'show_in_nav',
  'sort_order',
  'cover_bucket',
  'cover_object_path',
  'cover_width_px',
  'cover_height_px',
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
  collections: StoreCollection[]
}> {
  const supabaseUrl = supabaseProjectUrl()

  const [productRows, imageRows, settingRows, siteImageRows, collectionRows, linkRows, widthRows] = await Promise.all([
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
    // اللوجو وصورة الواجهة في طلب واحد — 0009 بيضمن نشط واحد لكل نوع.
    // id.desc دفاعيًا: لو الفهرس الفريد اتكسر يومًا ما، ناخد الأحدث.
    restGet<SiteImageRow>(
      'site_images',
      'select=' + SITE_IMAGE_COLUMNS + '&kind=in.(logo,hero)&is_active=eq.true&order=id.desc',
      REVALIDATE_SECONDS,
    ),
    // المجموعات الظاهرة بس. الترتيب من sort_order ثم id لثبات العرض.
    restGet<CollectionRow>(
      'collections',
      'select=' + COLLECTION_COLUMNS + '&or=(show_on_home.eq.true,show_in_nav.eq.true)&order=sort_order.asc,id.asc',
      REVALIDATE_SECONDS,
    ),
    // كل الروابط. الجدول صغير (مجموعات × منتجات)، فطلب واحد أرخص
    // من طلب لكل مجموعة — ولا بيكبر مع عدد المجموعات.
    restGet<ProductCollectionRow>(
      'product_collections',
      'select=collection_id,product_id,sort_order&order=sort_order.asc',
      REVALIDATE_SECONDS,
    ),
    // 0015 — عروض الرول الإضافية الشغّالة بس
    restGet<ProductWidthRow>(
      'product_widths',
      'select=product_id,width_cm,price_per_meter_piastres,compare_at_piastres&is_active=eq.true&order=sort_order.asc,width_cm.asc',
      REVALIDATE_SECONDS,
    ),
  ])

  // متجر بصفر منتجات عطل مش حالة طبيعية — نفشل بوضوح بدل ما نعرض صفحة فاضية
  if (productRows.length === 0) {
    throw new Error('مفيش منتجات نشطة راجعة من الداتابيز')
  }

  const products = attachWidths(toStoreProducts(productRows, imageRows, supabaseUrl), widthRows)

  // الإعدادات الأول عشان نعرف اسم المتجر كبديل لنص اللوجو
  const baseSettings = toStoreSettings(settingRows, null)
  const logoRow = siteImageRows.find((row) => row.kind === 'logo')
  const heroRow = siteImageRows.find((row) => row.kind === 'hero')

  const logo = logoRow ? toStoreSiteImage(logoRow, supabaseUrl, baseSettings.storeName) : null
  const heroImage = heroRow ? toStoreSiteImage(heroRow, supabaseUrl, 'صورة الواجهة') : null

  // المنتجات الظاهرة بس — منتج متوقّف لازم يختفي من المجموعة كمان
  const collections = toStoreCollections(collectionRows, linkRows, products, supabaseUrl)

  return { products, settings: { ...baseSettings, logo, heroImage }, collections }
}
