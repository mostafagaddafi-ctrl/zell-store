'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Search } from 'lucide-react'
import { ORDER_NUMBER_KEEP, TRACK_PAGE_HREF } from '../../lib/orders/trackView'
import { buttonClasses } from '../ui/Button'

/**
 * TRACK-ORDER v2 W2-A — «احتفظ برقم طلبك» في صفحة نجاح الطلب / الإيصال (العقد docs/contracts/TRACK-ORDER-v2.md §١٧-١، طلب المالك).
 *
 *   • زرار نسخ الرقم برسالة نجاح أو فشل واضحة؛ لو النسخ فشل الرقم بيفضل ظاهر وقابل للتحديد والنسخ يدويًا.
 *   • رابط ثابت /track — الرقم مابيدخلش الرابط (لا query ولا path) ومفيش تعبئة تلقائية.
 *   • مكوّن عرض بس: مفيش قراية ولا كتابة بيانات.
 */

export function OrderNumberKeep({ orderNumber }: { orderNumber: string }) {
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')

  async function copyNumber() {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(orderNumber)
      setCopy('done')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-semibold leading-relaxed text-fg">{ORDER_NUMBER_KEEP.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="select-all rounded-md border border-border bg-bg px-3 py-2 font-mono text-base font-bold text-fg">
          {orderNumber}
        </span>
        <button type="button" onClick={copyNumber} className={buttonClasses('secondary', 'md')}>
          {copy === 'done' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {ORDER_NUMBER_KEEP.copy}
        </button>
        <Link href={TRACK_PAGE_HREF} className={buttonClasses('ghost', 'md')}>
          <Search className="h-4 w-4" aria-hidden="true" />
          تتبّع طلبك
        </Link>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted">
        {copy === 'done' ? ORDER_NUMBER_KEEP.copied : copy === 'failed' ? ORDER_NUMBER_KEEP.copyFailed : ''}
      </p>
    </div>
  )
}
