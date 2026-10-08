import 'server-only'

import { restGet, restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { readProductWidths } from '../data/productWidths'

/**
 * عروض الرول الإضافية لمنتج (0015) — public.product_widths.
 *
 * العرض الأساسي وسعره في المنتج نفسه (products.width_cm / price_per_meter_piastres)
 * وبيتعدّلوا من «السعر والمقاسات». هنا العروض **التانية** بس، كل واحد بسعره.
 * الحفظ استبدال كامل وذرّي عن طريق zell_set_product_widths.
 */
export type AdminWidth = {
  widthCm: number
  pricePerMeterPiastres: number
  compareAtPiastres: number | null
  isActive: boolean
}

const MAX_WIDTHS = 10
const MAX_WIDTH_CM = 1000
const MAX_PRICE = 100000000

export type Row = { width_cm: number; price_per_meter_piastres: number; compare_at_piastres: number | null; is_active: boolean }

function isPositiveInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
}

export async function saveProductWidths(productId: unknown, raw: unknown): Promise<MutationResult<AdminWidth[]>> {
  if (!isPositiveInt(productId, 2147483647)) return { ok: false, code: 'VALIDATION', message: 'المنتج مش صحيح' }
  if (!Array.isArray(raw)) return { ok: false, code: 'VALIDATION', message: 'العروض مش صحيحة' }
  if (raw.length > MAX_WIDTHS) {
    return { ok: false, code: 'VALIDATION', message: 'أقصى عدد عروض إضافية ' + String(MAX_WIDTHS) }
  }

  const rows: AdminWidth[] = []
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) return { ok: false, code: 'VALIDATION', message: 'العروض مش صحيحة' }
    const entry = item as Record<string, unknown>
    const widthCm = entry['widthCm']
    const price = entry['pricePerMeterPiastres']
    const compare = entry['compareAtPiastres']
    const isActive = entry['isActive']
    if (!isPositiveInt(widthCm, MAX_WIDTH_CM)) {
      return { ok: false, code: 'VALIDATION', message: 'العرض لازم يكون رقم صحيح من ١ لـ ' + String(MAX_WIDTH_CM) + ' سم' }
    }
    if (!isPositiveInt(price, MAX_PRICE)) {
      return { ok: false, code: 'VALIDATION', message: 'سعر المتر لعرض ' + String(widthCm) + ' سم لازم يكون أكبر من صفر' }
    }
    let compareAt: number | null = null
    if (compare !== null && compare !== undefined && compare !== 0) {
      if (!isPositiveInt(compare, MAX_PRICE) || compare <= price) {
        return {
          ok: false,
          code: 'VALIDATION',
          message: 'السعر قبل الخصم لعرض ' + String(widthCm) + ' سم لازم يكون أكبر من سعر المتر — أو سيبه فاضي',
        }
      }
      compareAt = compare
    }
    if (typeof isActive !== 'boolean') return { ok: false, code: 'VALIDATION', message: 'العروض مش صحيحة' }
    if (rows.some((row) => row.widthCm === widthCm)) {
      return { ok: false, code: 'VALIDATION', message: 'العرض ' + String(widthCm) + ' سم متكرر' }
    }
    rows.push({ widthCm, pricePerMeterPiastres: price, compareAtPiastres: compareAt, isActive })
  }

  try {
    const product = await restGet<{ width_cm: number }>('products', 'select=width_cm&id=eq.' + String(productId) + '&limit=1')
    const base = product.rows[0]
    if (!base) return { ok: false, code: 'NOT_FOUND', message: 'المنتج مش موجود. يمكن يكون اتمسح.' }
    const clash = rows.find((row) => row.widthCm === Number(base.width_cm))
    if (clash) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'العرض ' + String(clash.widthCm) + ' سم هو العرض الأساسي للمنتج — امسحه من هنا أو غيّر العرض الأساسي',
      }
    }

    await restRpc<number>('zell_set_product_widths', { p_product_id: productId, p_rows: rows })
    const saved = await readProductWidths(productId)
    if (saved.length !== rows.length) return toInternalFailure(null)
    return { ok: true, data: saved }
  } catch (error) {
    return toInternalFailure(error)
  }
}
