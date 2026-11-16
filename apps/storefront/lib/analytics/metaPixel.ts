/**
 * META-PIXEL §٢-٢-ب — «العنوان النضيف» والـ referrer وشرط التهيئة (ت١). منطق خالص.
 *
 * تعريف إيجابي: أي حاجة برّه الجدول ده مش نضيفة.
 *   /  ·  /products  ·  /collections  ·  /cart  ·  /checkout  ·  /installation-tools
 *   /product/<id عضو في الكتالوج>  ·  /collection/<slug عضو>  ·  /policies/<terms|shipping|returns|privacy>
 * الـ query: fbclid (شكل وطول بس — مش كاشف بيانات شخصية) في كل الصفحات، و for (معرّفات أعضاء) في /installation-tools بس.
 * الـ hash: فاضي، أو #products على / بس.
 */
import { MAX_TOOL_FILM_IDS, META_PIXEL_ID_PATTERN } from '@zell/core'
import { isBlockedPath } from './pixelBridge'

export { isBlockedPath }

export type PixelCatalog = { productIds: ReadonlySet<string>; collectionSlugs: ReadonlySet<string> }

export const PIXEL_STATIC_PATHS: readonly string[] = ['/', '/products', '/collections', '/cart', '/checkout', '/installation-tools']
export const PIXEL_POLICY_KEYS: readonly string[] = ['terms', 'shipping', 'returns', 'privacy']
export const PIXEL_HASHES: Readonly<Record<string, string>> = { '/': '#products' }
const FBCLID = /^[A-Za-z0-9_-]{1,500}$/
const FOR_IDS = /^[0-9]+(,[0-9]+)*$/

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export type PathState = 'clean' | 'blocked' | 'unknown'

export function classifyPath(pathname: string, catalog: PixelCatalog): PathState {
  if (isBlockedPath(pathname)) return 'blocked'
  if (PIXEL_STATIC_PATHS.includes(pathname)) return 'clean'
  const parts = pathname.split('/')
  if (parts.length !== 3 || parts[0] !== '') return 'unknown'
  const kind = parts[1]
  const raw = parts[2]
  if (kind === undefined || raw === undefined || raw === '') return 'unknown'
  const value = decodeSegment(raw)
  if (value === null || value === '') return 'unknown'
  if (kind === 'product') return catalog.productIds.has(value) && /^[0-9]+$/.test(raw) ? 'clean' : 'unknown'
  if (kind === 'collection') return catalog.collectionSlugs.has(value) ? 'clean' : 'unknown'
  if (kind === 'policies') return PIXEL_POLICY_KEYS.includes(raw) ? 'clean' : 'unknown'
  return 'unknown'
}

/** الـ query النضيف بالترتيب الثابت (for ثم fbclid)، من غير ترميز (القيم المسموحة مافيهاش حروف محتاجة ترميز). */
export function cleanSearch(pathname: string, search: string, catalog: PixelCatalog): string {
  const params = new URLSearchParams(search)
  const parts: string[] = []
  if (pathname === '/installation-tools') {
    const values = params.getAll('for')
    const value = values.length === 1 ? values[0] : undefined
    if (value !== undefined && value.length <= 100 && FOR_IDS.test(value)) {
      const ids = value.split(',')
      if (ids.length <= MAX_TOOL_FILM_IDS && ids.every((id) => catalog.productIds.has(id))) parts.push('for=' + value)
    }
  }
  const clicks = params.getAll('fbclid')
  const click = clicks.length === 1 ? clicks[0] : undefined
  if (click !== undefined && FBCLID.test(click)) parts.push('fbclid=' + click)
  return parts.length > 0 ? '?' + parts.join('&') : ''
}

export function cleanHash(pathname: string, hash: string): string {
  const allowed = PIXEL_HASHES[pathname]
  return allowed !== undefined && hash === allowed ? hash : ''
}

export type CleanResult = { pathOk: false; state: PathState } | { pathOk: true; url: string; changed: boolean }

/** العنوان النضيف لعنوان كامل من نفس الأصل. المسار عمره ما يتنضّف: مش نضيف = pathOk false. */
export function cleanUrlFor(href: string, origin: string, catalog: PixelCatalog): CleanResult {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { pathOk: false, state: 'unknown' }
  }
  if (url.origin !== origin) return { pathOk: false, state: 'unknown' }
  const state = classifyPath(url.pathname, catalog)
  if (state !== 'clean') return { pathOk: false, state }
  const clean = url.pathname + cleanSearch(url.pathname, url.search, catalog) + cleanHash(url.pathname, url.hash)
  const current = url.pathname + url.search + url.hash
  return { pathOk: true, url: clean, changed: clean !== current }
}

export function isCleanHref(href: string, origin: string, catalog: PixelCatalog): boolean {
  const result = cleanUrlFor(href, origin, catalog)
  return result.pathOk && !result.changed
}

/** ن٤ — فاضي · نفس الأصل بعنوان نضيف · أصل تاني لوحده (من غير مسار ولا query). */
export function isCleanReferrer(referrer: string, origin: string, catalog: PixelCatalog): boolean {
  if (referrer === '') return true
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return false
  }
  if (url.origin === origin) return isCleanHref(referrer, origin, catalog)
  return url.pathname === '/' && url.search === '' && url.hash === ''
}

/** السكربت الحقيقي جاهز = fbq دالة وعليها callMethod (الطابور المؤقت لوحده مافيهوش callMethod). */
export function sdkReady(fbq: unknown): boolean {
  return typeof fbq === 'function' && typeof (fbq as { callMethod?: unknown }).callMethod === 'function'
}

export type InitState = {
  tainted: boolean
  stopped: boolean
  timedOut: boolean
  hrefClean: boolean
  referrerClean: boolean
  id: string
  fbq: unknown
}

/** ت١ — شرط التهيئة على الحالة الحالية. */
export function canInit(state: InitState): boolean {
  return (
    !state.tainted &&
    !state.stopped &&
    !state.timedOut &&
    state.hrefClean &&
    state.referrerClean &&
    META_PIXEL_ID_PATTERN.test(state.id) &&
    sdkReady(state.fbq)
  )
}
