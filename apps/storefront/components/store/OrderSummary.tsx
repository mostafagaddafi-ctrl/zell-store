import type { ReactNode } from 'react'
import { Gift } from 'lucide-react'
import { formatPiastres } from '@zell/core'
import { DISCOUNT_SIGN } from '../../lib/orders/coupon'
import { estimatedTotalPiastres } from '../../lib/orders/couponCheckout'
import { Num } from './Num'

/** ملخص الحساب — نفس الصندوق في السلة وفي بيانات التوصيل. */
export function OrderSummary({
  subtotalPiastres,
  shippingPiastres,
  action,
  note,
  trustLine,
  gift,
  installationPiastres,
  installationTravelPiastres,
  discount,
}: {
  subtotalPiastres: number
  /** null = المحافظة لسه مش متحددة */
  shippingPiastres: number | null
  action?: ReactNode
  note?: string
  /** «سطر الطمأنة» من «المحتوى» في اللوحة. فاضي = مايظهرش. */
  trustLine?: string
  /** «نص العرض» لو ظاهر — سطر «هدية» في الحساب، مش بيأثر على الإجمالي. */
  gift?: string
  /**
   * 0018 — أجر التركيب وانتقال الفني (للعرض؛ المعتمد من الداتابيز).
   * الاتنين أرقام = فني مختار ومنطقته متاحة. غير كده مابيظهروش.
   */
  installationPiastres?: number | null
  installationTravelPiastres?: number | null
  /** 0019 — تقدير الخصم من شروط المعاينة (المعتمد من الداتابيز وقت الطلب). ناقص/null = مفيش سطر. */
  discount?: { code: string; piastres: number } | null
}) {
  const line = trustLine ?? 'الدفع عند الاستلام · توصيل لكل محافظات مصر'
  const installationShown = typeof installationPiastres === 'number' && typeof installationTravelPiastres === 'number'
  // 0019 — الخصم على الأصناف بس: subtotal − الخصم + الشحن + الفني + الانتقال (من غير خصم = نفس الحساب القديم)
  const total = estimatedTotalPiastres({
    subtotalPiastres,
    discountPiastres: discount ? discount.piastres : 0,
    shippingPiastres,
    installationPiastres: installationShown ? (installationPiastres ?? null) : null,
    travelPiastres: installationShown ? (installationTravelPiastres ?? null) : null,
  })

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-bold text-fg">ملخص الطلب</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <Row label="الأصناف" value={<Num>{formatPiastres(subtotalPiastres)}</Num>} />
        {discount ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="min-w-0 truncate text-muted">
              خصم (<bdi className="font-mono">{discount.code}</bdi>)
            </dt>
            <dd className="shrink-0 font-semibold text-accent">
              <Num>{DISCOUNT_SIGN + formatPiastres(discount.piastres)}</Num>
            </dd>
          </div>
        ) : null}
        <Row
          label="الشحن"
          value={
            shippingPiastres === null ? (
              <span className="text-muted">بعد اختيار المحافظة</span>
            ) : (
              <Num>{formatPiastres(shippingPiastres)}</Num>
            )
          }
        />
        {typeof installationPiastres === 'number' && typeof installationTravelPiastres === 'number' ? (
          <>
            <Row label="أجر التركيب" value={<Num>{formatPiastres(installationPiastres)}</Num>} />
            <Row
              label="انتقال الفني"
              value={
                installationTravelPiastres === 0 ? (
                  <span className="text-accent">مجاني</span>
                ) : (
                  <Num>{formatPiastres(installationTravelPiastres)}</Num>
                )
              }
            />
          </>
        ) : null}
        {gift ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="flex min-w-0 items-center gap-1.5 text-muted">
              <Gift className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate">{gift}</span>
            </dt>
            <dd className="shrink-0 font-semibold text-accent">هدية</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <dt className="text-base font-bold text-fg">الإجمالي</dt>
          <dd className="text-lg font-extrabold text-brand">
            <Num>{formatPiastres(total)}</Num>
          </dd>
        </div>
      </dl>

      {line ? <p className="mt-3 text-xs text-muted">{line}</p> : null}

      {action ? <div className="mt-4">{action}</div> : null}
      {note ? <p className="mt-3 text-xs text-muted">{note}</p> : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-fg">{value}</dd>
    </div>
  )
}
