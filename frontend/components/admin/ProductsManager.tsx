import { useState } from 'react'
import { ImageOff, Pencil, Plus, RefreshCw } from 'lucide-react'
import { formatLength, formatPiastres } from '../../lib/core/pricing'
import type { AdminProduct } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import { Badge } from '../../lib/shadcn/badge'
import {
  EMPTY_PRODUCT_FORM,
  ProductDialog,
  toFormValues,
  type ProductFormValues,
} from './ProductDialog'

type ProductsManagerProps = {
  products: AdminProduct[]
  loading: boolean
  saving: boolean
  saveError: string | null
  onRefresh: () => void
  onSave: (values: ProductFormValues) => Promise<boolean>
}

export function ProductsManager({
  products,
  loading,
  saving,
  saveError,
  onRefresh,
  onSave,
}: ProductsManagerProps) {
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<ProductFormValues>(EMPTY_PRODUCT_FORM)

  const openNew = () => {
    setInitial(EMPTY_PRODUCT_FORM)
    setOpen(true)
  }

  const openEdit = (product: AdminProduct) => {
    setInitial(toFormValues(product))
    setOpen(true)
  }

  const handleSave = async (values: ProductFormValues) => {
    const ok = await onSave(values)
    if (ok) setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">المنتجات والأسعار</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`ml-2 h-4 w-4${loading ? ' animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="ml-2 h-4 w-4" />
            منتج جديد
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <div key={product.id} className="flex gap-3 rounded-lg border border-border bg-card p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name_ar} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="h-5 w-5" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h4 className="truncate font-medium text-card-foreground">{product.name_ar}</h4>
                <Badge variant={product.is_active ? 'default' : 'secondary'}>
                  {product.is_active ? 'معروض' : 'مخفي'}
                </Badge>
              </div>
              {product.brand ? (
                <span dir="ltr" className="mt-0.5 inline-block text-[11px] font-bold text-muted-foreground">
                  {product.brand}
                </span>
              ) : null}
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatPiastres(product.price_per_meter_piastres)}
                <span className="text-xs font-normal text-muted-foreground"> / متر</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {`عرض ${product.width_cm} سم · من ${formatLength(product.min_length_cm)} بخطوة ${formatLength(product.step_cm)}`}
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => openEdit(product)}>
                <Pencil className="ml-2 h-3.5 w-3.5" />
                تعديل
              </Button>
            </div>
          </div>
        ))}

        {products.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">مفيش منتجات لسه — ابدأ بإضافة منتج.</p>
        ) : null}
      </div>

      <ProductDialog
        open={open}
        initial={initial}
        saving={saving}
        error={saveError}
        onClose={() => setOpen(false)}
        onSave={handleSave}
      />
    </div>
  )
}
