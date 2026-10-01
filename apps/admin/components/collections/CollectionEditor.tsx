'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Trash2, X } from 'lucide-react'
import {
  createCollectionAction,
  deleteCollectionAction,
  setCollectionProductsAction,
  updateCollectionAction,
} from '../../lib/actions'
import type { AdminCollectionDetail, AdminProduct } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

/**
 * محرّر مجموعة.
 *
 * ⚠️ **حفظين منفصلين عن قصد**: بيانات المجموعة (صف واحد، تزامن
 *    تفاؤلي بـ updated_at) وقائمة المنتجات (صفوف كتير، دالة ذرّية).
 *    لو جمعناهم في زرار واحد، فشل نصّه كان هيسيب الحالة نصف محفوظة
 *    والأدمن مش عارف أنهي نص نجح.
 *
 * ⚠️ في وضع الإنشاء مفيش ربط منتجات: المجموعة لازم يبقى لها id الأول.
 *    بعد الإنشاء بنروح لصفحة التعديل بـreplace — مش push — عشان زرار
 *    «رجوع» مايرجّعش لفورم إنشاء لمجموعة بقت موجودة.
 *
 * ⚠️ ترتيب المنتجات جوه المجموعة بيتحفظ فعلًا (sort_order في جدول
 *    الربط)، فالسهمين مش تزيين — ده الترتيب اللي المتجر بيعرض بيه.
 */
export function CollectionEditor({
  collection,
  products,
}: {
  collection: AdminCollectionDetail | null
  products: AdminProduct[]
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()

  const details = useSaveAction()
  const links = useSaveAction()
  const removal = useSaveAction()

  const [title, setTitle] = useState(collection?.title ?? '')
  const [slug, setSlug] = useState(collection?.slug ?? '')
  const [subtitle, setSubtitle] = useState(collection?.subtitle ?? '')
  const [isVisible, setIsVisible] = useState(collection?.isVisible ?? true)
  const [selected, setSelected] = useState<number[]>(collection?.productIds ?? [])
  const [confirmDelete, setConfirmDelete] = useState(false)

  // «حاول تاني» لازم تبعت أحدث قيم — مش نسخة من وقت الضغط
  const draftRef = useRef({ title, slug, subtitle, isVisible })
  draftRef.current = { title, slug, subtitle, isVisible }
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const byId = new Map(products.map((product) => [product.id, product]))
  const available = products.filter((product) => !selected.includes(product.id))

  function touchDetails() {
    details.markDirty()
  }

  function saveDetails() {
    const input = {
      slug: draftRef.current.slug,
      title: draftRef.current.title,
      subtitle: draftRef.current.subtitle,
      isVisible: draftRef.current.isVisible,
    }

    if (collection === null) {
      void details.run(() => createCollectionAction(input), {
        onSuccess: (created) => router.replace('/collections/' + created.id),
      })
      return
    }

    void details.run(() => updateCollectionAction(collection.id, input, collection.updatedAt), {
      onSuccess: () => router.refresh(),
    })
  }

  function saveLinks() {
    if (collection === null) return
    void links.run(() => setCollectionProductsAction(collection.id, selectedRef.current), {
      onSuccess: () => router.refresh(),
    })
  }

  function remove() {
    if (collection === null) return
    void removal.run(() => deleteCollectionAction(collection.id, collection.updatedAt), {
      onSuccess: () => router.replace('/collections'),
    })
  }

  function add(id: number) {
    setSelected((current) => (current.includes(id) ? current : [...current, id]))
    links.markDirty()
  }

  function drop(id: number) {
    setSelected((current) => current.filter((item) => item !== id))
    links.markDirty()
  }

  function move(index: number, direction: -1 | 1) {
    setSelected((current) => {
      const next = index + direction
      if (next < 0 || next >= current.length) return current
      const copy = [...current]
      const a = copy[index]
      const b = copy[next]
      if (a === undefined || b === undefined) return current
      copy[index] = b
      copy[next] = a
      return copy
    })
    links.markDirty()
  }

  const detailsBusy = details.state === 'saving'
  const linksBusy = links.state === 'saving'

  return (
    <div className="space-y-4">
      <Card title="بيانات المجموعة">
        <div className="space-y-3">
          <Field htmlFor="title" label="العنوان" hint="اللي بيظهر للزباين فوق المنتجات">
            <input
              id="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                touchDetails()
              }}
              className={inputClasses}
            />
          </Field>

          <Field
            htmlFor="slug"
            label="الرابط المختصر"
            hint="حروف إنجليزي صغيرة وأرقام وشرطات بس. بيظهر في العنوان: /collection/الرابط — وتغييره بيكسر أي لينك قديم."
          >
            <input
              id="slug"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value)
                touchDetails()
              }}
              className={inputClasses}
              dir="ltr"
              placeholder="heat-blocking"
            />
          </Field>

          <Field htmlFor="subtitle" label="وصف مختصر (اختياري)">
            <textarea
              id="subtitle"
              value={subtitle}
              onChange={(event) => {
                setSubtitle(event.target.value)
                touchDetails()
              }}
              className={textareaClasses}
              rows={2}
            />
          </Field>

          <div className="flex items-center justify-between gap-3 rounded border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">إظهار في المتجر</p>
              <p className="text-xs text-muted">
                المجموعة من غير منتجات مابتظهرش في المتجر حتى لو مفعّلة.
              </p>
            </div>
            <Switch
              checked={isVisible}
              onChange={(next) => {
                setIsVisible(next)
                touchDetails()
              }}
              label="إظهار المجموعة في المتجر"
              disabled={!mutationsOn || detailsBusy}
            />
          </div>

          <FailureBanner
            failure={details.failure}
            onRetry={details.retry}
            onDiscardAndRefresh={() => router.refresh()}
          />
          <SaveBar state={details.state} onSave={saveDetails} />
        </div>
      </Card>

      {collection === null ? (
        <p className="text-xs text-muted">
          احفظ المجموعة الأول، وبعدها تقدر تربط المنتجات وتظبط ترتيبهم.
        </p>
      ) : (
        <Card title="منتجات المجموعة">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">
                المختارين ({selected.length}) — الترتيب هنا هو ترتيب العرض
              </p>

              {selected.length === 0 ? (
                <p className="rounded border border-dashed border-border p-3 text-xs text-muted">
                  مفيش منتجات مختارة. المجموعة مش هتظهر في المتجر.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selected.map((id, index) => {
                    const product = byId.get(id)
                    return (
                      <li
                        key={id}
                        className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                          {product ? product.nameAr : 'منتج محذوف (' + String(id) + ')'}
                          {product && !product.isActive ? (
                            <span className="ms-1.5 text-xs text-muted">· متوقّف</span>
                          ) : null}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="لفوق"
                            disabled={!mutationsOn || linksBusy || index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="لتحت"
                            disabled={!mutationsOn || linksBusy || index === selected.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="شيل من المجموعة"
                            disabled={!mutationsOn || linksBusy}
                            onClick={() => drop(id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-muted">ضيف منتج</p>
              {available.length === 0 ? (
                <p className="text-xs text-muted">كل المنتجات مضافة للمجموعة.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {available.map((product) => (
                    <Button
                      key={product.id}
                      variant="secondary"
                      size="sm"
                      disabled={!mutationsOn || linksBusy}
                      onClick={() => add(product.id)}
                    >
                      {product.nameAr}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <FailureBanner
              failure={links.failure}
              onRetry={links.retry}
              onDiscardAndRefresh={() => router.refresh()}
            />
            <SaveBar state={links.state} onSave={saveLinks} />
          </div>
        </Card>
      )}

      {collection === null ? null : (
        <Card title="حذف المجموعة">
          <div className="space-y-3">
            <p className="text-xs text-muted">
              الحذف بيشيل المجموعة وكل ربطها بالمنتجات. المنتجات نفسها مابتتأثرش. الرابط
              /collection/{collection.slug} هيرجّع 404 بعد الحذف.
            </p>

            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!mutationsOn || removal.state === 'saving'}
                  onClick={remove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  أكّد الحذف
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  إلغاء
                </Button>
              </div>
            ) : (
              <Button
                variant="danger"
                size="sm"
                disabled={!mutationsOn}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                احذف المجموعة
              </Button>
            )}

            <FailureBanner
              failure={removal.failure}
              onRetry={removal.retry}
              onDiscardAndRefresh={() => router.refresh()}
            />
          </div>
        </Card>
      )}
    </div>
  )
}
