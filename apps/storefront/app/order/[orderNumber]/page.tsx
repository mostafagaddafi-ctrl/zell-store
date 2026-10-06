import Link from 'next/link'
import { cookies } from 'next/headers'
import { CheckCircle2 } from 'lucide-react'
import { formatLength, formatPiastres, isValidOrderNumber } from '@zell/core'
import { restRpc, type RpcResult } from '../../../lib/data/rpc'
import type { Receipt } from '../../../lib/orders/contracts'
import { DISCOUNT_SIGN, discountLine } from '../../../lib/orders/coupon'
import { receiptCookieName, receiptTokenHash } from '../../../lib/orders/receiptToken'
import { Container } from '../../../components/ui/Container'
import { buttonClasses } from '../../../components/ui/Button'
import { Num } from '../../../components/store/Num'

/**
 * صفحة الإيصال — ORDER-FLOW-PLAN.md §6.5.
 *
 * 🔒 الوصول بكوكي HttpOnly مقيّدة بمسار الطلب. **مفيش سر في أي URL** —
 *    لا query ولا path (ب٨). الكوكي بتتقرا سيرفر-سايد بس.
 *
 * ⚠️ حالة «غير متاح» **واحدة لكل الأسباب** (§6.7): شكل غلط · مفيش كوكي ·
 *    الطلب مش موجود · الرمز غلط · النافذة خلصت. التمييز بينهم بيخلّي الصفحة
 *    oracle لتعداد أرقام الطلبات.
 */

export const dynamic = 'force-dynamic'

// الصفحة دي عمرها ما تتفهرس: محتواها شخصي ومربوط بكوكي متصفح واحد.
export const metadata = {
  robots: { index: false, follow: false },
}

// توقيت ثابت مناسب للزبون — مش توقيت السيرفر (UTC على Vercel).
const TIME_ZONE = 'Africa/Cairo'

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/**
 * حارس كامل لشكل إسقاط الإيصال.
 *
 * ⚠️ لازم يعدّي **قبل** أي عرض: أي شكل غير متوقع لو وصل الـrender بيرمي جوه
 *    الـrender (مثلاً items.map على حاجة مش مصفوفة) فيطلع صفحة خطأ من Next —
 *    وده بيكسر قاعدة «حالة غير متاح واحدة لكل الأسباب» ويكشف إن في حاجة
 *    مختلفة حصلت. الشكل مضمون من دالة منشورة، والحارس ده للانحراف المستقبلي.
 */
function isReceipt(value: unknown): value is Receipt {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  if (typeof candidate['order_number'] !== 'string') return false
  if (typeof candidate['created_at'] !== 'string') return false
  if (typeof candidate['governorate'] !== 'string') return false
  if (typeof candidate['first_name'] !== 'string') return false
  if (typeof candidate['phone_last4'] !== 'string') return false
  if (!isFiniteInteger(candidate['subtotal_piastres'])) return false
  if (!isFiniteInteger(candidate['shipping_piastres'])) return false
  if (!isFiniteInteger(candidate['total_piastres'])) return false

  // 0018 — أرقام التركيب لازم تكون صحيحة لو الطلب فيه فني
  if (candidate['installation_requested'] === true) {
    if (!isFiniteInteger(candidate['installation_piastres'])) return false
    if (!isFiniteInteger(candidate['installation_travel_piastres'])) return false
  }

  // 0019 — الخصم لو موجود لازم رقم صحيح مش سالب، والكود نص أو null
  const discount = candidate['discount_piastres']
  if (discount !== undefined && !(isFiniteInteger(discount) && discount >= 0)) return false
  const couponCode = candidate['coupon_code']
  if (couponCode !== undefined && couponCode !== null && typeof couponCode !== 'string') return false

  const items = candidate['items']
  if (!Array.isArray(items)) return false
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) return false
    const item = entry as Record<string, unknown>
    if (typeof item['product_name_ar'] !== 'string') return false
    // 0016 — سطر القطعة: عدد من غير طول/عرض
    if (item['sale_unit'] === 'piece') {
      if (!isFiniteInteger(item['quantity'])) return false
    } else {
      if (!isFiniteInteger(item['length_cm'])) return false
      if (!isFiniteInteger(item['width_cm'])) return false
    }
    if (!isFiniteInteger(item['line_total_piastres'])) return false
  }

  return true
}

function Unavailable() {
  return (
    <Container className="py-16">
      <div className="mx-auto max-w-lg rounded-lg border border-border bg-card px-6 py-12 text-center">
        <h1 className="text-lg font-bold text-fg">الإيصال غير متاح</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          الرابط ده مش شغّال من المتصفح ده، أو النافذة خلصت. لو عندك طلب مسجّل كلّمنا على واتساب
          وإحنا نراجعه معاك.
        </p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-6 inline-flex')}>
          رجوع للمتجر
        </Link>
      </div>
    </Container>
  )
}

export default async function OrderReceiptPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>
}) {
  const { orderNumber } = await params
  if (!isValidOrderNumber(orderNumber)) return <Unavailable />

  const store = await cookies()
  const secret = (store.get(receiptCookieName(orderNumber))?.value ?? '').trim()
  if (secret === '') return <Unavailable />

  let hash: string
  try {
    hash = await receiptTokenHash(secret)
  } catch {
    return <Unavailable />
  }

  // ⚠️ restRpc بترمي لو الـcredentials ناقصة. أي استثناء لازم ينزل على **نفس**
  //    حالة «غير متاح» العامة — مش صفحة خطأ من Next، ومن غير أي تمييز يقول
  //    هل الطلب موجود ولا لأ.
  let result: RpcResult<Receipt | null>
  try {
    result = await restRpc<Receipt | null>('zell_get_order_receipt', {
      p_order_number: orderNumber,
      p_receipt_token_hash: hash,
    })
  } catch (error) {
    console.error('[receipt] rpc threw :: ' + (error instanceof Error ? error.name : 'unknown'))
    return <Unavailable />
  }

  if (!result.ok) {
    console.error('[receipt] lookup failed :: ' + result.sqlMessage)
    return <Unavailable />
  }
  if (!isReceipt(result.data)) {
    // null = مش موجود / رمز غلط / النافذة خلصت — ومفيش تمييز بينهم عن قصد.
    if (result.data !== null) console.error('[receipt] unexpected projection shape')
    return <Unavailable />
  }

  const receipt = result.data
  // 0019 — سطر الخصم من اللقطة؛ null للأوردر القديم أو من غير كوبون (العرض زي ما هو بالظبط)
  const discount = discountLine(receipt.coupon_code, receipt.discount_piastres)

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex gap-3 rounded-lg border border-border bg-card p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="space-y-1">
            <h1 className="text-base font-bold text-fg">تم تسجيل طلبك</h1>
            <p className="text-xs leading-relaxed text-muted">
              هنكلّمك على الرقم المنتهي بـ<Num>{receipt.phone_last4}</Num> لتأكيد الطلب والتوصيل. الدفع عند
              الاستلام.
            </p>
            {receipt.installation_requested === true ? (
              <p className="text-xs leading-relaxed text-muted">وهنتفق معاك على معاد فني التركيب.</p>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div className="bg-card p-4">
            <dt className="text-xs text-muted">رقم الطلب</dt>
            <dd className="mt-1 font-mono text-sm font-bold text-fg">{receipt.order_number}</dd>
          </div>
          <div className="bg-card p-4">
            <dt className="text-xs text-muted">الاسم</dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{receipt.first_name}</dd>
          </div>
          <div className="bg-card p-4">
            <dt className="text-xs text-muted">المحافظة</dt>
            <dd className="mt-1 text-sm font-semibold text-fg">{receipt.governorate}</dd>
          </div>
          <div className="bg-card p-4">
            <dt className="text-xs text-muted">تاريخ الطلب</dt>
            <dd className="mt-1 text-sm font-semibold text-fg">
              <Num>{new Date(receipt.created_at).toLocaleDateString('ar-EG', { timeZone: TIME_ZONE })}</Num>
            </dd>
          </div>
        </dl>

        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          {receipt.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-fg">{item.product_name_ar}</p>
                <p className="text-xs text-muted">
                  <Num>
                    {item.sale_unit === 'piece'
                      ? 'الكمية ' + String(item.quantity ?? 1)
                      : formatLength(item.length_cm ?? 0)}
                  </Num>
                </p>
              </div>
              <span className="shrink-0 font-semibold text-fg">
                <Num>{formatPiastres(item.line_total_piastres)}</Num>
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <div className="flex justify-between text-muted">
            <span>الإجمالي الفرعي</span>
            <span><Num>{formatPiastres(receipt.subtotal_piastres)}</Num></span>
          </div>
          <div className="flex justify-between text-muted">
            <span>الشحن</span>
            <span><Num>{formatPiastres(receipt.shipping_piastres)}</Num></span>
          </div>
          {receipt.installation_requested === true ? (
            <>
              <div className="flex justify-between gap-3 text-muted">
                <span>
                  أجر التركيب
                  {typeof receipt.installation_length_cm === 'number' && typeof receipt.installation_rate_piastres === 'number' ? (
                    <span className="text-xs">
                      {' '}
                      (<Num>{formatLength(receipt.installation_length_cm) + ' × ' + formatPiastres(receipt.installation_rate_piastres)}</Num>{' '}
                      للمتر)
                    </span>
                  ) : null}
                </span>
                <span><Num>{formatPiastres(receipt.installation_piastres ?? 0)}</Num></span>
              </div>
              <div className="flex justify-between text-muted">
                <span>انتقال الفني</span>
                <span>
                  {(receipt.installation_travel_piastres ?? 0) === 0 ? (
                    'مجاني'
                  ) : (
                    <Num>{formatPiastres(receipt.installation_travel_piastres ?? 0)}</Num>
                  )}
                </span>
              </div>
            </>
          ) : null}
          {discount !== null ? (
            <div className="flex justify-between gap-3 text-muted">
              <span>
                خصم (<bdi>{discount.code}</bdi>)
              </span>
              <span><Num>{DISCOUNT_SIGN + formatPiastres(discount.piastres)}</Num></span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-fg">
            <span>الإجمالي</span>
            <span><Num>{formatPiastres(receipt.total_piastres)}</Num></span>
          </div>
        </div>

        <p className="text-center text-xs text-muted">
          احفظ الصفحة دي. الرابط شغّال من المتصفح ده لمدة أسبوع.
        </p>
      </div>
    </Container>
  )
}
