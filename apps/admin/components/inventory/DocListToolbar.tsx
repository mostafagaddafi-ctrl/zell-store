import Link from 'next/link'
import { Search } from 'lucide-react'
import { DOC_SEARCH_MAX, DOC_TABS, DOC_TAB_LABELS, docListHref, type DocTab } from '../../lib/inventory/docList'
import { buttonClasses } from '../ui/Button'
import { inputClasses } from '../ui/Field'

export type ToolbarSupplier = { id: number; label: string }

/**
 * تبويبات الحالة + بحث (GET) لقوايم المشتريات ورصيد أول المدة. مكوّن سيرفر من غير state.
 * التبويبات بتتمرر أفقي على الموبايل، والبحث بياخد العرض كله.
 */
export function DocListToolbar({
  base,
  tab,
  query,
  placeholder,
  supplierId = null,
  suppliers = null,
}: {
  base: string
  tab: DocTab
  query: string
  placeholder: string
  supplierId?: number | null
  suppliers?: ToolbarSupplier[] | null
}) {
  return (
    <div className="mb-4 space-y-2">
      <nav aria-label="حالة المستند" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {DOC_TABS.map((option) => (
          <Link
            key={option}
            href={docListHref(base, { tab: option, query, supplierId, beforeId: null })}
            aria-current={tab === option ? 'page' : undefined}
            className={buttonClasses(tab === option ? 'primary' : 'secondary', 'sm') + ' shrink-0'}
          >
            {DOC_TAB_LABELS[option]}
          </Link>
        ))}
      </nav>
      <form method="get" action={base} role="search" className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        {tab !== 'active' ? <input type="hidden" name="tab" value={tab} /> : null}
        <label className="relative block flex-1">
          <span className="sr-only">بحث</span>
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={DOC_SEARCH_MAX}
            placeholder={placeholder}
            className={inputClasses + ' ps-8'}
          />
        </label>
        {suppliers !== null ? (
          <select
            name="supplier"
            defaultValue={supplierId === null ? '' : String(supplierId)}
            className={inputClasses + ' sm:w-48'}
            aria-label="المورد"
          >
            <option value="">كل الموردين</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={String(supplier.id)}>
                {supplier.label}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className={buttonClasses('secondary', 'sm')}>
          بحث
        </button>
      </form>
    </div>
  )
}
