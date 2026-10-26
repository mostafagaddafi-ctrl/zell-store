'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SaveFailure } from '../../lib/client/useSaveAction'
import { deleteProductAction } from '../../lib/productActions'
import {
  PRODUCT_DELETE_TEXT,
  performProductDelete,
  productDeleteAllowed,
  productDeleteBlockers,
  productDeleteQuestion,
  productDeleteSummary,
  type ProductDeletePreview,
} from '../../lib/products/deleteProduct'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * PRODUCT-DELETE (المرحلة B) — كارت «حذف المنتج نهائيًا» في صفحة المنتج، للمالك بس (الصفحة مابتعرضهوش لغيره، والقرار
 * النهائي في الداتابيز). بيظهر بالأعداد بس لما المنتج مخفي؛ لو ظاهر: سطر «أخفِ المنتج أولًا». لو فيه طلبات أو مخزون أو
 * تعارض: السبب ومفيش زرار. الزرار ← تأكيد واحد بالأعداد ← النداء (مرة واحدة) ← بعد النجاح رجوع لقايمة المنتجات. لو الحذف
 * نجح وتحديث المتجر الفوري فشل: الكارت بيفضل ويعرض التحذير (نجاح، مش فشل) ورابط القايمة، ومفيش أي إعادة للحذف.
 */
export function ProductDeleteCard({
  productName,
  isActive,
  preview,
}: {
  productName: string
  isActive: boolean
  preview: ProductDeletePreview | null
}) {
  if (isActive) {
    return (
      <Card title={PRODUCT_DELETE_TEXT.title}>
        <div className="p-4">
          <p className="text-xs text-muted">{PRODUCT_DELETE_TEXT.hideFirst}</p>
        </div>
      </Card>
    )
  }
  if (preview === null) {
    return (
      <Card title={PRODUCT_DELETE_TEXT.title}>
        <div className="p-4">
          <p className="text-xs text-muted">{PRODUCT_DELETE_TEXT.unavailable}</p>
        </div>
      </Card>
    )
  }
  return <ProductDeletePanel productName={productName} preview={preview} />
}

function ProductDeletePanel({ productName, preview }: { productName: string; preview: ProductDeletePreview }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef(false)
  const blockers = productDeleteBlockers(preview)
  const allowed = productDeleteAllowed(preview)
  const done = notice !== null

  async function confirmDelete() {
    // نداء واحد بس في نفس الوقت، ومفيش نداء تاني بعد النجاح.
    if (inFlight.current || done) return
    inFlight.current = true
    setBusy(true)
    setFailure(null)
    const outcome = await performProductDelete(() => deleteProductAction(preview.productId, preview.updatedAt))
    setBusy(false)
    if (outcome.kind === 'failed') {
      inFlight.current = false
      setFailure({ code: outcome.code, message: outcome.message })
      return
    }
    if (outcome.navigate) {
      router.replace('/products')
      router.refresh()
      return
    }
    setNotice(outcome.notice)
  }

  function backToList() {
    router.replace('/products')
    router.refresh()
  }

  return (
    <Card title={PRODUCT_DELETE_TEXT.title}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">{PRODUCT_DELETE_TEXT.intro}</p>
        <ul className="list-inside list-disc space-y-0.5 text-xs text-fg">
          {productDeleteSummary(preview).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-xs text-muted">{PRODUCT_DELETE_TEXT.storageNote}</p>
        <p className="text-xs text-muted">{PRODUCT_DELETE_TEXT.snapshotNote}</p>

        {blockers.length > 0 ? (
          <ul className="space-y-1">
            {blockers.map((line) => (
              <li key={line} className="text-xs font-medium text-danger">
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        {allowed && !done ? (
          confirming ? (
            <div role="alertdialog" aria-label={PRODUCT_DELETE_TEXT.confirmTitle} className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="text-xs font-semibold text-fg">{PRODUCT_DELETE_TEXT.confirmTitle}</p>
              <p className="text-xs text-fg">{productDeleteQuestion(productName, preview)}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" disabled={!mutationsOn || busy} onClick={() => void confirmDelete()}>
                  {busy ? PRODUCT_DELETE_TEXT.deleting : PRODUCT_DELETE_TEXT.confirm}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  {PRODUCT_DELETE_TEXT.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="danger" disabled={!mutationsOn || busy} onClick={() => setConfirming(true)}>
              {PRODUCT_DELETE_TEXT.button}
            </Button>
          )
        ) : null}

        {done ? (
          <div role="status" className="space-y-2 rounded-md border border-gold bg-surface p-3">
            <p className="text-xs font-semibold text-fg">{notice}</p>
            <Button size="sm" variant="secondary" onClick={backToList}>
              {PRODUCT_DELETE_TEXT.backToList}
            </Button>
          </div>
        ) : null}
        <FailureBanner failure={failure} onRetry={() => void confirmDelete()} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
