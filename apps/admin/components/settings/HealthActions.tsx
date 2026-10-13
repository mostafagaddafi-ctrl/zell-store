'use client'

import { useRouter } from 'next/navigation'
import { RefreshCw, Send } from 'lucide-react'
import { refreshStorefrontAction, testTelegramAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'

/** أزرار فحص حقيقية: رسالة تليجرام فعلية، وتحديث المتجر فعلًا. */
export function HealthActions() {
  const router = useRouter()
  const telegram = useSaveAction()
  const refresh = useSaveAction()

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={telegram.state === 'saving'} onClick={() => void telegram.run(() => testTelegramAction())}>
            <Send className="h-3.5 w-3.5" />
            {telegram.state === 'saving' ? 'بيبعت…' : 'اختبار تليجرام'}
          </Button>
          {telegram.state === 'saved' ? (
            <span className="text-xs font-semibold text-ok">اتبعتت — لو وصلتك على تليجرام، إشعارات الطلبات شغّالة</span>
          ) : null}
        </div>
        <p className="text-xs text-muted">بيبعت رسالة تجربة حقيقية على شات الطلبات، بنفس طريق إشعار الطلب.</p>
        <FailureBanner failure={telegram.failure} onRetry={telegram.retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={refresh.state === 'saving'}
            onClick={() => void refresh.run(() => refreshStorefrontAction(), { onSuccess: () => router.refresh() })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {refresh.state === 'saving' ? 'بيحدّث…' : 'حدّث المتجر دلوقتي'}
          </Button>
          {refresh.state === 'saved' ? <span className="text-xs font-semibold text-ok">المتجر اتحدّث</span> : null}
        </div>
        <p className="text-xs text-muted">
          يُحدَّث المتجر تلقائيًا بعد أي حفظ في لوحة التحكم. يُستخدم هذا الزر فقط عند تغيير البيانات من خارج اللوحة (مثل التعديل المباشر في قاعدة البيانات).
        </p>
        <FailureBanner failure={refresh.failure} onRetry={refresh.retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </div>
  )
}
