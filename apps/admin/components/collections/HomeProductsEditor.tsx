'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { HomeProducts, HomeProductsMode } from '@zell/core'
import { saveHomeProductsAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import type { HomeProductOption } from '../../lib/data/homeProducts'
import { useMutationsEnabled } from '../../lib/readiness'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'

const MODES: { value: HomeProductsMode; title: string; hint: string }[] = [
  { value: 'all', title: 'كل المنتجات', hint: 'كل المنتجات النشطة بتظهر في الرئيسية.' },
  { value: 'selected', title: 'منتجات أختارها', hint: 'اللي هتعلّم عليه بس، والباقي في صفحة قسمه و«كل المنتجات».' },
  { value: 'none', title: 'من غير منتجات', hint: 'الرئيسية بتعرض الأقسام المفعّل لها «صف في الرئيسية» بس.' },
]

/**
 * «الصفحة الرئيسية» — إيه اللي يظهر في جزء المنتجات، واسم رابط «كل المنتجات».
 * الأقسام نفسها بتظهر في الرئيسية بمفتاحها في القائمة تحت.
 */
export function HomeProductsEditor({ initial, products }: { initial: HomeProducts; products: HomeProductOption[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<HomeProducts>(initial)

  const touch = (patch: Partial<HomeProducts>) => {
    setDraft((current) => ({ ...current, ...patch }))
    markDirty()
  }

  const toggle = (id: number) => {
    touch({ ids: draft.ids.includes(id) ? draft.ids.filter((item) => item !== id) : [...draft.ids, id] })
  }

  function save() {
    void run(() => saveHomeProductsAction(draft), { onSuccess: () => router.refresh() })
  }

  return (
    <Card title="الصفحة الرئيسية">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-fg">جزء المنتجات في الرئيسية يعرض إيه؟</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((mode) => {
              const active = draft.mode === mode.value
              return (
                <label
                  key={mode.value}
                  className={
                    'flex cursor-pointer items-start gap-2 rounded border p-2.5 transition-colors ' +
                    (active ? 'border-brand bg-brand/5' : 'border-border hover:border-muted')
                  }
                >
                  <input
                    type="radio"
                    name="home-products-mode"
                    className="mt-0.5"
                    checked={active}
                    disabled={!mutationsOn}
                    onChange={() => touch({ mode: mode.value })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg">{mode.title}</span>
                    <span className="block text-xs text-muted">{mode.hint}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {draft.mode === 'selected' ? (
          <div>
            <p className="mb-2 text-xs font-semibold text-fg">
              {'علّم على المنتجات اللي تظهر في الرئيسية (' + String(draft.ids.length) + ')'}
            </p>
            {products.length === 0 ? (
              <p className="text-xs text-muted">مفيش منتجات لسه.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {products.map((product) => (
                  <label
                    key={product.id}
                    className="flex items-center gap-2 rounded border border-border px-2.5 py-2 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={draft.ids.includes(product.id)}
                      disabled={!mutationsOn}
                      onChange={() => toggle(product.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{product.nameAr}</span>
                    {!product.isActive ? <span className="shrink-0 text-xs text-muted">متوقّف</span> : null}
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <Field
          htmlFor="all-products-label"
          label="اسم رابط «كل المنتجات» في القائمة"
          hint="بيظهر في القائمة فوق ويفتح صفحة فيها كل المنتجات. سيبه فاضي لو مش عايز الرابط."
        >
          <input
            id="all-products-label"
            value={draft.allLabel}
            maxLength={30}
            onChange={(event) => touch({ allLabel: event.target.value })}
            className={inputClasses}
            placeholder="مثلًا: كل الأفلام"
            disabled={!mutationsOn}
          />
        </Field>

        <p className="rounded border border-dashed border-border p-2.5 text-xs text-muted">
          أي قسم مفتاح «صف في الرئيسية» بتاعه مفتوح تحت بيظهر كصف لوحده في الرئيسية بعد جزء المنتجات. لو المفتاح مقفول،
          القسم بيبان في القائمة وصفحته بس.
        </p>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
        <SaveBar state={state} onSave={save} warning={warning} />
      </div>
    </Card>
  )
}
