import 'server-only'

import { parseHomeProducts, type HomeProducts, type HomeProductsMode } from '@zell/core'
import { restGet, restInsert, restPatch, sentinelOf } from '../data/client'
import { homeProductsSaveMessage } from '../products/deleteProduct'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { KEY } from '../data/homeProducts'

const MAX_LABEL = 30
const MAX_IDS = 200
const MODES: readonly HomeProductsMode[] = ['all', 'selected', 'none']

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
    // PRODUCT-DELETE (0022): trigger قايمة الرئيسية بيرفض id جديد لمنتج مش موجود (45507، اتحذف بعد فتح الصفحة)
    // = رسالة تحقق واضحة بدل الخطأ العام. والكتابة كلها بترجع في الداتابيز.
    const message = homeProductsSaveMessage(sentinelOf(error))
    if (message !== null) return { ok: false, code: 'VALIDATION', message }
    return toInternalFailure(error)
  }
}
