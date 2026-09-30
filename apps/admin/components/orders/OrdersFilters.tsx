'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../lib/adminData'
import { Button } from '../ui/Button'
import { inputClasses } from '../ui/Field'

/** الفلترة في الرابط — عشان الصفحة تتشارك وترجع بنفس الحالة. */
export function OrdersFilters() {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const status = params.get('status') ?? 'all'

  const apply = (next: { search?: string; status?: string }) => {
    const query = new URLSearchParams(params.toString())
    const nextSearch = next.search ?? search
    const nextStatus = next.status ?? status

    if (nextSearch.trim() === '') query.delete('search')
    else query.set('search', nextSearch.trim())

    if (nextStatus === 'all') query.delete('status')
    else query.set('status', nextStatus)

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

      <Button type="submit" variant="secondary">
        بحث
      </Button>
    </form>
  )
}
