import 'server-only'

import { INSTALLATION_TOOLS_PAGE_LIMITS, parseInstallationToolsPage, type InstallationToolsPage } from '@zell/core'
import { restGet, restInsert } from '../data/client'
import type { MutationResult } from '../mutations'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

/**
 * صفحة «أدوات التركيب» — صف واحد settings.installation_tools_page.
 *
 * ⚠️ المحتوى بس. الربط بين الفيلم وأدواته **من صفحة الفيلم بس**
 *    (zell_set_product_addons) — مفيش أي تعديل ربط هنا.
 * ⚠️ تزامن تفاؤلي بـ settings.updated_at (مش «آخر حفظ بيكسب»):
 *    صف موجود  → patchGuarded على key
 *    مفيش صف   → insert، ولو حد عمله في نفس اللحظة = CONFLICT
 *    وبعدين قراءة تأكيد.
 */

const KEY = 'installation_tools_page'

export type ToolsPageRecord = { page: InstallationToolsPage; updatedAt: string | null }

export type ToolsSummary = {
  /** كل فيلم بالمقاس نشط وأدواته المربوطة (عرض بس). */
  films: { id: number; name: string; tools: { id: number; name: string; isActive: boolean }[] }[]
  /** منتجات بالعدد نشطة مش مربوطة بأي فيلم نشط — مش هتظهر في صفحة الأدوات. */
  unlinkedPieces: { id: number; name: string }[]
}

export async function readInstallationToolsPage(): Promise<ToolsPageRecord> {
  const rows = await restGet<{ value: unknown; updated_at: string }>(
    'settings',
    'select=value,updated_at&key=eq.' + KEY + '&limit=1',
  )
  const row = rows.rows[0]
  return { page: parseInstallationToolsPage(row?.value), updatedAt: row ? row.updated_at : null }
}

type ProductLite = { id: number; name_ar: string; is_active: boolean; sale_unit: string }
type AddonLink = { product_id: number; addon_id: number; sort_order: number }

export async function readToolsSummary(): Promise<ToolsSummary> {
  const [products, links] = await Promise.all([
    restGet<ProductLite>('products', 'select=id,name_ar,is_active,sale_unit&order=sort_order.asc,id.asc'),
    restGet<AddonLink>('product_addons', 'select=product_id,addon_id,sort_order&order=sort_order.asc,addon_id.asc'),
  ])
  const byId = new Map<number, ProductLite>(products.rows.map((row) => [Number(row.id), row]))
  const linked = new Set<number>()
  const films: ToolsSummary['films'] = []
  for (const film of products.rows) {
    if (film.sale_unit === 'piece' || !film.is_active) continue
    const tools: ToolsSummary['films'][number]['tools'] = []
    for (const link of links.rows) {
      if (Number(link.product_id) !== Number(film.id)) continue
      const tool = byId.get(Number(link.addon_id))
      if (!tool || tool.sale_unit !== 'piece') continue
      tools.push({ id: Number(tool.id), name: tool.name_ar, isActive: tool.is_active })
      if (tool.is_active) linked.add(Number(tool.id))
    }
    films.push({ id: Number(film.id), name: film.name_ar, tools })
  }
  const unlinkedPieces = products.rows
    .filter((row) => row.sale_unit === 'piece' && row.is_active && !linked.has(Number(row.id)))
    .map((row) => ({ id: Number(row.id), name: row.name_ar }))
  return { films, unlinkedPieces }
}

type TextField = 'title' | 'description' | 'videoNote' | 'browseButtonLabel' | 'checkoutButtonLabel'
type TextResult = { ok: true; value: string } | { ok: false; code: 'VALIDATION'; message: string }

function readText(input: Record<string, unknown>, field: TextField, label: string, required: boolean): TextResult {
  const value = input[field]
  if (typeof value !== 'string') return { ok: false, code: 'VALIDATION', message: label + ' مش صحيح' }
  const text = value.trim()
  const max = INSTALLATION_TOOLS_PAGE_LIMITS[field]
  if (text.length > max) return { ok: false, code: 'VALIDATION', message: label + ' أطول من ' + String(max) + ' حرف' }
  if (required && text === '') return { ok: false, code: 'VALIDATION', message: 'اكتب ' + label }
  return { ok: true, value: text }
}

function samePage(a: InstallationToolsPage, b: InstallationToolsPage): boolean {
  return (
    a.enabled === b.enabled &&
    a.title === b.title &&
    a.description === b.description &&
    a.videoNote === b.videoNote &&
    a.browseButtonLabel === b.browseButtonLabel &&
    a.checkoutButtonLabel === b.checkoutButtonLabel
  )
}

/** rawExpected: updated_at اللي اللوحة شافته، أو null لو الصف مكانش موجود. */
export async function saveInstallationToolsPage(raw: unknown, rawExpected: unknown): Promise<MutationResult<ToolsPageRecord>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION', message: 'البيانات مش صحيحة' }
  }
  const input = raw as Record<string, unknown>
  const enabled = input['enabled']
  if (typeof enabled !== 'boolean') return { ok: false, code: 'VALIDATION', message: 'مفتاح تشغيل الصفحة مش صحيح' }

  const title = readText(input, 'title', 'عنوان الصفحة', true)
  if (!title.ok) return title
  const description = readText(input, 'description', 'الوصف', false)
  if (!description.ok) return description
  const videoNote = readText(input, 'videoNote', 'ملاحظة الفيديو', false)
  if (!videoNote.ok) return videoNote
  const browse = readText(input, 'browseButtonLabel', 'نص زرار الأدوات', true)
  if (!browse.ok) return browse
  const checkout = readText(input, 'checkoutButtonLabel', 'نص زرار إتمام الطلب', true)
  if (!checkout.ok) return checkout

  const value: InstallationToolsPage = {
    enabled,
    title: title.value,
    description: description.value,
    videoNote: videoNote.value,
    browseButtonLabel: browse.value,
    checkoutButtonLabel: checkout.value,
  }

  try {
    if (rawExpected === null) {
      try {
        await restInsert('settings', { key: KEY, value })
      } catch (error) {
        // حد تاني عمل الصف في نفس اللحظة → تعارض حقيقي، مش كتابة فوقه
        const now = await readInstallationToolsPage()
        if (now.updatedAt !== null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
        return toInternalFailure(error)
      }
    } else {
      const stamp = timestamp(rawExpected, 'طابع آخر تعديل')
      if (!stamp.ok) return stamp
      const result = await patchGuarded<{ key: string }>({
        table: 'settings',
        idColumn: 'key',
        idValue: KEY,
        expectedUpdatedAt: stamp.value,
        changes: { value },
        select: 'key',
      })
      if (!result.ok) return result
    }

    const stored = await readInstallationToolsPage()
    if (stored.updatedAt === null || !samePage(stored.page, value)) return toInternalFailure(null)
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
