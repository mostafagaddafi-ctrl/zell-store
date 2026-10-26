'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { deleteProductAction } from '../../lib/productActions'
import {
  PRODUCT_DELETE_TEXT,
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
 * تعارض: السبب ومفيش زرار. الزرار ← تأكيد واحد بالأعداد ← النداء ← بعد النجاح رجوع لقايمة المنتجات.
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
  const { state, failure, run, retry } = useSaveAction()
  const [confirming, setConfirming] = useState(false)
  const blockers = productDeleteBlockers(preview)
  const allowed = productDeleteAllowed(preview)
  const busy = state === 'saving'
  const done = state === 'saved'

  function confirmDelete() {
    void run(() => deleteProductAction(preview.productId, preview.updatedAt), {
      onSuccess: () => {
        router.replace('/products')
        router.refresh()
      },
    })
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
                <Button size="sm" variant="danger" disabled={!mutationsOn || busy} onClick={confirmDelete}>
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
          <p role="status" className="text-xs text-ok">
            {PRODUCT_DELETE_TEXT.deleted}
          </p>
        ) : null}
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
