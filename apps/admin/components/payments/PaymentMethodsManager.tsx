'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { addPaymentMethodAction, deletePaymentMethodAction, updatePaymentMethodAction } from '../../lib/paymentActions'
import { METHOD_NAME_MAX, type PaymentMethod } from '../../lib/orders/payments'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, inputClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * 0021-A P2 — طرق الدفع (§٣-٥) للمالك: إضافة باسم حر · تعديل الاسم · الترتيب · أرشفة/رجوع. الحذف النهائي بس للطريقة
 * اللي مااتستخدمتش في أي دفعة، والمستخدمة بتتأرشف وبتفضل ظاهرة في الدفعات القديمة (لقطة الاسم).
 */
function MethodRow({ method }: { method: PaymentMethod }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [name, setName] = useState(method.name)
  const [sort, setSort] = useState(String(method.sortOrder))
  const busy = state === 'saving'
  const disabled = !mutationsOn || busy

  function save(archived: boolean) {
    const order = Number(sort)
    void run(() => updatePaymentMethodAction(method.id, method.updatedAt, name, Number.isSafeInteger(order) ? order : -1, archived), {
      onSuccess: () => router.refresh(),
    })
  }

  function remove() {
    if (!window.confirm('حذف الطريقة نهائيًا؟')) return
    void run(() => deletePaymentMethodAction(method.id, method.updatedAt), { onSuccess: () => router.refresh() })
  }

  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="اسم الطريقة" value={name} maxLength={METHOD_NAME_MAX} onChange={(event) => setName(event.target.value)} className={inputClasses + ' min-w-0 flex-1'} disabled={disabled} />
        <input aria-label="الترتيب" inputMode="numeric" dir="ltr" value={sort} onChange={(event) => setSort(event.target.value)} className={inputClasses + ' w-20'} disabled={disabled} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {method.isArchived ? <span className="font-semibold text-muted">مؤرشفة</span> : null}
        {method.used ? <span className="text-muted">اتستخدمت في دفعات</span> : null}
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => save(method.isArchived)}>
          حفظ
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => save(!method.isArchived)}>
          {method.isArchived ? 'إرجاع' : 'أرشفة'}
        </Button>
        {!method.used ? (
          <Button size="sm" variant="danger" disabled={disabled} onClick={remove}>
            حذف
          </Button>
        ) : null}
      </div>
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </li>
  )
}

export function PaymentMethodsManager({ methods }: { methods: PaymentMethod[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [name, setName] = useState('')
  const busy = state === 'saving'

  function add() {
    if (name.trim() === '') return
    void run(() => addPaymentMethodAction(name), {
      onSuccess: () => {
        setName('')
        router.refresh()
      },
    })
  }

  return (
    <Card title="طرق الدفع">
      <ul className="divide-y divide-border">
        {methods.map((m) => (
          <MethodRow key={m.id + ':' + m.updatedAt} method={m} />
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input aria-label="طريقة جديدة" placeholder="طريقة جديدة" value={name} maxLength={METHOD_NAME_MAX} onChange={(event) => setName(event.target.value)} className={inputClasses} disabled={!mutationsOn || busy} />
        <Button size="sm" disabled={!mutationsOn || busy || name.trim() === ''} onClick={add}>
          إضافة
        </Button>
      </div>
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </Card>
  )
}
