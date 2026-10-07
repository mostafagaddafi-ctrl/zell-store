'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { SUPPLIER_STATUS_LABELS } from '../../lib/inventory/labels'
import type { InventorySupplier } from '../../lib/inventory/suppliers'
import { useMutationsEnabled } from '../../lib/readiness'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Card } from '../ui/Field'
import { SupplierForm } from './SupplierForm'

type Editing = { mode: 'create' } | { mode: 'edit'; supplier: InventorySupplier } | null

const SAVED_MESSAGE = 'اتحفظ.'
const REPLAYED_MESSAGE = 'العملية دي كانت اتنفذت قبل كده، واتعرضت نتيجتها من غير تكرار.'
const RECONCILED_MESSAGE = 'النموذج اتقفل والقايمة اتقرت من جديد. راجعها قبل أي محاولة جديدة.'

/**
 * قايمة الموردين + الإضافة والتعديل (الإيقاف من التعديل). مفيش حذف.
 * نموذج واحد بس مفتوح في نفس الوقت — يعني نية كتابة واحدة بس.
 */
export function SuppliersList({ rows }: { rows: InventorySupplier[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const [editing, setEditing] = useState<Editing>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function open(next: Editing) {
    setNotice(null)
    setEditing(next)
  }

  function closeAndRefresh(message: string) {
    setEditing(null)
    setNotice(message)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className="rounded-lg border-s-2 border-ok bg-ok/5 px-3 py-2 text-xs text-fg">
          {notice}
        </p>
      ) : null}

      {editing !== null ? (
        <SupplierForm
          key={editing.mode === 'edit' ? String(editing.supplier.supplierId) + ':' + String(editing.supplier.version) : 'new'}
          supplier={editing.mode === 'edit' ? editing.supplier : null}
          onClose={() => setEditing(null)}
          onSaved={(replayed) => closeAndRefresh(replayed ? REPLAYED_MESSAGE : SAVED_MESSAGE)}
          onReconcile={() => closeAndRefresh(RECONCILED_MESSAGE)}
        />
      ) : null}

      <Card
        title="الموردين"
        actions={
          <Button size="sm" disabled={!mutationsOn || editing !== null} onClick={() => open({ mode: 'create' })}>
            <Plus className="h-3.5 w-3.5" />
            مورد جديد
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="مفيش موردين هنا" description="ضيف أول مورد، وبعدها هيظهر في اختيار المورد لفواتير الشراء." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((supplier) => (
              <li
                key={supplier.supplierId}
                className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-sm font-bold text-fg">{supplier.name}</p>
                    <Badge tone={supplier.isActive ? 'ok' : 'neutral'}>
                      {supplier.isActive ? SUPPLIER_STATUS_LABELS.active : SUPPLIER_STATUS_LABELS.inactive}
                    </Badge>
                  </div>
                  {supplier.phone ? (
                    <p className="text-xs text-muted">
                      <bdi dir="ltr">{supplier.phone}</bdi>
                    </p>
                  ) : null}
                  {supplier.note ? (
                    <p className="whitespace-pre-line break-words text-xs text-muted">{supplier.note}</p>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!mutationsOn || editing !== null}
                  onClick={() => open({ mode: 'edit', supplier })}
                >
                  تعديل
                </Button>
              </li>
            ))}
          </ul>
        )}

        {mutationsOn ? null : <p className="mt-3 text-xs text-muted">التعديلات موقوفة دلوقتي (علم الجاهزية).</p>}
      </Card>
    </div>
  )
}
