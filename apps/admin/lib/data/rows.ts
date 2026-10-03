import 'server-only'

import { hasInstallerRequest, publicImageUrl } from '@zell/core'
import type {
  AdminCollection,
  AdminImage,
  AdminOrder,
  AdminOrderItem,
  AdminProduct,
  FaqItem,
  FooterLink,
  HeroContent,
  OrderStep,
  StoreSection,
} from '../adminData'
import { ORDER_STATUSES, SECTION_KEYS, type ImageFit, type OrderStatus, type SectionKey } from '../enums'

// ── صفوف الداتابيز ───────────────────────────────────────────
export type ProductRow = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  short_benefit: string | null
  benefits: unknown
  price_per_meter_piastres: number
  width_cm: number
  lock_width: boolean
  compare_at_piastres: number | null
  sale_unit?: string
  is_listed?: boolean
  max_quantity?: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  is_active: boolean
  sort_order: number
  updated_at: string
}

/** id و bigint بتوصل كنص — ممنوع تحويلها لرقم. */
export type ProductImageRow = {
  id: string
  product_id: number
  bucket: string
  object_path: string
  kind: string
  alt_text: string | null
  fit: string | null
  sort_order: number
  is_primary: boolean
  width_px: number | null
  height_px: number | null
  updated_at: string
}

export type SiteImageRow = {
  id: string
  bucket: string
  object_path: string
  kind: string
  alt_text: string | null
  width_px: number | null
  height_px: number | null
  updated_at: string
}

/** صف public.collections — id بيترجع نص لأنه bigint. */
export type CollectionRow = {
  id: string
  slug: string
  title_ar: string
  subtitle_ar: string | null
  show_on_home: boolean
  show_in_nav: boolean
  sort_order: number
  cover_bucket: string | null
  cover_object_path: string | null
  cover_width_px: number | null
  cover_height_px: number | null
  updated_at: string
}

/**
 * أعمدة القسم — مصدر واحد للقراءة والتعديل.
 * ⚠️ is_visible مش هنا عن قصد: اللوحة بتكتبه بس (للتوافق مع نسخة
 *    المتجر القديمة أثناء الانتقال) ومابتقراهوش. شوف 0012.
 */
export const COLLECTION_SELECT = [
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
  'updated_at',
].join(',')

/** صف public.product_collections */
export type ProductCollectionRow = {
  collection_id: string
  product_id: number
  sort_order: number
}

export type OrderRow = {
  id: number
  order_number: string
  status: string
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  notes: string | null
  internal_notes: string | null
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  notified_at: string | null
  notify_error: string | null
  created_at: string
  updated_at: string
}

export type OrderItemRow = {
  order_id: number
  product_name_ar: string
  length_cm: number | null
  width_cm: number | null
  unit_price_piastres: number
  line_total_piastres: number
  sale_unit?: string
  quantity?: number
}

export type SettingRow = { key: string; value: unknown; updated_at?: string | null }

// ── محوّلات ──────────────────────────────────────────────────
function asStringArray(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, limit)
}

function asFit(value: string | null): ImageFit {
  return value === 'contain' ? 'contain' : 'cover'
}

function asStatus(value: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : 'new'
}

export function toAdminProduct(row: ProductRow, imageCount: number): AdminProduct {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en ?? '',
    brand: row.brand ?? '',
    descriptionAr: row.description_ar ?? '',
    shortBenefit: row.short_benefit ?? '',
    benefits: asStringArray(row.benefits),
    pricePerMeterPiastres: row.price_per_meter_piastres,
    widthCm: row.width_cm,
    lockWidth: row.lock_width === true,
    compareAtPiastres: typeof row.compare_at_piastres === 'number' ? row.compare_at_piastres : null,
    saleUnit: row.sale_unit === 'piece' ? 'piece' : 'meter',
    isListed: row.is_listed !== false,
    maxQuantity: typeof row.max_quantity === 'number' ? row.max_quantity : 20,
    minLengthCm: row.min_length_cm,
    stepCm: row.step_cm,
    maxLengthCm: row.max_length_cm,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    imageCount,
    updatedAt: row.updated_at,
  }
}

export function toAdminImage(row: ProductImageRow, supabaseUrl: string, fallbackAlt: string): AdminImage {
  return {
    id: String(row.id),
    url: publicImageUrl(supabaseUrl, { bucket: row.bucket, object_path: row.object_path }),
    alt: row.alt_text && row.alt_text.trim() !== '' ? row.alt_text : fallbackAlt,
    fit: asFit(row.fit),
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    width: row.width_px,
    height: row.height_px,
    updatedAt: row.updated_at,
  }
}

/**
 * صف site_images -> AdminImage.
 *
 * fit بيتبعت من برّه لأنه بيختلف بالنوع: اللوجو contain (ممنوع قص
 * أي جزء من الشعار)، وصورة الواجهة cover (بتملا الإطار).
 */
export function toAdminSiteImage(
  row: SiteImageRow,
  supabaseUrl: string,
  fallbackAlt: string,
  fit: ImageFit,
): AdminImage {
  return {
    id: String(row.id),
    url: publicImageUrl(supabaseUrl, { bucket: row.bucket, object_path: row.object_path }),
    alt: row.alt_text && row.alt_text.trim() !== '' ? row.alt_text : fallbackAlt,
    fit,
    sortOrder: 0,
    isPrimary: true,
    width: row.width_px,
    height: row.height_px,
    updatedAt: row.updated_at,
  }
}

/** اسم محفوظ للتوافق. */
export function toAdminLogo(row: SiteImageRow, supabaseUrl: string, storeName: string): AdminImage {
  return toAdminSiteImage(row, supabaseUrl, storeName, 'contain')
}

export function toAdminCollection(
  row: CollectionRow,
  counts: { total: number; active: number },
  supabaseUrl: string,
): AdminCollection {
  const cover: AdminImage | null =
    row.cover_bucket && row.cover_object_path
      ? {
          id: String(row.id),
          url: publicImageUrl(supabaseUrl, { bucket: row.cover_bucket, object_path: row.cover_object_path }),
          alt: row.title_ar,
          fit: 'cover',
          sortOrder: 0,
          isPrimary: true,
          width: row.cover_width_px,
          height: row.cover_height_px,
          updatedAt: row.updated_at,
        }
      : null

  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title_ar,
    subtitle: row.subtitle_ar ?? '',
    showOnHome: row.show_on_home,
    showInNav: row.show_in_nav,
    sortOrder: row.sort_order,
    productCount: counts.total,
    activeProductCount: counts.active,
    cover,
    updatedAt: row.updated_at,
  }
}

export function toAdminOrder(row: OrderRow, itemCount: number): AdminOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: asStatus(row.status),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    governorate: row.governorate,
    itemCount,
    totalPiastres: row.total_piastres,
    notifiedAt: row.notified_at,
    notifyError: row.notify_error,
    createdAt: row.created_at,
    needsInstaller: hasInstallerRequest(row.notes),
  }
}

export function toAdminOrderItem(row: OrderItemRow): AdminOrderItem {
  return {
    productNameAr: row.product_name_ar,
    lengthCm: row.length_cm,
    widthCm: row.width_cm,
    unitPricePiastres: row.unit_price_piastres,
    lineTotalPiastres: row.line_total_piastres,
    saleUnit: row.sale_unit === 'piece' ? 'piece' : 'meter',
    quantity: typeof row.quantity === 'number' ? row.quantity : 1,
  }
}

// ── الإعدادات المهيكلة ──────────────────────────────────────
export function settingsMap(rows: SettingRow[]): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const row of rows) map.set(row.key, row.value)
  return map
}

/**
 * أحدث updated_at بين مفاتيح محددة — رمز التعارض لحفظ المحتوى.
 * بيرجّع نص فاضي لو مفيش طابع صالح، والحفظ وقتها لازم يترفض.
 */
export function latestUpdatedAt(rows: SettingRow[], keys: readonly string[]): string {
  let newest = 0
  let iso = ''
  for (const row of rows) {
    if (!keys.includes(row.key)) continue
    const raw = row.updated_at
    if (!raw) continue
    const time = new Date(raw).getTime()
    if (Number.isFinite(time) && time > newest) {
      newest = time
      iso = raw
    }
  }
  return iso
}

export function readString(map: Map<string, unknown>, key: string, fallback = ''): string {
  const value = map.get(key)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

export function readNumber(map: Map<string, unknown>, key: string, fallback = 0): number {
  const value = map.get(key)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

/** قائمة نصوص من jsonb — بتتنضّف من الفاضي والمكرر. */
export function readStringList(map: Map<string, unknown>, key: string): string[] {
  const value = map.get(key)
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed !== '') seen.add(trimmed)
  }
  return Array.from(seen)
}

export function readRates(map: Map<string, unknown>, key: string): Record<string, number> {
  const value = map.get(key)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[name] = raw
    else if (typeof raw === 'string' && Number.isFinite(Number(raw)) && Number(raw) >= 0) out[name] = Number(raw)
  }
  return out
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function readHero(map: Map<string, unknown>): HeroContent {
  const raw = record(map.get('hero'))
  return {
    title: text(raw['title']),
    accent: text(raw['accent']),
    subtitle: text(raw['subtitle']),
    ctaLabel: text(raw['ctaLabel'], text(raw['cta_label'])),
  }
}

export function readOrderSteps(map: Map<string, unknown>): OrderStep[] {
  const raw = map.get('order_steps')
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = record(item)
      return { title: text(row['title']), description: text(row['description']) }
    })
    .filter((step) => step.title !== '')
}

export function readFaqs(map: Map<string, unknown>): FaqItem[] {
  const raw = map.get('faqs')
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = record(item)
      return { question: text(row['question']), answer: text(row['answer']) }
    })
    .filter((faq) => faq.question !== '')
}

export function readSections(map: Map<string, unknown>): StoreSection[] {
  const raw = map.get('sections')
  if (!Array.isArray(raw)) return []
  const out: StoreSection[] = []
  for (const item of raw) {
    const row = record(item)
    const key = text(row['key'])
    if (!(SECTION_KEYS as readonly string[]).includes(key)) continue
    const section: StoreSection = {
      key: key as SectionKey,
      visible: row['visible'] !== false,
      sortOrder: typeof row['sortOrder'] === 'number' ? row['sortOrder'] : Number(row['sort_order'] ?? 0),
    }
    const title = text(row['title'])
    const subtitle = text(row['subtitle'])
    if (title !== '') section.title = title
    if (subtitle !== '') section.subtitle = subtitle
    out.push(section)
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder)
}

/** المسار الداخلي لازم يبدأ بـ / والخارجي بـ https:// — أي حاجة تانية بتبقى نص. */
export function readFooterLinks(map: Map<string, unknown>): FooterLink[] {
  const raw = map.get('footer_links')
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = record(item)
      const href = text(row['href'])
      const safe = href === '' || href.startsWith('/') || href.startsWith('https://')
      return { label: text(row['label']), href: safe ? href : '' }
    })
    .filter((link) => link.label !== '')
}
