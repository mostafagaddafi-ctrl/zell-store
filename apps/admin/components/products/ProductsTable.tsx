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
import { Button } from '../ui/Button'
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

      <Table>
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
