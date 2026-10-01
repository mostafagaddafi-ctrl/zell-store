'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import {
  reorderCollectionsAction,
  setCollectionVisibilityAction,
} from '../../lib/actions'
import type { AdminCollection } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button, buttonClasses } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { FailureBanner } from '../ui/FailureBanner'
import { Switch } from '../ui/Switch'

/**
 * قائمة المجموعات — **بطاقات، مش جدول**.
 *
 * ⚠️ الجدول العريض هو الغلط المتكرر في لوحات الإدارة على الموبايل:
 *    ستة أعمدة بتتحول scroll أفقي، والأزرار بتخرج من الشاشة. كل
 *    مجموعة هنا بطاقة مستقلة، والأزرار جواها — فالتفاعل كله في
 *    متناول الإصبع على أي عرض. على الديسكتوب البطاقات بتوسّع.
 *
 * ⚠️ الترتيب بسهمين لكل بطاقة مش drag and drop: السحب على اللمس
 *    بيتعارض مع scroll الصفحة، والسهمين واضحين ومتاحين بلوحة
 *    المفاتيح من غير أي كود إضافي.
 *
 * ⚠️ الترتيب بيتبعت **كقائمة كاملة** — الدالة بترفض أي مجموعة ناقصة.
 */
export function CollectionsList({ collections }: { collections: AdminCollection[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [busyId, setBusyId] = useState<string | null>(null)

  const busy = state === 'saving'

  function move(index: number, direction: -1 | 1) {
    const next = index + direction
    if (next < 0 || next >= collections.length) return

    const ids = collections.map((collection) => collection.id)
    const current = ids[index]
    const swap = ids[next]
    if (current === undefined || swap === undefined) return
    ids[index] = swap
    ids[next] = current

    setBusyId(current)
    void run(() => reorderCollectionsAction(ids), {
      onSuccess: () => {
        setBusyId(null)
        router.refresh()
      },
    })
  }

  function toggle(collection: AdminCollection, visible: boolean) {
    setBusyId(collection.id)
    void run(() => setCollectionVisibilityAction(collection.id, visible, collection.updatedAt), {
      onSuccess: () => {
        setBusyId(null)
        router.refresh()
      },
    })
  }

  if (collections.length === 0) {
    return (
      <EmptyState
        title="مفيش مجموعات لسه"
        description="المجموعة بتجمّع منتجات تحت عنوان واحد، وبتظهر في الرئيسية وعلى صفحة خاصة بها."
      />
    )
  }

  return (
    <div className="space-y-3">
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <ul className="space-y-3">
        {collections.map((collection, index) => (
          <li
            key={collection.id}
            className="rounded border border-border bg-surface p-3 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-fg">{collection.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted" dir="ltr">
                  /collection/{collection.slug}
                </p>
                {collection.subtitle ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{collection.subtitle}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  {collection.productCount === 0
                    ? 'مفيش منتجات — المجموعة مش بتظهر في المتجر'
                    : String(collection.productCount) + ' منتج'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={collection.isVisible}
                  onChange={(next) => toggle(collection, next)}
                  label={'إظهار ' + collection.title}
                  disabled={!mutationsOn || busy}
                />
                <Link
                  href={'/collections/' + collection.id}
                  aria-label={'تعديل ' + collection.title}
                  className={buttonClasses('secondary', 'sm')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  تعديل
                </Link>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label={'حرّك ' + collection.title + ' لفوق'}
                disabled={!mutationsOn || busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={'حرّك ' + collection.title + ' لتحت'}
                disabled={!mutationsOn || busy || index === collections.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <span className="ms-auto text-xs text-muted">
                الترتيب {index + 1}
                {busyId === collection.id && busy ? ' · بيحفظ…' : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
