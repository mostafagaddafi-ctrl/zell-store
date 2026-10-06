'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { setCouponActiveAction } from '../../lib/couponActions'
import { couponLimitLabel, couponValueLabel, couponWindowLabel, type AdminCoupon } from '../../lib/coupons/form'
import { formatPiastres } from '../../lib/format'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Card } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { CouponForm } from './CouponForm'

type Editing = { mode: 'create' } | { mode: 'edit'; coupon: AdminCoupon } | null

/**
 * قايمة الكوبونات + الإنشاء والتعديل والتفعيل/الإيقاف. مفيش حذف (الإيقاف هو البديل).
 * الاستخدامات = أوردرات غير ملغية، جاية مع القايمة في نفس الطلب.
 */
export function CouponsList({ rows }: { rows: AdminCoupon[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const [editing, setEditing] = useState<Editing>(null)
  const { state, failure, run, retry } = useSaveAction()
  const [busyId, setBusyId] = useState<string | null>(null)

  function toggleActive(coupon: AdminCoupon) {
    setBusyId(coupon.id)
    void run(() => setCouponActiveAction(coupon.id, !coupon.isActive, coupon.updatedAt), {
      onSuccess: () => router.refresh(),
    }).finally(() => setBusyId(null))
  }

  return (
    <div className="space-y-4">
      {editing !== null ? (
        <CouponForm
          key={editing.mode === 'edit' ? editing.coupon.id + ':' + editing.coupon.updatedAt : 'new'}
          coupon={editing.mode === 'edit' ? editing.coupon : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      ) : null}

      <Card
        title="الكوبونات"
        actions={
          <Button size="sm" disabled={!mutationsOn || editing !== null} onClick={() => setEditing({ mode: 'create' })}>
            <Plus className="h-3.5 w-3.5" />
            كوبون جديد
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="مفيش كوبونات لسه" description="اعمل أول كوبون، وبعدها شغّل أكواد الخصم من فوق." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((coupon) => (
              <li key={coupon.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <bdi dir="ltr" className="font-mono text-sm font-bold text-fg">
                      {coupon.code}
                    </bdi>
                    <Badge tone={coupon.isActive ? 'ok' : 'neutral'}>{coupon.isActive ? 'فعّال' : 'متوقف'}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!mutationsOn || editing !== null}
                      onClick={() => setEditing({ mode: 'edit', coupon })}
                    >
                      تعديل
                    </Button>
                    <Button
                      variant={coupon.isActive ? 'danger' : 'secondary'}
                      size="sm"
                      disabled={!mutationsOn || state === 'saving'}
                      onClick={() => toggleActive(coupon)}
                    >
                      {busyId === coupon.id ? 'بيحفظ…' : coupon.isActive ? 'إيقاف' : 'تفعيل'}
                    </Button>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  <Item label="الخصم" value={(coupon.kind === 'percent' ? 'نسبة ' : 'مبلغ ثابت ') + couponValueLabel(coupon)} />
                  <Item
                    label="الحد الأدنى للأصناف"
                    value={coupon.minSubtotalPiastres === 0 ? 'من غير حد' : formatPiastres(coupon.minSubtotalPiastres)}
                  />
                  <Item label="الاستخدامات (غير الملغية)" value={String(coupon.uses)} />
                  <Item label="الحد الإجمالي" value={couponLimitLabel(coupon.maxUses)} />
                  <Item label="الحد لكل موبايل" value={couponLimitLabel(coupon.maxUsesPerPhone)} />
                  <Item label="المدة" value={couponWindowLabel(coupon)} wide />
                </dl>
                {coupon.internalNote ? <p className="text-xs text-muted">{coupon.internalNote}</p> : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
        </div>
      </Card>
    </div>
  )
}

function Item({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  )
}
