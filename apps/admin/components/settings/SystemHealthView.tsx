import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react'
import type { HealthItem, SystemHealth } from '../../lib/systemHealth'
import { formatDateTime } from '../../lib/format'
import { Card } from '../ui/Field'
import { HealthActions } from './HealthActions'

const ICON = {
  ok: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />,
  warn: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />,
  error: <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />,
  unknown: <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
}

function Items({ items }: { items: HealthItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2">
          {ICON[item.state]}
          <div className="min-w-0 break-words">
            <p className="text-xs font-semibold text-fg">{item.label}</p>
            <p className="text-xs text-muted">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** «حالة النظام» — كل سطر هنا اتفحص دلوقتي فعلًا (getSystemHealth). */
export function SystemHealthView({ health }: { health: SystemHealth }) {
  const problems = [...health.storefront, ...health.admin].filter((item) => item.state === 'error').length

  return (
    <div className="space-y-4">
      <p className={'text-xs font-semibold ' + (problems === 0 ? 'text-ok' : 'text-danger')}>
        {problems === 0 ? 'مفيش مشاكل — كل الفحوصات نجحت' : String(problems) + ' مشكلة محتاجة تتصلح'}
        <span className="ms-2 font-normal text-muted">آخر فحص: {formatDateTime(health.checkedAt)}</span>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="المتجر"
          actions={
            health.deployment?.commit ? (
              <span className="text-[11px] text-muted" dir="ltr">
                {health.deployment.commit}
              </span>
            ) : null
          }
        >
          <Items items={health.storefront} />
        </Card>

        <Card title="لوحة التحكم">
          <Items items={health.admin} />
        </Card>
      </div>

      <Card title="اختبارات">
        <HealthActions />
      </Card>

      <Card title="السجل">
        <ul className="space-y-2 text-xs">
          <li className="text-muted">
            آخر طلب: <span className="font-semibold text-fg">{health.lastOrderAt ? formatDateTime(health.lastOrderAt) : 'مفيش طلبات لسه'}</span>
          </li>
          <li className="text-muted">
            صور قديمة مستنية التنظيف:{' '}
            <span className="font-semibold text-fg">{health.pendingOrphans === null ? 'ما قدرناش نعدّ' : String(health.pendingOrphans)}</span>
          </li>
        </ul>
        <p className="mt-3 text-xs font-semibold text-fg">آخر إشعارات فشلت</p>
        {health.notifyFailures.length === 0 ? (
          <p className="mt-1 text-xs text-muted">مفيش أي إشعار فشل.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {health.notifyFailures.map((failure) => (
              <li key={failure.orderNumber + failure.createdAt} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className="font-semibold text-fg">{failure.orderNumber}</span>
                <span className="text-danger" dir="ltr">
                  {failure.error}
                </span>
                <span className="text-muted">{formatDateTime(failure.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
