'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { computeSubtotalPiastres, validateRules } from '@zell/core'
import { saveProductAction } from '../../lib/actions'
import type { AdminProductDetail } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatLength, formatPiastres, piastresToPounds, poundsToPiastres } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { ImageManager } from './ImageManager'

type Tab = 'details' | 'pricing' | 'images'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'details', label: 'بيانات' },
  { key: 'pricing', label: 'التسعير والعروض' },
  { key: 'images', label: 'صور' },
]

const EMPTY = {
  nameAr: '',
  nameEn: '',
  descriptionAr: '',
  shortBenefit: '',
  benefits: [] as string[],
  pricePounds: '0',
  widthCm: '50',
  lockWidth: false,
  comparePounds: '',
  minLengthCm: '300',
  stepCm: '50',
  maxLengthCm: '3000',
}

/** collectionId: إنشاء من جوه قسم — المنتج بيتضاف آخر القسم بعد الحفظ. */
export function ProductEditor({
  product,
  collectionId,
  widthsSlot,
}: {
  product: AdminProductDetail | null
  collectionId?: string
  /** 0015 — كارت «عروض الرول» بيتعرض جوه تاب التسعير (ليه حفظ خاص بيه). */
  widthsSlot?: ReactNode
}) {
  const router = useRouter()
  const { state: saveState, failure, warning, run, retry, markDirty } = useSaveAction()
  const [tab, setTab] = useState<Tab>('details')

  const [form, setForm] = useState(
    product
      ? {
          nameAr: product.nameAr,
          nameEn: product.nameEn,
          descriptionAr: product.descriptionAr,
          shortBenefit: product.shortBenefit,
          benefits: product.benefits,
          pricePounds: piastresToPounds(product.pricePerMeterPiastres),
          widthCm: String(product.widthCm),
          lockWidth: product.lockWidth,
          comparePounds: product.compareAtPiastres ? piastresToPounds(product.compareAtPiastres) : '',
          minLengthCm: String(product.minLengthCm),
          stepCm: String(product.stepCm),
          maxLengthCm: String(product.maxLengthCm),
        }
      : EMPTY,
  )

  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch })
    markDirty()
  }

  /**
   * ⚠️ الـ refs دي هي اللي بتخلي «حاول تاني» تبعت **أحدث** بيانات.
   * أي thunk بيقرا من متغيّر الـ render مباشرة كان هيبعت نسخة قديمة
   * لو المستخدم عدّل بعد الفشل.
   */
  const formRef = useRef(form)
  formRef.current = form
  const stampRef = useRef(product?.updatedAt ?? '')
  stampRef.current = product?.updatedAt ?? ''
  const productRef = useRef(product)
  productRef.current = product

  // بعد نجاح الحفظ الـ props بتتغيّر فالفورم بيتزامن من السيرفر.
  // لو الحفظ فشل مفيش حاجة بتتغيّر والتعديلات بتفضل زي ما هي.
  const [syncedAt, setSyncedAt] = useState(product?.updatedAt ?? '')
  useEffect(() => {
    const latest = product?.updatedAt ?? ''
    if (latest === syncedAt) return
    setSyncedAt(latest)
    if (!product) return
    setForm({
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      descriptionAr: product.descriptionAr,
      shortBenefit: product.shortBenefit,
      benefits: product.benefits,
      pricePounds: piastresToPounds(product.pricePerMeterPiastres),
      widthCm: String(product.widthCm),
      lockWidth: product.lockWidth,
      comparePounds: product.compareAtPiastres ? piastresToPounds(product.compareAtPiastres) : '',
      minLengthCm: String(product.minLengthCm),
      stepCm: String(product.stepCm),
      maxLengthCm: String(product.maxLengthCm),
    })
  }, [product, syncedAt])

  /**
   * ⚠️ **كل** قيمة في الـ payload بتتقرا من ref، ولا حاجة من closure
   * الـ render.
   *
   * الحقول من formRef، والنسخة من stampRef، والقيم المشتقة من المنتج
   * (id · sortOrder · isActive) من productRef.
   *
   * السبب: الـ thunk اللي «حاول تاني» بتعيده اتعمل في render قديم.
   * الحقول كانت مضمونة من formRef، لكن sortOrder و isActive كانوا
   * بيتقروا من prop الـ render القديم — ولو الـ props اتغيّرت بين
   * الفشل والإعادة (وده وارد: ImageManager جوه نفس الصفحة بيعمل
   * router.refresh بعد أي عملية صورة)، الإعادة كانت هتكتب isActive
   * قديم وترجّع إظهار المنتج لحالة عدّاها.
   *
   * الإظهار **مش** بيتغيّر من هنا: الإنشاء بيتولد مخفي من السيرفر،
   * والتعديل بيبعت القيمة الحالية زي ما هي. التفعيل عملية منفصلة
   * بشروط جاهزية في جدول المنتجات.
   */
  function buildInput() {
    const draft = formRef.current
    const current = productRef.current
    const base = {
      nameAr: draft.nameAr,
      nameEn: draft.nameEn,
      descriptionAr: draft.descriptionAr,
      shortBenefit: draft.shortBenefit,
      benefits: draft.benefits,
      pricePerMeterPiastres: poundsToPiastres(draft.pricePounds),
      widthCm: Number(draft.widthCm),
      lockWidth: draft.lockWidth,
      compareAtPiastres: draft.comparePounds.trim() === '' ? null : poundsToPiastres(draft.comparePounds),
      minLengthCm: Number(draft.minLengthCm),
      stepCm: Number(draft.stepCm),
      maxLengthCm: Number(draft.maxLengthCm),
      sortOrder: current?.sortOrder ?? 0,
      isActive: current?.isActive ?? false,
    }
    if (!current) return base
    return { ...base, id: current.id, expectedUpdatedAt: stampRef.current }
  }

  function save() {
    void run(() => saveProductAction(buildInput(), productRef.current ? undefined : collectionId), {
      onSuccess: (saved) => {
        // إنشاء: replace مش push عشان زرار Back مايرجعش لفورم إنشاء قديم
        if (!productRef.current) {
          router.replace('/products/' + String(saved.id))
          return
        }
        productRef.current = { ...productRef.current, ...saved }
        stampRef.current = saved.updatedAt
      },
    })
  }

  const rules = {
    price_per_meter_piastres: poundsToPiastres(form.pricePounds),
    min_length_cm: Number(form.minLengthCm),
    step_cm: Number(form.stepCm),
    max_length_cm: Number(form.maxLengthCm),
    width_cm: Number(form.widthCm),
  }
  const rulesCheck = validateRules(rules)

  // الخصم — عرض بس: الزبون بيدفع «سعر المتر»، و«السعر قبل الخصم» بيظهر مشطوب
  const comparePiastres = form.comparePounds.trim() === '' ? 0 : poundsToPiastres(form.comparePounds)
  const discountPercent =
    comparePiastres > rules.price_per_meter_piastres && rules.price_per_meter_piastres > 0
      ? Math.round((1 - rules.price_per_meter_piastres / comparePiastres) * 100)
      : 0
  const discountError =
    form.comparePounds.trim() !== '' && comparePiastres <= rules.price_per_meter_piastres
      ? 'لازم يكون أكبر من سعر المتر — أو سيبه فاضي'
      : undefined

  /** خصم سريع: الأساس = السعر قبل الخصم لو موجود، وإلا السعر الحالي. */
  function applyPercent(percent: number) {
    const basePounds = comparePiastres > 0 ? comparePiastres / 100 : poundsToPiastres(form.pricePounds) / 100
    if (basePounds <= 0) return
    const next = Math.max(1, Math.round(basePounds * (1 - percent / 100)))
    set({ comparePounds: String(basePounds), pricePounds: String(next) })
  }

  function removeDiscount() {
    if (comparePiastres > 0) set({ pricePounds: String(comparePiastres / 100), comparePounds: '' })
    else set({ comparePounds: '' })
  }

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              tab === item.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="الأساسيات">
            <div className="space-y-3">
              <Field htmlFor="nameAr" label="الاسم بالعربي">
                <input id="nameAr" value={form.nameAr} onChange={(e) => set({ nameAr: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="nameEn" label="الاسم بالإنجليزي" hint="اختياري — بيظهر تحت الاسم في صفحة المنتج">
                <input id="nameEn" value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} className={inputClasses} dir="ltr" />
              </Field>
              <Field htmlFor="desc" label="الوصف">
                <textarea id="desc" value={form.descriptionAr} onChange={(e) => set({ descriptionAr: e.target.value })} className={textareaClasses} />
              </Field>
            </div>
          </Card>

          <Card title="نصوص العرض">
            <div className="space-y-3">
              <Field
                htmlFor="benefit"
                label="الفائدة المختصرة"
                hint={'بتظهر في كارت المنتج · ' + String(form.shortBenefit.length) + '/180'}
                error={form.shortBenefit.length > 180 ? 'أطول من الحد المسموح' : undefined}
              >
                <input id="benefit" value={form.shortBenefit} onChange={(e) => set({ shortBenefit: e.target.value })} className={inputClasses} />
              </Field>

              <Field label="المميزات" hint="بتظهر في صفحة المنتج — ٦ كحد أقصى، كل واحدة ١٤٠ حرف">
                <div className="space-y-2">
                  {form.benefits.map((point, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <input
                        value={point}
                        onChange={(e) => {
                          const next = [...form.benefits]
                          next[index] = e.target.value
                          set({ benefits: next })
                        }}
                        className={inputClasses}
                        aria-label={'ميزة رقم ' + String(index + 1)}
                        placeholder="اكتب ميزة للمنتج"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={'احذف ميزة رقم ' + String(index + 1)}
                        onClick={() => set({ benefits: form.benefits.filter((_, position) => position !== index) })}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  ))}
                  {form.benefits.length === 0 ? <p className="text-xs text-muted">مفيش مميزات مسجّلة.</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={form.benefits.length >= 6}
                      onClick={() => set({ benefits: [...form.benefits, ''] })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      ضيف ميزة
                    </Button>
                    <span className="text-xs text-muted">{String(form.benefits.length) + ' من 6'}</span>
                  </div>
                </div>
              </Field>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'pricing' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="العرض الأساسي وقواعد الطول">
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="price" label="سعر المتر للعرض الأساسي (ج.م)">
                <input id="price" type="number" min={0} value={form.pricePounds} onChange={(e) => set({ pricePounds: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="width" label="العرض الأساسي للرول (سم)" hint="عروض تانية بأسعارها؟ من «عروض الرول» تحت">
                <input id="width" type="number" min={1} value={form.widthCm} onChange={(e) => set({ widthCm: e.target.value })} className={inputClasses} />
                <label className="mt-2 flex items-start gap-2 text-xs text-fg">
                  <input
                    type="checkbox"
                    checked={form.lockWidth}
                    onChange={(e) => set({ lockWidth: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                  />
                  <span>
                    <span className="font-semibold">تثبيت العرض</span> — الزبون مايكتبش عرض الشباك، والخانة بتظهر له
                    مقفولة على الرقم ده. اختيار الطول بالمتر بيفضل زي ما هو.
                  </span>
                </label>
              </Field>
              <Field htmlFor="min" label="أقل طول للطلب (سم)" hint={'= ' + formatLength(Number(form.minLengthCm)) + ' — أقل حاجة الزبون يقدر يطلبها'}>
                <input id="min" type="number" min={1} value={form.minLengthCm} onChange={(e) => set({ minLengthCm: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="step" label="الزيادة كل مرة (سم)" hint={'= ' + formatLength(Number(form.stepCm)) + ' — الطول بيزيد بالمقدار ده'}>
                <input id="step" type="number" min={1} value={form.stepCm} onChange={(e) => set({ stepCm: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="max" label="أقصى طول للطلب (سم)" className="col-span-2" hint={'= ' + formatLength(Number(form.maxLengthCm)) + ' — أكبر من كده الزبون بيتطلب منه يكلمك واتساب'}>
                <input id="max" type="number" min={1} value={form.maxLengthCm} onChange={(e) => set({ maxLengthCm: e.target.value })} className={inputClasses} />
              </Field>
            </div>

            {rulesCheck.ok ? (
              <p className="mt-3 rounded border border-border bg-bg p-2 text-xs text-fg">
                {'الزبون يقدر يطلب من ' +
                  formatLength(rules.min_length_cm) +
                  ' لحد ' +
                  formatLength(rules.max_length_cm) +
                  '، والطول بيزيد ' +
                  formatLength(rules.step_cm) +
                  ' كل مرة. القواعد دي لكل عروض الرول بتاعة المنتج.'}
              </p>
            ) : null}
            {!rulesCheck.ok ? (
              <p className="mt-3 rounded border border-danger/40 bg-danger/5 p-2 text-xs font-medium text-danger">
                {rulesCheck.message}
              </p>
            ) : null}
          </Card>

          <Card title="الخصم">
            <div className="space-y-3">
              <p className="text-xs text-muted">
                الزبون بيدفع «سعر المتر» بس. «السعر قبل الخصم» بيظهر مشطوب جنبه، وعلى المنتج علامة بنسبة الخصم.
              </p>
              <Field
                htmlFor="compare"
                label="السعر قبل الخصم (ج.م)"
                hint="فاضي = مفيش خصم"
                error={discountError}
              >
                <input
                  id="compare"
                  type="number"
                  min={0}
                  value={form.comparePounds}
                  onChange={(e) => set({ comparePounds: e.target.value })}
                  className={inputClasses}
                  placeholder="مثلًا 200"
                />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-fg">خصم سريع</p>
                <div className="flex flex-wrap gap-1.5">
                  {[10, 15, 20, 25].map((percent) => (
                    <Button key={percent} variant="secondary" size="sm" onClick={() => applyPercent(percent)}>
                      {String(percent) + '٪'}
                    </Button>
                  ))}
                  {form.comparePounds.trim() !== '' ? (
                    <Button variant="ghost" size="sm" onClick={removeDiscount}>
                      شيل الخصم
                    </Button>
                  ) : null}
                </div>
              </div>
              {discountPercent > 0 ? (
                <p className="rounded border border-border bg-bg p-2 text-xs text-fg">
                  {'الزبون هيشوف: خصم ' + String(discountPercent) + '٪ — '}
                  <span className="text-muted line-through">{formatPiastres(comparePiastres)}</span>
                  {' ← '}
                  <span className="font-bold">{formatPiastres(rules.price_per_meter_piastres)}</span>
                  {' للمتر'}
                </p>
              ) : null}
            </div>
          </Card>

          <Card title="معاينة الحساب">
            <p className="text-xs text-muted">
              نفس دوال التسعير اللي بتحسب للزبون في المتجر — لو الرقم هنا صح، هو صح عنده.
            </p>
            <dl className="mt-3 divide-y divide-border">
              {[rules.min_length_cm, rules.min_length_cm + rules.step_cm * 2, rules.max_length_cm].map((length) => (
                <div key={length} className="flex items-center justify-between py-2 text-sm">
                  <dt className="text-muted">{formatLength(length)}</dt>
                  <dd className="font-semibold text-fg">
                    {formatPiastres(computeSubtotalPiastres(rules.price_per_meter_piastres, length))}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {widthsSlot ? <div className="lg:col-span-2">{widthsSlot}</div> : null}
        </div>
      ) : null}

      {tab === 'images' && product ? <ImageManager productId={product.id} images={product.images} /> : null}
      {tab === 'images' && !product ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-xs text-muted">
          احفظ المنتج الأول، وبعدين ارفع صوره وحدّد الرئيسية.
        </p>
      ) : null}

      {!product ? (
        <p className="mt-4 text-xs text-muted">
          المنتج الجديد بيتحفظ <span className="font-semibold text-fg">مخفي</span> دايمًا. بعد ما تكمّل الوصف
          والفايدة المختصرة وتحدّد صورة رئيسية، فعّله من جدول المنتجات.
        </p>
      ) : null}

      <div className="mt-4">
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>

      <SaveBar state={saveState} onSave={save} warning={warning} />
    </div>
  )
}
