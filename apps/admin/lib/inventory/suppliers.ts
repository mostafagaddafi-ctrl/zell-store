/**
 * الموردين — منطق خالص: تحويل النموذج، والتحقق، وفحص شكل ردود الـRPC.
 *
 * من غير server-only عن قصد: النموذج بيتحقق قبل الإرسال، والسيرفر بيعيد **نفس** التحقق قبل النداء.
 * الحدود نفس دوال 0020 بالحرف (zell_inv_create_supplier / zell_inv_update_supplier):
 *   • الاسم: NFC + trim لـ[مسافة \t \r \n]، من 1 لـ 120 حرف (code points).
 *   • التليفون: NFC + شيل المسافات والشَرط، وبعدها ^\+?[0-9]{6,15}$ أو فاضي.
 *     الأرقام العربية (٠–٩ و ۰–۹) بتتحول لإنجليزي قبل الفحص — الداتابيز بترفضها.
 *   • الملاحظة: NFC + trim، لحد 500 حرف، والفاضية = null.
 * والداتابيز هي الحكم الأخير في كل حال.
 */

export const SUPPLIER_NAME_MAX = 120
export const SUPPLIER_NOTE_MAX = 500
export const SUPPLIERS_PAGE_SIZE = 25

export type SupplierInput = { name: string; phone: string | null; note: string | null }
export type SupplierUpdateInput = SupplierInput & { isActive: boolean }

export type SupplierFormState = { name: string; phone: string; note: string; isActive: boolean }

export type InventorySupplier = {
  supplierId: number
  name: string
  phone: string | null
  note: string | null
  isActive: boolean
  version: number
  updatedAt: string
}

export type SuppliersPage = { items: InventorySupplier[]; nextAfterNameKey: string | null }

export type SupplierWriteResult = { supplierId: number; version: number; replayed?: boolean }

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

// ── التحويل والتحقق ──────────────────────────────────────────

/** نفس btrim(normalize(x, NFC), E' \t\r\n') في الداتابيز. */
function dbTrim(value: string): string {
  return value.normalize('NFC').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

/** char_length في Postgres = عدد code points، مش وحدات UTF-16. */
function codePoints(value: string): number {
  return Array.from(value).length
}

function latinDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

const PHONE = /^\+?[0-9]{6,15}$/

function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return undefined
}

export function normalizeSupplierInput(raw: unknown): Parsed<SupplierInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'بيانات المورد غير صالحة.' }
  }
  const source = raw as Record<string, unknown>

  const rawName = source['name']
  if (typeof rawName !== 'string') return { ok: false, message: 'اسم المورد مطلوب.' }
  const name = dbTrim(rawName)
  if (name === '') return { ok: false, message: 'اسم المورد مطلوب.' }
  if (codePoints(name) > SUPPLIER_NAME_MAX) {
    return { ok: false, message: 'اسم المورد أطول من ' + String(SUPPLIER_NAME_MAX) + ' حرف.' }
  }

  const rawPhone = optionalText(source['phone'])
  if (rawPhone === undefined) return { ok: false, message: 'رقم التليفون غير صالح.' }
  const phoneDigits = rawPhone === null ? '' : latinDigits(rawPhone.normalize('NFC')).replace(/[\s-]/g, '')
  const phone = phoneDigits === '' ? null : phoneDigits
  if (phone !== null && !PHONE.test(phone)) {
    return { ok: false, message: 'رقم التليفون لازم يكون من 6 لـ 15 رقم، وممكن يبدأ بـ +.' }
  }

  const rawNote = optionalText(source['note'])
  if (rawNote === undefined) return { ok: false, message: 'الملاحظة غير صالحة.' }
  const noteTrimmed = rawNote === null ? '' : dbTrim(rawNote)
  const note = noteTrimmed === '' ? null : noteTrimmed
  if (note !== null && codePoints(note) > SUPPLIER_NOTE_MAX) {
    return { ok: false, message: 'الملاحظة أطول من ' + String(SUPPLIER_NOTE_MAX) + ' حرف.' }
  }

  return { ok: true, value: { name, phone, note } }
}

export function normalizeSupplierUpdate(raw: unknown): Parsed<SupplierUpdateInput> {
  const base = normalizeSupplierInput(raw)
  if (!base.ok) return base
  const isActive = (raw as Record<string, unknown>)['isActive']
  if (typeof isActive !== 'boolean') return { ok: false, message: 'حالة المورد غير صالحة.' }
  return { ok: true, value: { ...base.value, isActive } }
}

export function emptySupplierForm(): SupplierFormState {
  return { name: '', phone: '', note: '', isActive: true }
}

export function supplierToForm(supplier: InventorySupplier): SupplierFormState {
  return {
    name: supplier.name,
    phone: supplier.phone ?? '',
    note: supplier.note ?? '',
    isActive: supplier.isActive,
  }
}

/** مؤشر keyset للصفحة الجاية (name_key). أي حاجة غير نص معقول = أول صفحة. */
export function parseSupplierCursor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw === '' || codePoints(raw) > 400) return null
  return raw
}

// ── فحص شكل الردود ───────────────────────────────────────────

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

export function isInventorySupplier(value: unknown): value is InventorySupplier {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    isPositiveInteger(row['supplierId']) &&
    typeof row['name'] === 'string' &&
    isNullableString(row['phone']) &&
    isNullableString(row['note']) &&
    typeof row['isActive'] === 'boolean' &&
    isPositiveInteger(row['version']) &&
    typeof row['updatedAt'] === 'string'
  )
}

export function isSuppliersPage(value: unknown): value is SuppliersPage {
  if (typeof value !== 'object' || value === null) return false
  const page = value as Record<string, unknown>
  const items = page['items']
  return Array.isArray(items) && items.every(isInventorySupplier) && isNullableString(page['nextAfterNameKey'] ?? null)
}

export function isSupplierWriteResult(value: unknown): value is SupplierWriteResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  const replayed = result['replayed']
  return (
    isPositiveInteger(result['supplierId']) &&
    isPositiveInteger(result['version']) &&
    (replayed === undefined || typeof replayed === 'boolean')
  )
}
