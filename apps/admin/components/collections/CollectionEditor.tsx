'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Trash2, X } from 'lucide-react'
import {
  createCollectionAction,
  deleteCollectionAction,
  setCollectionProductsAction,
  updateCollectionAction,
} from '../../lib/actions'
import type { AdminCollectionDetail, AdminProduct } from '../../lib/adminData'
import { collectionVisibility, VISIBILITY_TONE } from '../../lib/collectionStatus'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button, buttonClasses } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'
import { CollectionCoverCard } from './CollectionCoverCard'

/**
 * محرّر قسم.
 *
 * ⚠️ **حفظين منفصلين عن قصد**: بيانات القسم (صف واحد، تزامن تفاؤلي
 *    بـ updated_at) وقائمة المنتجات (صفوف كتير، دالة ذرّية). لو
 *    جمعناهم في زرار واحد، فشل نصّه كان هيسيب الحالة نصف محفوظة.
 *    والغلاف ليه رفعه الخاص في بطاقته.
 *
 * ⚠️ في وضع الإنشاء مفيش ربط منتجات ولا غلاف: القسم لازم يبقى له id
 *    الأول. بعد الإنشاء بنروح لصفحة التعديل بـreplace.
 *
 * ⚠️ تغيير الرابط المختصر لقسم موجود بيطلب **تأكيد صريح** قبل الحفظ —
 *    أي لينك قديم اتشارك للقسم بيرجّع 404 بعده.
 *
 * ⚠️ ترتيب المنتجات جوه القسم بيتحفظ فعلًا (sort_order في جدول الربط)،
 *    وده الترتيب اللي المتجر بيعرض بيه.
 */

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function PlacementRow({
  title,
  hint,
  checked,
  onChange,
  label,
  disabled,
}: {
  title: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}

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
  const [showOnHome, setShowOnHome] = useState(collection?.showOnHome ?? true)
  const [showInNav, setShowInNav] = useState(collection?.showInNav ?? true)
  const [selected, setSelected] = useState<number[]>(collection?.productIds ?? [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSlug, setConfirmSlug] = useState(false)

  // «حاول تاني» لازم تبعت أحدث قيم — مش نسخة من وقت الضغط
  const draftRef = useRef({ title, slug, subtitle, showOnHome, showInNav })
  draftRef.current = { title, slug, subtitle, showOnHome, showInNav }
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const byId = new Map(products.map((product) => [product.id, product]))
  const available = products.filter((product) => !selected.includes(product.id))
  const activeSelected = selected.filter((id) => byId.get(id)?.isActive === true).length
  const status = collectionVisibility({
    showOnHome,
    showInNav,
    productCount: selected.length,
    activeProductCount: activeSelected,
  })
  const originalSlug = collection?.slug ?? null
  const slugChanged = originalSlug !== null && normalizeSlug(slug) !== originalSlug

  function touchDetails() {
    details.markDirty()
  }

  function saveDetails(slugConfirmed: boolean) {
    const draft = draftRef.current
    if (collection !== null && !slugConfirmed && normalizeSlug(draft.slug) !== collection.slug) {
      setConfirmSlug(true)
      return
    }
    setConfirmSlug(false)

    const input = {
      slug: draft.slug,
      title: draft.title,
      subtitle: draft.subtitle,
      showOnHome: draft.showOnHome,
      showInNav: draft.showInNav,
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
      <Card title="بيانات القسم">
        <div className="space-y-3">
          <Field htmlFor="title" label="الاسم" hint="اللي بيظهر للزباين فوق المنتجات وفي القائمة">
            <input
              id="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                touchDetails()
              }}
              className={inputClasses}
              placeholder="اكتب اسم القسم"
            />
          </Field>

          <Field
            htmlFor="slug"
            label="الرابط المختصر"
            hint="حروف إنجليزي صغيرة وأرقام وشرطات بس. بيظهر في العنوان: /collection/الرابط"
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
              placeholder="section-name"
            />
          </Field>

          {slugChanged ? (
            <p className="rounded border border-gold/40 bg-gold/10 p-2 text-xs font-semibold text-fg">
              تغيير الرابط بيكسر أي لينك قديم اتشارك للقسم (/collection/{originalSlug}). هنطلب منك تأكيد قبل
              الحفظ.
            </p>
          ) : null}

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

          <div className="space-y-3 rounded border border-border p-3">
            <PlacementRow
              title="إظهار في الرئيسية"
              hint="القسم ومنتجاته بيظهروا كجزء مستقل في الصفحة الرئيسية."
              checked={showOnHome}
              onChange={(next) => {
                setShowOnHome(next)
                touchDetails()
              }}
              label="إظهار القسم في الرئيسية"
              disabled={!mutationsOn || detailsBusy}
            />
            <PlacementRow
              title="إظهار في قائمة الأقسام"
              hint="بيظهر في الهيدر وقائمة الموبايل، وبياخد صفحة خاصة على /collection/الرابط."
              checked={showInNav}
              onChange={(next) => {
                setShowInNav(next)
                touchDetails()
              }}
              label="إظهار القسم في قائمة الأقسام"
              disabled={!mutationsOn || detailsBusy}
            />
            <p className={'border-t border-border pt-2 text-xs font-semibold ' + VISIBILITY_TONE[status.tone]}>
              {status.label} — {status.detail}
            </p>
            {collection === null ? (
              <p className="text-xs text-muted">
                القسم الجديد بيظهر أول القائمة، وتقدر تحرّكه بعدين من صفحة الأقسام.
              </p>
            ) : null}
          </div>

          <FailureBanner
            failure={details.failure}
            onRetry={details.retry}
            onDiscardAndRefresh={() => router.refresh()}
          />
          <SaveBar state={details.state} onSave={() => saveDetails(false)} warning={details.warning} />
        </div>
      </Card>

      {collection === null ? null : <CollectionCoverCard collection={collection} />}

      {collection === null ? (
        <p className="text-xs text-muted">احفظ القسم الأول، وبعدها تقدر تضيف المنتجات والصورة وتظبط الترتيب.</p>
      ) : (
        <Card title="منتجات القسم">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">
                المختارين ({selected.length}) — الترتيب هنا هو ترتيب العرض
              </p>

              {selected.length === 0 ? (
                <p className="rounded border border-dashed border-border p-3 text-xs text-muted">
                  مفيش منتجات مختارة. القسم مش هيظهر في المتجر.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selected.map((id, index) => {
                    const product = byId.get(id)
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                          {product ? product.nameAr : 'منتج محذوف (' + String(id) + ')'}
                          {product && !product.isActive ? (
                            <span className="ms-1.5 text-xs text-muted">· متوقّف ومخفي من القسم</span>
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
                            aria-label="شيل من القسم"
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

              {selected.length > 0 && activeSelected === 0 ? (
                <p className="mt-2 text-xs font-semibold text-gold">
                  كل المنتجات المختارة متوقفة، فالقسم مش هيظهر للزباين لحد ما منتج منهم يتفعّل.
                </p>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted">ضيف منتج موجود</p>
                <Link
                  href={'/products/new?collection=' + encodeURIComponent(collection.id)}
                  className={buttonClasses('secondary', 'sm')}
                >
                  منتج جديد في القسم ده
                </Link>
              </div>
              {available.length === 0 ? (
                <p className="text-xs text-muted">كل المنتجات مضافة للقسم.</p>
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
                      {product.isActive ? '' : ' (متوقّف)'}
                    </Button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted">المنتج ينفع يبقى في أكتر من قسم.</p>
            </div>

            <FailureBanner
              failure={links.failure}
              onRetry={links.retry}
              onDiscardAndRefresh={() => router.refresh()}
            />

            {/*
              ⚠️ زرار جوه البطاقة، **مش** SaveBar: SaveBar مبني sticky
              bottom-0، فاتنين منه على نفس الصفحة بيقعدوا فوق بعض.
            */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">
                {links.state === 'dirty'
                  ? 'فيه تغييرات مش محفوظة في قائمة المنتجات'
                  : links.state === 'saving'
                    ? 'بيحفظ…'
                    : links.state === 'saved'
                      ? 'قائمة المنتجات اتحفظت'
                      : links.state === 'error' || links.state === 'conflict'
                        ? 'حفظ قائمة المنتجات فشل'
                        : 'مفيش تغييرات في قائمة المنتجات'}
              </p>
              <Button
                disabled={!mutationsOn || linksBusy || links.state === 'idle' || links.state === 'saved'}
                onClick={saveLinks}
              >
                احفظ قائمة المنتجات
              </Button>
            </div>
          </div>
        </Card>
      )}

      {collection === null ? null : (
        <Card title="حذف القسم">
          <div className="space-y-3">
            <p className="text-xs text-muted">
              الحذف بيشيل القسم وكل ربطه بالمنتجات. المنتجات نفسها مابتتأثرش، وصورة الغلاف بتتسجّل للتنظيف.
              الرابط /collection/{collection.slug} هيرجّع 404 بعد الحذف.
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
              <Button variant="danger" size="sm" disabled={!mutationsOn} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                احذف القسم
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

      <ConfirmDialog
        open={confirmSlug}
        title="تغيير رابط القسم؟"
        message={
          'الرابط هيتغيّر من /collection/' +
          (originalSlug ?? '') +
          ' إلى /collection/' +
          normalizeSlug(slug) +
          '. أي لينك قديم اتشارك للقسم هيرجّع 404.'
        }
        confirmLabel="غيّر الرابط واحفظ"
        onCancel={() => setConfirmSlug(false)}
        onConfirm={() => saveDetails(true)}
      />
    </div>
  )
}
