'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { saveAddonsTitleAction, saveProductAction, saveProductAddonsAction, saveProductWidthsAction } from '../../lib/actions'
import type { AdminProductDetail } from '../../lib/adminData'
import type { AdminWidth } from '../../lib/mutations/productWidths'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { piastresToPounds, poundsToPiastres } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { ImageManager } from './ImageManager'
import { extraWidthsPayload, pricingProblem, PricingFields, toWidthDraft, type WidthDraft } from './PricingFields'
import type { AddonOption } from '../../lib/mutations/productAddons'
import { AddonsSelector } from './AddonsSelector'
import { PiecePricing, pieceProblem, SaleUnitSwitch, type SaleUnit } from './PiecePricing'

type Tab = 'details' | 'pricing' | 'images'

/** تحذيرات إنشاء المنتج بتتنقل لصفحته عن طريق sessionStorage عشان ماتضيعش مع الانتقال. */
const WARNING_KEY = 'zell-admin:product-warning:'

/** نفس اللحظة؟ النص الأول، وبعدين الميلي ثانية — نفس منطق sameInstant في السيرفر. */
function sameStamp(left: string, right: string): boolean {
  if (left === right) return true
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && a === b
}

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
  extraWidths: [] as WidthDraft[],
  saleUnit: 'meter' as SaleUnit,
  isListed: true,
  maxQuantity: '20',
  addonIds: [] as number[],
  addonsTitle: '',
}

/** collectionId: إنشاء من جوه قسم — المنتج بيتضاف آخر القسم بعد الحفظ. */
export function ProductEditor({
  product,
  collectionId,
  widths = [],
  addonOptions = [],
  addonIds = [],
  addonsTitle = '',
  initialSaleUnit = 'meter',
}: {
  product: AdminProductDetail | null
  collectionId?: string
  /** 0015 — عروض الرول الإضافية المحفوظة (غير العرض الأساسي). */
  widths?: AdminWidth[]
  /** 0016 — منتجات القطعة المتاحة كإضافات، والمختار منها للمنتج ده، وعنوان الجزء. */
  addonOptions?: AddonOption[]
  addonIds?: number[]
  addonsTitle?: string
  /** 0016 — «إضافة / منتج بالقطعة» من صفحة منتج جديد. */
  initialSaleUnit?: SaleUnit
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
          extraWidths: widths.map(toWidthDraft),
          saleUnit: product.saleUnit,
          isListed: product.isListed,
          maxQuantity: String(product.maxQuantity),
          addonIds,
          addonsTitle,
        }
      : { ...EMPTY, saleUnit: initialSaleUnit, isListed: initialSaleUnit !== 'piece', addonsTitle },
  )

  const set = (patch: Partial<typeof form>) => {
    editsRef.current += 1
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
  /**
   * النسخة المعتمدة للحفظ (الطابع + المنتج). بتتحدّث من رد الحفظ الناجح، أو من
   * props بطابع جديد (المزامنة تحت) — **مش** في كل render. الـ props بتفضل قديمة
   * بعد الحفظ لحد أي refresh، والرجوع ليها كان بيخلّي تاني حفظ يطلع CONFLICT وهمي.
   */
  const stampRef = useRef(product?.updatedAt ?? '')
  const productRef = useRef(product)
  /** آخر طابع شفناه في الـ props — عشان المزامنة تشتغل بس لما الـ props تتغيّر فعلًا. */
  const seenStampRef = useRef(product?.updatedAt ?? '')
  /** عدّاد التعديلات: آخر قيمة اتحفظت، والقيمة وقت بداية الحفظ الجاري. */
  const editsRef = useRef(0)
  const savedEditsRef = useRef(0)
  const pendingEditsRef = useRef(0)
  /** تحذيرات آخر حفظ — بتتنقل لصفحة المنتج بعد الإنشاء. */
  const lastWarningRef = useRef<string | null>(null)
  const [carriedWarning, setCarriedWarning] = useState<string | null>(null)

  /**
   * مزامنة من السيرفر لما الـ props تيجي بطابع مختلف (مثلًا router.refresh بعد
   * عملية صورة):
   *   - الطابع = آخر حفظ لينا        -> الـ props لحقتنا، الفورم مايتلمسش
   *   - فيه تعديلات مش محفوظة         -> الفورم والطابع زي ما هم؛ لو حد تاني
   *                                       عدّل فعلًا، الحفظ يطلع CONFLICT حقيقي
   *   - مفيش تعديلات                  -> ناخد نسخة السيرفر
   */
  useEffect(() => {
    const latest = product?.updatedAt ?? ''
    if (sameStamp(latest, seenStampRef.current)) return
    seenStampRef.current = latest
    if (!product) return
    if (sameStamp(latest, stampRef.current)) {
      productRef.current = product
      return
    }
    if (editsRef.current !== savedEditsRef.current) return
    productRef.current = product
    stampRef.current = latest
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
      extraWidths: widths.map(toWidthDraft),
      saleUnit: product.saleUnit,
      isListed: product.isListed,
      maxQuantity: String(product.maxQuantity),
      addonIds,
      addonsTitle,
    })
  }, [product, widths, addonIds, addonsTitle])

  // تحذيرات الإنشاء اللي اتنقلت مع الانتقال لصفحة المنتج — بتتقرا مرة وتتمسح
  const productId = product?.id
  useEffect(() => {
    if (productId === undefined) return
    const key = WARNING_KEY + String(productId)
    try {
      const stored = window.sessionStorage.getItem(key)
      if (stored === null) return
      window.sessionStorage.removeItem(key)
      setCarriedWarning(stored)
    } catch {
      // sessionStorage مقفول — التحذير بيضيع بس الحفظ نفسه تمام
    }
  }, [productId])

  /**
   * «تجاهل وحدّث»: التعديلات المحلية بتتساب صراحة، والمزامنة بتتجبر تاخد
   * نسخة السيرفر حتى لو الطابع ده اتشاف قبل كده (مثلًا بعد CONFLICT حقيقي).
   */
  function discardAndRefresh() {
    savedEditsRef.current = editsRef.current
    seenStampRef.current = ''
    router.refresh()
  }

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
      // مالوش خانة في الفورم — بيتبعت زي ما هو، وإلا التحقق بيحوّله null
      brand: current?.brand ?? '',
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
      saleUnit: draft.saleUnit,
      isListed: draft.isListed,
      maxQuantity: Number(draft.maxQuantity),
      sortOrder: current?.sortOrder ?? 0,
      isActive: current?.isActive ?? false,
    }
    if (!current) return base
    return { ...base, id: current.id, expectedUpdatedAt: stampRef.current }
  }

  const [showPricingErrors, setShowPricingErrors] = useState(false)

  /**
   * حفظ واحد: المنتج (العرض الأساسي وسعره) الأول، وبعده العروض الإضافية
   * (zell_set_product_widths). فشل العروض مابيلغيش حفظ المنتج — بيرجع تحذير.
   */
  const titleRef = useRef(addonsTitle)

  function save() {
    const draftNow = formRef.current
    const problem = draftNow.saleUnit === 'piece' ? pieceProblem(draftNow) : pricingProblem(draftNow)
    if (problem !== null) {
      setShowPricingErrors(true)
      setTab('pricing')
      return
    }
    setShowPricingErrors(false)
    /**
     * حفظ واحد بالترتيب: المنتج ← عروض الرول ← الإضافات ← عنوان الإضافات.
     * القطعة: مفيش عروض ولا إضافات (بتتفضّى). فشل أي خطوة بعد المنتج = تحذير.
     */
    setCarriedWarning(null)
    const thunk = async () => {
      const draft = formRef.current
      const meter = draft.saleUnit !== 'piece'
      pendingEditsRef.current = editsRef.current
      lastWarningRef.current = null
      const result = await saveProductAction(buildInput(), productRef.current ? undefined : collectionId)
      if (!result.ok) return result
      const problems: string[] = []
      // كل التحذيرات بتتجمع (من غير تكرار) بدل ما الأخير يكتب فوق اللي قبله
      const notes: string[] = []
      const note = (text: string | undefined) => {
        if (text !== undefined && text !== '' && !notes.includes(text)) notes.push(text)
      }
      note(result.warning)
      const widthsSaved = await saveProductWidthsAction(result.data.id, meter ? extraWidthsPayload(draft) : [])
      if (widthsSaved.ok) note(widthsSaved.warning)
      else problems.push('عروض الرول (' + widthsSaved.message + ')')
      const addonsSaved = await saveProductAddonsAction(result.data.id, meter ? draft.addonIds : [])
      if (addonsSaved.ok) note(addonsSaved.warning)
      else problems.push('الإضافات (' + addonsSaved.message + ')')
      const title = draft.addonsTitle.trim()
      if (meter && title !== '' && title !== titleRef.current) {
        const titleSaved = await saveAddonsTitleAction(title)
        if (titleSaved.ok) {
          titleRef.current = titleSaved.data
          note(titleSaved.warning)
        } else problems.push('عنوان الإضافات (' + titleSaved.message + ')')
      }
      const all = problems.length > 0 ? ['المنتج اتحفظ، بس ' + problems.join(' و') + ' ما اتحفظش.', ...notes] : notes
      if (all.length === 0) return result
      const warning = all.join(' · ')
      lastWarningRef.current = warning
      return { ...result, warning }
    }
    void run(thunk, {
      onSuccess: (saved) => {
        savedEditsRef.current = pendingEditsRef.current
        // إنشاء: replace مش push عشان زرار Back مايرجعش لفورم إنشاء قديم.
        // التحذيرات بتتنقل لصفحة المنتج عشان ماتضيعش مع الانتقال.
        if (!productRef.current) {
          const carried = lastWarningRef.current
          if (carried !== null) {
            try {
              window.sessionStorage.setItem(WARNING_KEY + String(saved.id), carried)
            } catch {
              // sessionStorage مقفول — مفيش بديل آمن، التحذير بيضيع
            }
          }
          router.replace('/products/' + String(saved.id))
          return
        }
        productRef.current = { ...productRef.current, ...saved }
        stampRef.current = saved.updatedAt
        seenStampRef.current = saved.updatedAt
      },
    })
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
        <div className="space-y-4">
          <SaleUnitSwitch value={form.saleUnit} onChange={(next) => set({ saleUnit: next })} />
          {form.saleUnit === 'piece' ? (
            <PiecePricing form={form} set={set} showErrors={showPricingErrors} />
          ) : (
            <>
              <PricingFields form={form} set={set} showErrors={showPricingErrors} />
              <AddonsSelector
                options={addonOptions.filter((option) => option.id !== product?.id)}
                value={form.addonIds}
                onChange={(next) => set({ addonIds: next })}
                title={form.addonsTitle}
                onTitleChange={(next) => set({ addonsTitle: next })}
              />
            </>
          )}
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
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={discardAndRefresh} />
      </div>

      <SaveBar state={saveState} onSave={save} warning={warning ?? carriedWarning} />
    </div>
  )
}
