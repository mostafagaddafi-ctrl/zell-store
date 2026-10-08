import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/installationToolsPage.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { parseInstallationToolsPage } from '@zell/core'
import { restGet } from './client'
import type { InstallationToolsPage } from '@zell/core'

export type ToolsPageRecord = { page: InstallationToolsPage; updatedAt: string | null }

export type ToolsSummary = {
  /** كل فيلم بالمقاس نشط وأدواته المربوطة (عرض بس). */
  films: { id: number; name: string; tools: { id: number; name: string; isActive: boolean }[] }[]
  /** منتجات بالعدد نشطة مش مربوطة بأي فيلم نشط — مش هتظهر في صفحة الأدوات. */
  unlinkedPieces: { id: number; name: string }[]
}

export type ProductLite = { id: number; name_ar: string; is_active: boolean; sale_unit: string }

export type AddonLink = { product_id: number; addon_id: number; sort_order: number }

export const KEY = 'installation_tools_page'

export async function readInstallationToolsPage(): Promise<ToolsPageRecord> {
  const rows = await restGet<{ value: unknown; updated_at: string }>(
    'settings',
    'select=value,updated_at&key=eq.' + KEY + '&limit=1',
  )
  const row = rows.rows[0]
  return { page: parseInstallationToolsPage(row?.value), updatedAt: row ? row.updated_at : null }
}

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
