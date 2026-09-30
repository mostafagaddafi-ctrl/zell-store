'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'

/** ترقيم من السيرفر — total دقيق. */
export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter()
  const params = useSearchParams()
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const go = (next: number) => {
    const query = new URLSearchParams(params.toString())
    if (next <= 1) query.delete('page')
    else query.set('page', String(next))
    router.push('/orders?' + query.toString())
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted">
        {from}–{to} من {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
          السابق
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => go(page + 1)}>
          التالي
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
