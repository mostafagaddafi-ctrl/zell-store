'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp, ImageOff } from 'lucide-react'
import { reorderProductsAction, setProductVisibilityAction } from '../../lib/actions'
import type { AdminProduct } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatLength, formatPiastres } from '../../lib/format'
import { useMutationsEnabled } from '../../lib/readiness'
import { Badge } from '../ui/Badge'
import { Button, buttonClasses } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Switch } from '../ui/Switch'
import { Table, TD, TH, THead, TR } from '../ui/Table'

/**
 * أزرار «فوق/تحت» بدل السحب — أثبت على الموبايل وأسهل في الاختبار.
 *
 * ⚠️ الترتيب بيتبعت **كل** المنتجات بما فيها المخفية.
 * zell_reorder_products بتعدّ public.products كلها من غير أي فلتر على
 * is_active، وبترفض أي مجموعة ناقصة. الصفحة بتمرر النشط وغير النشط،
 * فالمجموعة كاملة.
 *
 * التفعيل ممكن يفشل VALIDATION لو المنتج ناقص (وصف · فايدة مختصرة ·
 * صورة رئيسية). ده الحارس شغّال مش خطأ.
 */
export function ProductsTable({ products }: { products: AdminProduct[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry } = useSaveAction()
  const [busyId, setBusyId] = useState<number | null>(null)

  const productsRef = useRef(products)
  productsRef.current = products

  const busy = state === 'saving'

  function toggle(product: AdminProduct, next: boolean) {
    setBusyId(product.id)
    void run(() => setProductVisibilityAction(product.id, next, product.updatedAt), {
      onSuccess: () => router.refresh(),
    })
  }

  function move(index: number, delta: number) {
    const ordered = productsRef.current.map((item) => item.id)
    const target = index + delta
    const from = ordered[index]
    const to = ordered[target]
    if (from === undefined || to === undefined) return

    ordered[index] = to
    ordered[target] = from
    setBusyId(from)

    void run(() => reorderProductsAction(ordered), { onSuccess: () => router.refresh() })
  }

  return (
    <div className="space-y-3">
      {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      {/* الموبايل: كارت لكل منتج بدل جدول بسكرول جانبي */}
      <ul className="space-y-2 md:hidden">
        {products.map((product, index) => (
          <li key={product.id} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link href={'/products/' + String(product.id)} className="font-semibold text-accent">
                  {product.nameAr}
                </Link>
                {product.shortBenefit ? (
                  <p className="text-xs text-muted">{product.shortBenefit}</p>
                ) : (
                  <p className="text-xs text-danger">مفيش فائدة مختصرة</p>
                )}
                <p className="mt-1 text-sm font-semibold text-fg">
                  {formatPiastres(product.pricePerMeterPiastres)}{' '}
                  <span className="text-xs font-normal text-muted">للمتر</span>
                </p>
                <p className="text-xs text-muted">
                  {formatLength(product.minLengthCm)} – {formatLength(product.maxLengthCm)} · خطوة{' '}
                  {formatLength(product.stepCm)}
                </p>
              </div>
              {product.imageCount > 0 ? (
                <Badge tone="ok">{product.imageCount} صور</Badge>
              ) : (
                <Badge tone="danger">
                  <ImageOff className="h-3 w-3" />
                  مفيش صور
                </Badge>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={product.isActive}
                  onChange={(next) => toggle(product, next)}
                  disabled={!mutationsOn || busy}
                  label={'إظهار ' + product.nameAr}
                />
                <span className="text-xs text-fg">ظاهر</span>
              </div>
              <div className="ms-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!mutationsOn || busy || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="تحريك لفوق"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!mutationsOn || busy || index === products.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="تحريك لتحت"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Link href={'/products/' + String(product.id)} className={buttonClasses('secondary', 'sm')}>
                  تعديل
                </Link>
              </div>
            </div>
            {busyId === product.id && busy ? <p className="mt-1 text-xs text-muted">بيحفظ…</p> : null}
          </li>
        ))}
      </ul>

      <Table className="hidden md:block">
        <THead>
          <TR>
            <TH className="w-20">الترتيب</TH>
            <TH>المنتج</TH>
            <TH>سعر المتر</TH>
            <TH>المقاسات</TH>
            <TH>الصور</TH>
            <TH>ظاهر</TH>
            <TH />
          </TR>
        </THead>
        <tbody>
          {products.map((product, index) => (
            <TR key={product.id}>
              <TD>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mutationsOn || busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="تحريك لفوق"
                    className="h-7 w-7 px-0"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mutationsOn || busy || index === products.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="تحريك لتحت"
                    className="h-7 w-7 px-0"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TD>

              <TD>
                <Link href={'/products/' + String(product.id)} className="font-semibold text-accent">
                  {product.nameAr}
                </Link>
                {product.shortBenefit ? (
                  <span className="block text-xs text-muted">{product.shortBenefit}</span>
                ) : (
                  <span className="block text-xs text-danger">مفيش فائدة مختصرة</span>
                )}
                {busyId === product.id && busy ? (
                  <span className="block text-xs text-muted">بيحفظ…</span>
                ) : null}
              </TD>

              <TD className="font-semibold">{formatPiastres(product.pricePerMeterPiastres)}</TD>

              <TD className="text-xs text-muted">
                {formatLength(product.minLengthCm)} – {formatLength(product.maxLengthCm)}
                <span className="block">خطوة {formatLength(product.stepCm)}</span>
              </TD>

              <TD>
                {product.imageCount > 0 ? (
                  <Badge tone="ok">{product.imageCount}</Badge>
                ) : (
                  <Badge tone="danger">
                    <ImageOff className="h-3 w-3" />
                  </Badge>
                )}
              </TD>

              <TD>
                <Switch
                  checked={product.isActive}
                  onChange={(next) => toggle(product, next)}
                  disabled={!mutationsOn || busy}
                  label={'إظهار ' + product.nameAr}
                />
              </TD>

              <TD>
                <Link href={'/products/' + String(product.id)} className="text-xs font-semibold text-accent">
                  تعديل
                </Link>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
