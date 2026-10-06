'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setCouponsEnabledAction } from '../../lib/couponActions'
import { ENABLE_NEEDS_LIVE_MESSAGE } from '../../lib/coupons/form'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Card } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { Switch } from '../ui/Switch'

/**
 * مفتاح «أكواد الخصم» (settings.coupons_enabled) — المالك بس، وبتأكيد قبل أي تغيير.
 * التشغيل مقفول لحد ما يبقى فيه كوبون فعّال وساري (والسيرفر بيعيد نفس الفحص).
 */
export function CouponsToggle({ enabled, liveCount }: { enabled: boolean; liveCount: number }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry } = useSaveAction()
  const [pending, setPending] = useState<boolean | null>(null)

  const busy = state === 'saving'
  const canEnable = liveCount > 0

  function confirm() {
    const next = pending
    if (next === null) return
    setPending(null)
    void run(() => setCouponsEnabledAction(next), { onSuccess: () => router.refresh() })
  }

  return (
    <Card title="تشغيل أكواد الخصم" actions={<Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'شغّالة' : 'مقفولة'}</Badge>}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-fg">خانة «معاك كود خصم؟» في صفحة الطلب</p>
            <p className="text-xs text-muted">
              {enabled ? 'الخانة ظاهرة للعملاء.' : 'الخانة مخفية، وأي كود بيترفض في المتجر.'}
            </p>
          </div>
          <Switch
            checked={enabled}
            label="تشغيل أكواد الخصم"
            disabled={!mutationsOn || busy || (!enabled && !canEnable)}
            onChange={(next) => setPending(next)}
          />
        </div>

        {!enabled && !canEnable ? (
          <p role="status" className="rounded border border-border bg-bg p-2 text-xs text-fg">
            {ENABLE_NEEDS_LIVE_MESSAGE}
          </p>
        ) : null}
        {!enabled && canEnable ? <p className="text-xs text-muted">فيه {liveCount} كوبون فعّال وساري دلوقتي.</p> : null}
        {busy ? <p className="text-xs text-muted">بيحفظ…</p> : null}
        {warning ? (
          <p role="status" className="text-xs text-danger">
            {warning}
          </p>
        ) : null}

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? 'تشغيل أكواد الخصم' : 'إيقاف أكواد الخصم'}
        message={
          pending
            ? 'الخانة هتظهر للعملاء في صفحة الطلب بعد تحديث كاش المتجر (لحظي لو التحديث نجح، وإلا خلال دقايق). أي كوبون فعّال وساري هيبقى قابل للاستخدام.'
            : 'الخانة هتختفي من صفحة الطلب بعد تحديث الكاش، وأي طلب فيه كود هيترفض. الطلبات اللي اتسجلت بخصم مش هتتأثر.'
        }
        confirmLabel={pending ? 'شغّل' : 'اقفل'}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </Card>
  )
}
