'use client'

import Link from 'next/link'
import { ChevronDown, ChevronUp, ImageOff } from 'lucide-react'
import type { AdminProduct } from '../../lib/adminData'
import { formatLength, formatPiastres } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Switch } from '../ui/Switch'
import { Table, TD, TH, THead, TR } from '../ui/Table'

/**
 * المرحلة أ: أزرار «فوق/تحت» بدل السحب — أثبت على الموبايل وأسهل
 * في الاختبار. السحب ممكن يتضاف بعدين من غير تغيير العقد.
 */
export function ProductsTable({ products }: { products: AdminProduct[] }) {
  return (
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
                <Button variant="ghost" size="sm" disabled={index === 0} aria-label="تحريك لفوق" className="h-7 w-7 px-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === products.length - 1}
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
              <Switch checked={product.isActive} onChange={() => undefined} disabled label={'إظهار ' + product.nameAr} />
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
  )
}
