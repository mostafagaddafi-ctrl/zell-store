import { isPiece, type StoreProduct } from './types'

/**
 * صفحة «أدوات التركيب» — منطق صافي على المنتجات النشطة اللي طبقة القراءة جابتها.
 *
 * مصدر الربط الوحيد: product_addons → StoreProduct.addon_ids (فيلم بالمقاس نشط →
 * منتجات بالعدد نشطة، بترتيب الربط). مفيش أي بيانات تانية.
 *   - الأداة أو الفيلم المتوقف مش في القايمة أصلًا → بيختفوا لوحدهم.
 *   - منتج بالعدد مش مربوط بأي فيلم (زي رول كامل) مش أداة → مابيظهرش.
 *   - الأداة المشتركة بتظهر مرة واحدة، ومعاها الأفلام المناسبة ليها.
 *   - الباكدج منتج بالعدد عادي بسعره — مفيش أي حساب خاص.
 */

/** أقصى عدد أفلام في ?for= (السلة). */
export const MAX_TOOL_FILM_IDS = 10

export type InstallationTool = { tool: StoreProduct; films: StoreProduct[] }

export type InstallationToolsView = {
  /** films = أدوات الأفلام المطلوبة بس · all = كل الأدوات */
  mode: 'films' | 'all'
  /** الأفلام المطلوبة اللي ليها أدوات (mode = films)، بالترتيب المطلوب. */
  films: StoreProduct[]
  /** اتطلب فيلم موجود بس مالوش أدوات → العرض العام مع توضيح بسيط. */
  requestedWithoutTools: boolean
  tools: InstallationTool[]
}

/** أدوات فيلم بالمقاس: منتجات بالعدد موجودة في القايمة، بترتيب الربط، من غير تكرار. */
export function toolsOf(film: StoreProduct, byId: ReadonlyMap<number, StoreProduct>): StoreProduct[] {
  if (isPiece(film)) return []
  const out: StoreProduct[] = []
  for (const id of film.addon_ids ?? []) {
    const tool = byId.get(id)
    if (tool && isPiece(tool) && !out.includes(tool)) out.push(tool)
  }
  return out
}

/**
 * أفلام المقاس في السلة اللي ليها أدوات موجودة — معيار زرار السلة بالحرف:
 * فيلم مش قطعة، وفي addon_ids رقم لمنتج موجود في القايمة. بترتيب السلة، من غير تكرار،
 * وبحد MAX_TOOL_FILM_IDS. السلة وCheckout بيستخدموها عشان الرابط يبقى واحد.
 */
export function cartToolFilmIds(
  lines: ReadonlyArray<{ productId: number }>,
  byId: ReadonlyMap<number, StoreProduct>,
): number[] {
  const out: number[] = []
  for (const line of lines) {
    const base = byId.get(line.productId)
    if (!base || isPiece(base) || !(base.addon_ids ?? []).some((id) => byId.has(id))) continue
    if (!out.includes(base.id)) out.push(base.id)
  }
  return out.slice(0, MAX_TOOL_FILM_IDS)
}

/** رابط صفحة «أدوات التركيب» لأفلام معيّنة — null لو مفيش أفلام (مفيش رابط ميت). */
export function installationToolsHref(filmIds: readonly number[]): string | null {
  return filmIds.length > 0 ? '/installation-tools?for=' + filmIds.slice(0, MAX_TOOL_FILM_IDS).join(',') : null
}

/** ?for=1,3 → [1, 3]: أرقام صحيحة موجبة بس، من غير تكرار، وبحد أقصى. أي حاجة تانية بتتشال. */
export function parseToolFilmIds(raw: unknown): number[] {
  const text: unknown = Array.isArray(raw) ? raw[0] : raw
  if (typeof text !== 'string') return []
  const out: number[] = []
  for (const part of text.split(',')) {
    const trimmed = part.trim()
    if (!/^[1-9][0-9]{0,8}$/.test(trimmed)) continue
    const id = Number(trimmed)
    if (!out.includes(id)) out.push(id)
    if (out.length >= MAX_TOOL_FILM_IDS) break
  }
  return out
}

function collect(films: readonly StoreProduct[], byId: ReadonlyMap<number, StoreProduct>): InstallationTool[] {
  const order: InstallationTool[] = []
  const index = new Map<number, InstallationTool>()
  for (const film of films) {
    for (const tool of toolsOf(film, byId)) {
      const existing = index.get(tool.id)
      if (existing) {
        if (!existing.films.includes(film)) existing.films.push(film)
        continue
      }
      const entry: InstallationTool = { tool, films: [film] }
      index.set(tool.id, entry)
      order.push(entry)
    }
  }
  return order
}

/**
 *   forIds فيه فيلم (أو أكتر) موجود وليه أدوات → أدوات الأفلام دي بس (mode = films)
 *   forIds فيه أفلام موجودة كلها من غير أدوات  → كل الأدوات + requestedWithoutTools
 *   forIds فاضي أو غلط أو أفلام مش موجودة       → كل الأدوات من غير أي رسالة
 */
export function installationTools(products: readonly StoreProduct[], forIds: readonly number[]): InstallationToolsView {
  const byId = new Map<number, StoreProduct>(products.map((product) => [product.id, product]))
  const requested = forIds
    .map((id) => byId.get(id))
    .filter((product): product is StoreProduct => product !== undefined && !isPiece(product))
  const requestedWithTools = requested.filter((film) => toolsOf(film, byId).length > 0)
  if (requestedWithTools.length > 0) {
    return { mode: 'films', films: requestedWithTools, requestedWithoutTools: false, tools: collect(requestedWithTools, byId) }
  }
  const filmsWithTools = products.filter((product) => toolsOf(product, byId).length > 0)
  return { mode: 'all', films: [], requestedWithoutTools: requested.length > 0, tools: collect(filmsWithTools, byId) }
}

/** فيه أداة نشطة مربوطة بفيلم نشط؟ — شرط لينك قائمة الموبايل. */
export function hasInstallationTools(products: readonly StoreProduct[]): boolean {
  return installationTools(products, []).tools.length > 0
}
