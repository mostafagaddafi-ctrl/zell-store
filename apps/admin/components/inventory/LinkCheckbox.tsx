'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

/** خانة اختيار بتغيّر الرابط (فلتر GET) — بديل زرار «إظهار/إخفاء». */
export function LinkCheckbox({ label, checked, onHref, offHref }: { label: string; checked: boolean; onHref: string; offHref: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.checked ? onHref : offHref
          startTransition(() => router.replace(next))
        }}
        className="h-4 w-4 accent-brand"
      />
      {label}
    </label>
  )
}
