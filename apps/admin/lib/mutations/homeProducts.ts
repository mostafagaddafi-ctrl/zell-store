import 'server-only'

import { parseHomeProducts, type HomeProducts, type HomeProductsMode } from '@zell/core'
import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'

/**
 * «الصفحة الرئيسية» (settings.home_products):
 *   mode      all · selected · none — إيه اللي يظهر في جزء المنتجات في الرئيسية
 *   ids       المنتجات المختارة (لما mode = selected)
 *   allLabel  اسم رابط «كل المنتجات» في القائمة — فاضي = مخفي
 */
const KEY = 'home_products'
const MAX_LABEL = 30
const MAX_IDS = 200
const MODES: readonly HomeProductsMode[] = ['all', 'selected', 'none']

export type HomeProductOption = { id: number; nameAr: string; isActive: boolean }

export async function readHomeProducts(): Promise<{ settings: HomeProducts; products: HomeProductOption[] }> {
  const [rows, products] = await Promise.all([
    restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1'),
    restGet<{ id: number; name_ar: string; is_active: boolean }>('products', 'select=id,name_ar,is_active&order=sort_order.asc,id.asc'),
  ])
  return {
    settings: parseHomeProducts(rows.rows[0]?.value),
    products: products.rows.map((row) => ({ id: Number(row.id), nameAr: row.name_ar, isActive: row.is_active })),
  }
}

export async function saveHomeProducts(raw: unknown): Promise<MutationResult<HomeProducts>> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'VALIDATION', message: 'البيانات مش صحيحة' }
  const input = raw as Record<string, unknown>
  const mode = MODES.find((item) => item === input['mode'])
  if (mode === undefined) return { ok: false, code: 'VALIDATION', message: 'اختار إيه اللي يظهر في الرئيسية' }
  const rawLabel = input['allLabel']
  const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
  if (label.length > MAX_LABEL) return { ok: false, code: 'VALIDATION', message: 'اسم الرابط أطول من ' + String(MAX_LABEL) + ' حرف' }
  const rawIds: unknown = input['ids']
  if (!Array.isArray(rawIds) || rawIds.length > MAX_IDS) return { ok: false, code: 'VALIDATION', message: 'قايمة المنتجات مش صحيحة' }

  try {
    const existing = await restGet<{ id: number }>('products', 'select=id')
    const known = new Set(existing.rows.map((row) => Number(row.id)))
    const ids: number[] = []
    for (const id of rawIds as unknown[]) {
      if (typeof id !== 'number' || !known.has(id)) {
        return { ok: false, code: 'VALIDATION', message: 'في منتج مش موجود. اعمل تحديث للصفحة.' }
      }
      if (!ids.includes(id)) ids.push(id)
    }
    if (mode === 'selected' && ids.length === 0) {
      return { ok: false, code: 'VALIDATION', message: 'علّم على منتج واحد على الأقل، أو اختار «من غير منتجات».' }
    }

    const value: HomeProducts = { mode, ids, allLabel: label }
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value })

    const stored = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
    const saved = parseHomeProducts(stored.rows[0]?.value)
    if (saved.mode !== value.mode || saved.allLabel !== value.allLabel || saved.ids.join(',') !== value.ids.join(',')) {
      return toInternalFailure(null)
    }
    return { ok: true, data: saved }
  } catch (error) {
    return toInternalFailure(error)
  }
}
