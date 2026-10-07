'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban } from 'lucide-react'
import { voidPurchaseAction } from '../../lib/inventoryActions'
import { useInventoryIntent } from '../../lib/client/useInventoryIntent'
import { DOC_ACTION_LABELS } from '../../lib/inventory/labels'
import type { PurchaseWriteResult } from '../../lib/inventory/purchases'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { ReasonDialog } from './ReasonDialog'
import { UnresolvedNotice } from './UnresolvedNotice'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

type VoidPayload = { docId: number; version: number; reason: string }

/**
 * «إبطال المستند المرحّل» — نهائي، وبسبب (3–300 حرف زي الداتابيز). نية مستقلة بمفتاح مستقل.
 * الداتابيز بترفض لو فيه حركات مرتبطة بالدفعات (45213).
 */
export function VoidPurchaseAction({ docId, docNo, version }: { docId: number; docNo: string; version: number }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reconciling, startReconcile] = useTransition()

  const voiding = useInventoryIntent<VoidPayload, PurchaseWriteResult>(
    (commandId, payload) => voidPurchaseAction(commandId, payload.docId, payload.version, payload.reason),
    {
      onDone: (result) => {
        setNotice(
          result.replayed === true ? 'العملية دي كانت اتنفذت قبل كده، واتعرضت نتيجتها من غير تكرار.' : 'اتبطل المستند.',
        )
        startReconcile(() => router.refresh())
      },
      onAbandon: () => startReconcile(() => router.refresh()),
    },
  )

  const wasReconciling = useRef(false)
  useEffect(() => {
    if (reconciling) {
      wasReconciling.current = true
      return
    }
    if (!wasReconciling.current) return
    wasReconciling.current = false
    voiding.reopen()
    voiding.resetAfterSuccess()
  }, [reconciling])

  const failure = voiding.intent.phase === 'editing' ? voiding.intent.failure : null
  const busy = reconciling || voiding.intent.phase !== 'editing'

  return (
    <div className="space-y-3">
      <UnsavedChangesGuard active={voiding.risky} />
      <Button variant="danger" onClick={() => setOpen(true)} disabled={!mutationsOn || busy}>
        <Ban className="h-4 w-4" />
        {voiding.intent.phase === 'submitting' ? 'بيبطل…' : DOC_ACTION_LABELS.void}
      </Button>
      {notice ? (
        <p role="status" className="rounded-lg border-s-2 border-ok bg-ok/5 px-3 py-2 text-xs text-fg">
          {notice}
        </p>
      ) : null}
      {failure ? (
        <FailureBanner
          failure={failure}
          onDiscardAndRefresh={failure.code === 'CONFLICT' ? () => startReconcile(() => router.refresh()) : undefined}
        />
      ) : null}
      {voiding.intent.phase === 'unresolved' ? (
        <UnresolvedNotice
          message={voiding.intent.message}
          hard={voiding.intent.hard}
          attempt={voiding.intent.attempt}
          onRetry={voiding.retry}
          onAbandon={voiding.abandon}
        />
      ) : null}
      <ReasonDialog
        open={open}
        kind="void"
        title={DOC_ACTION_LABELS.void + ' ' + docNo}
        message="الإبطال نهائي: المستند والدفعات بتاعته بيبقوا «مُبطَل». مش بيتمسح حاجة، والسجل بيفضل ظاهر."
        confirmLabel={DOC_ACTION_LABELS.void}
        onCancel={() => setOpen(false)}
        onConfirm={(reason) => {
          setOpen(false)
          voiding.begin({ docId, version, reason })
        }}
      />
    </div>
  )
}
