'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ORDER_STATUS_LABELS } from '../../lib/enums'
import { formatDateTime, formatPiastres } from '../../lib/format'
import { previewOrderPurgeAction, purgeOrdersAction } from '../../lib/orderPurgeActions'
import {
  ORDER_PURGE_MESSAGES,
  ORDER_PURGE_TEXT,
  purgeDoneNotice,
  purgePhrase,
  purgeSummary,
  type PurgePreview,
  type PurgeScope,
} from '../../lib/orders/purge'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card } from '../ui/Field'

/**
 * ORDER-DELETE (المرحلة C) — كارت حذف الطلبات للمالك بس (الصفحة مابتعرضهوش لغيره، والقرار النهائي في الداتابيز):
 *   single = في صفحة الطلب (الطلب ده بس) · all = في الإعدادات (كل الطلبات الموجودة لحظة المعاينة).
 * الخطوات (العقد §١ و§٥): «عرض ما سيُحذف» ← المعاينة من الداتابيز (القايمة كاملة + الإجماليات + البصمة) ← جملة التأكيد بالعدد ·
 * مربع «backup» للمسح الشامل بس · الباسورد ← «حذف نهائي» مرة واحدة. الباسورد بيتمسح من الخانة بعد أي محاولة. لو القايمة اتغيّرت
 * أو النتيجة مش معروفة: «عرض القائمة من جديد» (معاينة جديدة وبصمة جديدة)، ومفيش أي إعادة تلقائية للحذف.
 */
export function OrderPurgeCard({ scope, orderId }: { scope: PurgeScope; orderId?: number }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const inFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PurgePreview | null>(null)
  const [phrase, setPhrase] = useState('')
  const [backup, setBackup] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const title = scope === 'single' ? ORDER_PURGE_TEXT.singleTitle : ORDER_PURGE_TEXT.allTitle
  const intro = scope === 'single' ? ORDER_PURGE_TEXT.singleIntro : ORDER_PURGE_TEXT.allIntro

  async function loadPreview() {
    if (loading || busy) return
    if (scope === 'single' && (orderId === undefined || !Number.isSafeInteger(orderId) || orderId < 1)) {
      setError(ORDER_PURGE_MESSAGES.invalid)
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    setPreview(null)
    setPhrase('')
    setBackup(false)
    setPassword('')
    try {
      const result = await previewOrderPurgeAction(scope === 'single' && orderId !== undefined ? [orderId] : null)
      if (result.ok) setPreview(result.data)
      else setError(result.message)
    } catch {
      setError(ORDER_PURGE_MESSAGES.previewUnavailable)
    } finally {
      setLoading(false)
    }
  }

  function cancel() {
    if (busy) return
    setPreview(null)
    setPhrase('')
    setBackup(false)
    setPassword('')
    setError(null)
  }

  const expected = preview !== null ? purgePhrase(preview.count) : ''
  const ready =
    preview !== null &&
    preview.count > 0 &&
    phrase.trim() === expected &&
    (scope === 'single' || backup) &&
    password.length > 0 &&
    mutationsOn &&
    !busy

  async function confirmPurge() {
    if (preview === null || !ready || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const request = {
      scope,
      ids: preview.ids,
      idsHash: preview.idsHash,
      snapshotHash: preview.snapshotHash,
      count: preview.count,
      phrase,
      backupConfirmed: scope === 'all' ? backup : false,
      password,
    }
    setPassword('')
    try {
      const result = await purgeOrdersAction(request)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (scope === 'single') {
        router.replace('/orders')
        router.refresh()
        return
      }
      setPreview(null)
      setPhrase('')
      setBackup(false)
      setNotice(purgeDoneNotice(result.data))
      router.refresh()
    } catch {
      setError(ORDER_PURGE_MESSAGES.internal)
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  const statusLabel = (status: string) => (ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status

  return (
    <Card title={title}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">{intro}</p>
        <p className="text-xs font-medium text-danger">{ORDER_PURGE_TEXT.noUndo}</p>

        {preview === null ? (
          <Button size="sm" variant="danger" disabled={loading || busy} onClick={() => void loadPreview()}>
            {loading ? ORDER_PURGE_TEXT.loading : ORDER_PURGE_TEXT.open}
          </Button>
        ) : preview.count === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-fg">{ORDER_PURGE_TEXT.empty}</p>
            <Button size="sm" variant="secondary" onClick={cancel}>
              {ORDER_PURGE_TEXT.cancel}
            </Button>
          </div>
        ) : (
          <div role="alertdialog" aria-label={title} className="space-y-3 rounded-md border border-danger/40 bg-danger/5 p-3">
            <div className="max-h-80 overflow-auto rounded border border-line bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colNumber}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colDate}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colCustomer}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colPhone}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colStatus}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colTotal}</th>
                    <th className="p-2 text-start">{ORDER_PURGE_TEXT.colPayments}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.orders.map((o) => (
                    <tr key={o.id} className="border-t border-line text-fg">
                      <td className="p-2" dir="ltr">{o.orderNumber}</td>
                      <td className="p-2">{formatDateTime(o.createdAt)}</td>
                      <td className="p-2">{o.customerName}</td>
                      <td className="p-2" dir="ltr">{o.customerPhone}</td>
                      <td className="p-2">{statusLabel(o.status)}</td>
                      <td className="p-2">{formatPiastres(o.totalPiastres)}</td>
                      <td className="p-2">
                        {String(o.paymentsCount)} · {formatPiastres(o.receivedPiastres)}
                        {o.refundedPiastres > 0 ? ' · −' + formatPiastres(o.refundedPiastres) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs font-semibold text-fg">{purgeSummary(preview, formatPiastres)}</p>

            <label className="block space-y-1 text-xs text-fg">
              <span>
                {ORDER_PURGE_TEXT.phraseLabel} <strong>{expected}</strong>
              </span>
              <input
                className="w-full rounded border border-line bg-surface p-2 text-xs"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </label>

            {scope === 'all' ? (
              <label className="flex items-center gap-2 text-xs text-fg">
                <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} disabled={busy} />
                <span>{ORDER_PURGE_TEXT.backupLabel}</span>
              </label>
            ) : null}

            <label className="block space-y-1 text-xs text-fg">
              <span>{ORDER_PURGE_TEXT.passwordLabel}</span>
              <input
                type="password"
                className="w-full rounded border border-line bg-surface p-2 text-xs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoComplete="current-password"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="danger" disabled={!ready} onClick={() => void confirmPurge()}>
                {busy ? ORDER_PURGE_TEXT.deleting : ORDER_PURGE_TEXT.confirm}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => void loadPreview()}>
                {ORDER_PURGE_TEXT.reload}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={cancel}>
                {ORDER_PURGE_TEXT.cancel}
              </Button>
            </div>
          </div>
        )}

        {error !== null ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p role="status" className="rounded-md border border-gold bg-surface p-3 text-xs font-semibold text-fg">
            {notice}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
