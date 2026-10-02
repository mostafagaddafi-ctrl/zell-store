'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { reorderCollectionsAction, setCollectionPlacementAction } from '../../lib/actions'
import type { AdminCollection } from '../../lib/adminData'
import { collectionVisibility, VISIBILITY_TONE } from '../../lib/collectionStatus'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button, buttonClasses } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { FailureBanner } from '../ui/FailureBanner'
import { Switch } from '../ui/Switch'

/**
 * قائمة الأقسام.
 *
 * الترتيب هنا هو ترتيب الظهور في الرئيسية **و**القائمة، وكل مكان
 * بيحترم مفتاحه. القسم الجديد بيبدأ أول القائمة، ومفيش أولوية ثابتة.
 *
 * ⚠️ حالة الظهور بتتحسب بنفس قواعد المتجر (collectionStatus) — فلو
 *    القسم مش ظاهر للزباين، السبب مكتوب جنبه بدل ما الأدمن يخمّن.
 */
export function CollectionsList({ collections }: { collections: AdminCollection[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry } = useSaveAction()
  const [busyId, setBusyId] = useState<string | null>(null)

  const busy = state === 'saving'

  function done() {
    setBusyId(null)
    router.refresh()
  }

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
    void run(() => reorderCollectionsAction(ids), { onSuccess: done })
  }

  function place(collection: AdminCollection, showOnHome: boolean, showInNav: boolean) {
    setBusyId(collection.id)
    void run(() => setCollectionPlacementAction(collection.id, showOnHome, showInNav, collection.updatedAt), {
      onSuccess: done,
    })
  }

  if (collections.length === 0) {
    return (
      <EmptyState
        title="مفيش أقسام لسه"
        description="القسم بيجمّع منتجات تحت اسم واحد، وتقدر تظهره في الرئيسية أو في قائمة المتجر أو الاتنين."
      />
    )
  }

  return (
    <div className="space-y-3">
      {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <ul className="space-y-3">
        {collections.map((collection, index) => {
          const status = collectionVisibility(collection)
          const inactive = collection.productCount - collection.activeProductCount
          const rowBusy = busyId === collection.id && busy

          return (
            <li key={collection.id} className="rounded border border-border bg-surface p-3 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {collection.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={collection.cover.url}
                      alt=""
                      className="h-12 w-16 shrink-0 rounded border border-border object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-fg">{collection.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted" dir="ltr">
                      /collection/{collection.slug}
                    </p>
                    {collection.subtitle ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{collection.subtitle}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">
                      {String(collection.productCount) + ' منتج'}
                      {inactive > 0 ? ' · ' + String(inactive) + ' متوقّف' : ''}
                    </p>
                    <p className={'mt-1 text-xs font-semibold ' + VISIBILITY_TONE[status.tone]}>
                      {status.label} — {status.detail}
                    </p>
                    {status.tone === 'warn' ? (
                      <div className="mt-2">
                        <Link href={'/collections/' + collection.id + '#products'} className={buttonClasses('primary', 'sm')}>
                          {collection.productCount === 0 ? 'ضيف منتجات للقسم' : 'راجع منتجات القسم'}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </div>

                <Link
                  href={'/collections/' + collection.id}
                  aria-label={'تعديل ' + collection.title}
                  className={buttonClasses('secondary', 'sm')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  تعديل
                </Link>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={collection.showOnHome}
                    onChange={(next) => place(collection, next, collection.showInNav)}
                    label={'إظهار ' + collection.title + ' في الرئيسية'}
                    disabled={!mutationsOn || busy}
                  />
                  <span className="text-xs text-fg">الرئيسية</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={collection.showInNav}
                    onChange={(next) => place(collection, collection.showOnHome, next)}
                    label={'إظهار ' + collection.title + ' في قائمة الأقسام'}
                    disabled={!mutationsOn || busy}
                  />
                  <span className="text-xs text-fg">القائمة</span>
                </div>

                <div className="ms-auto flex items-center gap-1.5">
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
                  <span className="text-xs text-muted">
                    الترتيب {index + 1}
                    {rowBusy ? ' · بيحفظ…' : ''}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
