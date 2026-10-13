import type { OperationalSettings } from '../../lib/adminData'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Field'

/**
 * تسليم إشعارات الطلبات — من بيانات الطلبات الفعلية (notified_at / notify_error).
 *
 * ⚠️ خانة «بريد الإشعارات» اتشالت: مفيش ناقل إيميل في المشروع، فالخانة كانت
 *    بتوحي إن الإيميل شغّال وهو مش شغّال. الإشعار الحقيقي تليجرام — واختباره
 *    في «حالة النظام» فوق.
 */
export function SettingsEditor({ settings }: { settings: OperationalSettings }) {
  const delivery = settings.notifyDelivery

  return (
    <Card
      title="تسليم إشعارات الطلبات"
      actions={
        delivery.state === 'ok' ? (
          <Badge tone="ok">سليم</Badge>
        ) : delivery.state === 'warn' ? (
          <Badge tone="danger">فيه فشل</Badge>
        ) : (
          <Badge tone="neutral">ما اتأكدش</Badge>
        )
      }
    >
      {delivery.countsExact ? (
        <ul className="space-y-1 text-xs text-muted">
          <li>آخر {String(delivery.windowHours)} ساعة: {String(delivery.recentOrders)} طلب</li>
          <li>فيهم فشل إشعار أو إشعار معلّق: {String(delivery.failedOrders)}</li>
        </ul>
      ) : (
        <p className="text-xs text-muted">العدّ الدقيق غير متاح حاليًا، لذلك لا تُعرض الأرقام.</p>
      )}
      {delivery.state === 'unknown' ? (
        <p className="mt-2 text-xs text-muted">لا توجد طلبات في هذه الفترة. يمكن استخدام «اختبار تليجرام» أعلاه للتأكد من عمل الإشعارات.</p>
      ) : null}
      <p className="mt-2 text-xs text-muted">البريد الإلكتروني غير متاح بعد، والإشعارات عبر تليجرام فقط.</p>
    </Card>
  )
}
