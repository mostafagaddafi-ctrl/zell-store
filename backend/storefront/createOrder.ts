/**
 * إنشاء الطلب من السلة — عبارة SQL واحدة ذرّية بتقرا الأسعار والشحن من الداتابيز.
 * أي سعر أو إجمالي جاي من الواجهة بيتجاهل تماماً.
 * الإشعار بيتبعت بعد نجاح الطلب وما يقدرش يوقّعه.
 */
import { CREATE_ORDER_SQL, type CreatedOrderRow } from '../lib/createOrderSql'
import { loadSettings, settingRecord, settingString } from '../lib/db'
import { generateOrderNumber, isDuplicateOrderNumberError } from '../lib/orderNumber'
import { sendOrderNotification } from '../lib/notifyTransport'
import { validateLength } from '../lib/pricing'

export type CartItemParam = { productId: number; lengthCm: number }

export type CreateOrderParams = {
  items: CartItemParam[]
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes?: string
}

export type CreateOrderResult =
  | { ok: true; order: CreatedOrderRow; notified: boolean }
  | { ok: false; message: string }

const MAX_ATTEMPTS = 5
const MAX_ITEMS = 20

export default async function (req: { params: CreateOrderParams }): Promise<CreateOrderResult> {
  const p = req.params

  const name = (p.customerName ?? '').trim()
  const phone = (p.customerPhone ?? '').trim()
  const governorate = (p.governorate ?? '').trim()
  const address = (p.address ?? '').trim()
  const items = Array.isArray(p.items) ? p.items : []

  if (items.length === 0) return { ok: false, message: 'السلة فاضية' }
  if (items.length > MAX_ITEMS) return { ok: false, message: 'عدد الأصناف كبير جداً في طلب واحد' }
  for (const item of items) {
    if (!Number.isInteger(item?.productId) || item.productId <= 0) return { ok: false, message: 'صنف غير صحيح في السلة' }
    if (!Number.isInteger(item?.lengthCm) || item.lengthCm <= 0) return { ok: false, message: 'طول غير صحيح في السلة' }
  }
  if (name.length < 3) return { ok: false, message: 'من فضلك اكتب الاسم بالكامل' }
  if (!/^01[0125][0-9]{8}$/.test(phone)) return { ok: false, message: 'رقم الموبايل غير صحيح' }
  if (!governorate) return { ok: false, message: 'اختر المحافظة' }
  if (address.length < 8) return { ok: false, message: 'من فضلك اكتب عنوان التوصيل بالتفصيل' }

  const settings = await loadSettings()
  const rates = settingRecord(settings, 'shipping_rates')
  if (Object.keys(rates).length > 0 && !(governorate in rates)) {
    return { ok: false, message: 'المحافظة دي مش ضمن مناطق الشحن المتاحة' }
  }

  const itemsJson = JSON.stringify(items.map((i) => ({ productId: i.productId, lengthCm: i.lengthCm })))

  let created: CreatedOrderRow | undefined
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !created; attempt++) {
    const orderNumber = generateOrderNumber()
    try {
      const result = await supabase.query<CreatedOrderRow>(CREATE_ORDER_SQL, [
        itemsJson,
        governorate,
        orderNumber,
        name,
        phone,
        address,
        p.notes ?? '',
      ])
      if (result.data.length === 0) return { ok: false, message: await rejectionReason(items) }
      created = result.data[0] as CreatedOrderRow
    } catch (err) {
      lastError = err
      if (!isDuplicateOrderNumberError(err)) throw err
    }
  }

  if (!created) {
    throw new Error(`تعذّر إنشاء رقم طلب فريد: ${String((lastError as { message?: string })?.message ?? lastError)}`)
  }

  // الإشعار — مايوقّعش الطلب أبداً
  let notified = false
  try {
    const result = await sendOrderNotification(
      { ...created, notes: p.notes ?? null },
      {
        notify_email: settingString(settings, 'notify_email'),
        store_name: settingString(settings, 'store_name', 'المتجر'),
      },
    )
    notified = result.ok
    if (result.ok) {
      await supabase.query('update orders set notified_at = now(), notify_error = null where id = $1', [created.id])
    } else {
      await supabase.query('update orders set notify_error = $1 where id = $2', [
        result.error ?? 'فشل غير معروف',
        created.id,
      ])
    }
  } catch (err) {
    try {
      await supabase.query('update orders set notify_error = $1 where id = $2', [
        String((err as { message?: string })?.message ?? err),
        created.id,
      ])
    } catch {
      // تجاهل: تسجيل فشل الإشعار ما يأثرش على الطلب
    }
  }

  return { ok: true, order: created, notified }
}

/** صفر صفوف = رفض — نلاقي أول صنف غلط ونرجّع سبب واضح. */
async function rejectionReason(items: CartItemParam[]): Promise<string> {
  const ids = items.map((i) => i.productId)
  const result = await supabase.query<{
    id: number
    name_ar: string
    is_active: boolean
    price_per_meter_piastres: number
    min_length_cm: number
    step_cm: number
    max_length_cm: number
  }>(
    `select id, name_ar, is_active, price_per_meter_piastres, min_length_cm, step_cm, max_length_cm
     from products where id = any($1::int[])`,
    [ids],
  )

  for (const item of items) {
    const product = result.data.find((row) => row.id === item.productId)
    if (!product) return 'فيه صنف في السلة مش موجود، امسحه وجرّب تاني'
    if (!product.is_active) return `«${product.name_ar}» مش متاح للطلب حالياً`
    const check = validateLength(item.lengthCm, product)
    if (!check.ok) return `«${product.name_ar}»: ${check.message}`
  }
  return 'تعذّر إنشاء الطلب، حاول تاني أو كلّمنا على واتساب'
}
