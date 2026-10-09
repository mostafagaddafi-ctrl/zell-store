'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../lib/enums'
import { FOLLOW_UP_FILTERS, FOLLOW_UP_FILTER_LABELS } from '../../lib/orders/cycle'
import { Button } from '../ui/Button'
import { inputClasses } from '../ui/Field'

/**
 * الفلترة في الرابط — عشان الصفحة تتشارك وترجع بنفس الحالة.
 * 0021-A A2: فلتر المتابعة (followup) بيخص الطلبات الجديدة بس، فاختياره بيشيل فلتر الحالة والعكس.
 */
export function OrdersFilters() {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const status = params.get('status') ?? 'all'
  const followUp = params.get('followup') ?? ''

  const apply = (next: { search?: string; status?: string; followUp?: string }) => {
    const query = new URLSearchParams(params.toString())
    const nextSearch = next.search ?? search
    let nextStatus = next.status ?? status
    let nextFollowUp = next.followUp ?? followUp
    if (next.followUp !== undefined && next.followUp !== '') nextStatus = 'all'
    if (next.status !== undefined && next.status !== 'all') nextFollowUp = ''

    if (nextSearch.trim() === '') query.delete('search')
    else query.set('search', nextSearch.trim())

    if (nextStatus === 'all') query.delete('status')
    else query.set('status', nextStatus)

    if (nextFollowUp === '') query.delete('followup')
    else query.set('followup', nextFollowUp)

    query.delete('page')
    router.push('/orders?' + query.toString())
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        apply({})
      }}
    >
      <div className="relative min-w-52 flex-1">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="رقم الطلب، الاسم، الموبايل، المحافظة"
          className={inputClasses + ' pr-9'}
          aria-label="بحث في الطلبات"
        />
        <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>

      <select
        value={status}
        onChange={(event) => apply({ status: event.target.value })}
        className={inputClasses + ' w-36'}
        aria-label="فلتر الحالة"
      >
        <option value="all">كل الحالات</option>
        {ORDER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {ORDER_STATUS_LABELS[value]}
          </option>
        ))}
      </select>

      <select
        value={followUp}
        onChange={(event) => apply({ followUp: event.target.value })}
        className={inputClasses + ' w-40'}
        aria-label="فلتر المتابعة"
      >
        <option value="">كل المتابعات</option>
        {FOLLOW_UP_FILTERS.map((value) => (
          <option key={value} value={value}>
            {FOLLOW_UP_FILTER_LABELS[value]}
          </option>
        ))}
      </select>

      <Button type="submit" variant="secondary">
        بحث
      </Button>
    </form>
  )
}
