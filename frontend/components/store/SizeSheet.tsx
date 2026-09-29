import { productPhotos } from '../../lib/core/productPhotos'
import type { StoreProduct } from '../../lib/core/types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../lib/shadcn/sheet'
import { ProductArt } from './ProductArt'
import { SizePicker } from './SizePicker'

/** الطريق السريع: يختار المقاس ويضيف للسلة من غير ما يسيب الصفحة. */
export function SizeSheet({
  product,
  open,
  onOpenChange,
  onConfirm,
}: {
  product: StoreProduct | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (productId: number, lengthCm: number) => void
}) {
  if (!product) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" dir="rtl" className="rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border px-4 py-3 text-right">
          <SheetTitle className="text-right text-base">{product.name_ar}</SheetTitle>
          <SheetDescription className="text-right text-xs">قد إيه المقاس اللي محتاجه؟</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6 pt-4">
          <div className="overflow-hidden rounded-xl border border-border">
            <ProductArt
              src={productPhotos(product)[0] ?? null}
              alt={product.name_ar}
              nameEn={product.name_en}
              seed={product.id}
              className="h-28 w-full"
            />
          </div>

          <SizePicker product={product} onConfirm={onConfirm} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
