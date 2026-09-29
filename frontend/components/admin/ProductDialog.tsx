import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AdminProduct } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../lib/shadcn/dialog'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Switch } from '../../lib/shadcn/switch'
import { Textarea } from '../../lib/shadcn/textarea'

export type ProductFormValues = {
  id: number | null
  name_ar: string
  name_en: string
  brand: string
  description_ar: string
  image_url: string
  images_text: string
  before_image: string
  after_image: string
  price_pounds: string
  width_cm: string
  min_length_cm: string
  step_cm: string
  max_length_cm: string
  is_active: boolean
  sort_order: string
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  id: null,
  name_ar: '',
  name_en: '',
  brand: '',
  description_ar: '',
  image_url: '',
  images_text: '',
  before_image: '',
  after_image: '',
  price_pounds: '',
  width_cm: '50',
  min_length_cm: '300',
  step_cm: '50',
  max_length_cm: '3000',
  is_active: true,
  sort_order: '0',
}

export function toFormValues(product: AdminProduct): ProductFormValues {
  return {
    id: product.id,
    name_ar: product.name_ar,
    name_en: product.name_en ?? '',
    brand: product.brand ?? '',
    description_ar: product.description_ar ?? '',
    image_url: product.image_url ?? '',
    images_text: (product.images ?? []).join('\n'),
    before_image: product.before_image ?? '',
    after_image: product.after_image ?? '',
    price_pounds: String(product.price_per_meter_piastres / 100),
    width_cm: String(product.width_cm),
    min_length_cm: String(product.min_length_cm),
    step_cm: String(product.step_cm),
    max_length_cm: String(product.max_length_cm),
    is_active: product.is_active,
    sort_order: String(product.sort_order),
  }
}

type ProductDialogProps = {
  open: boolean
  initial: ProductFormValues
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (values: ProductFormValues) => void
}

export function ProductDialog({ open, initial, saving, error, onClose, onSave }: ProductDialogProps) {
  const [values, setValues] = useState<ProductFormValues>(initial)

  useEffect(() => {
    if (open) setValues(initial)
  }, [open, initial])

  const set = (patch: Partial<ProductFormValues>) => setValues((prev) => ({ ...prev, ...patch }))

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-right">{values.id ? 'تعديل المنتج' : 'منتج جديد'}</DialogTitle>
          <DialogDescription className="sr-only">بيانات المنتج والسعر وقواعد الطول</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="الاسم بالعربي" value={values.name_ar} onChange={(v) => set({ name_ar: v })} />
          <TextField label="الاسم بالإنجليزي" value={values.name_en} onChange={(v) => set({ name_en: v })} dir="ltr" />
          <TextField
            label="الماركة (مثلاً 3M أو V-KOOL)"
            value={values.brand}
            onChange={(v) => set({ brand: v })}
            dir="ltr"
          />

          <div className="sm:col-span-2">
            <Label className="mb-2 block">الوصف</Label>
            <Textarea
              rows={3}
              value={values.description_ar}
              onChange={(e) => set({ description_ar: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <TextField label="الصورة الرئيسية (رابط)" value={values.image_url} onChange={(v) => set({ image_url: v })} dir="ltr" />
          </div>

          <div className="sm:col-span-2">
            <Label className="mb-2 block">صور إضافية — رابط في كل سطر</Label>
            <Textarea
              rows={3}
              dir="ltr"
              className="text-left"
              value={values.images_text}
              onChange={(e) => set({ images_text: e.target.value })}
              placeholder={'https://.../photo-2.jpg'}
            />
          </div>

          <TextField label="صورة «قبل» (رابط)" value={values.before_image} onChange={(v) => set({ before_image: v })} dir="ltr" />
          <TextField label="صورة «بعد» (رابط)" value={values.after_image} onChange={(v) => set({ after_image: v })} dir="ltr" />

          <TextField
            label="سعر المتر (ج.م)"
            value={values.price_pounds}
            onChange={(v) => set({ price_pounds: v })}
            dir="ltr"
            inputMode="decimal"
          />
          <TextField label="العرض (سم)" value={values.width_cm} onChange={(v) => set({ width_cm: v })} dir="ltr" inputMode="numeric" />
          <TextField
            label="أقل طول (سم)"
            value={values.min_length_cm}
            onChange={(v) => set({ min_length_cm: v })}
            dir="ltr"
            inputMode="numeric"
          />
          <TextField label="الخطوة (سم)" value={values.step_cm} onChange={(v) => set({ step_cm: v })} dir="ltr" inputMode="numeric" />
          <TextField
            label="أقصى طول (سم)"
            value={values.max_length_cm}
            onChange={(v) => set({ max_length_cm: v })}
            dir="ltr"
            inputMode="numeric"
          />
          <TextField label="الترتيب" value={values.sort_order} onChange={(v) => set({ sort_order: v })} dir="ltr" inputMode="numeric" />

          <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
            <Label htmlFor="is_active">معروض للبيع</Label>
            <Switch id="is_active" checked={values.is_active} onCheckedChange={(v) => set({ is_active: v })} />
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => onSave(values)} disabled={saving}>
            {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            حفظ
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TextField({
  label,
  value,
  onChange,
  dir,
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  dir?: 'ltr' | 'rtl'
  inputMode?: 'numeric' | 'decimal' | 'text'
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(dir ? { dir, className: 'text-left' } : {})}
        {...(inputMode ? { inputMode } : {})}
      />
    </div>
  )
}
