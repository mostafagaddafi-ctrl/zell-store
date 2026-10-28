'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, ShoppingBag } from 'lucide-react'
import {
  formatLength,
  installationReadyGovernorates,
  maxQuantityOf,
  validateLength,
  widthOptionsOf,
  withWidth,
  type InstallationConfig,
  type ProductSizeEntry,
  type ProductSizeTexts,
  type StoreProduct,
} from '@zell/core'
import { useCart } from '../../lib/cart'
import { BUY_NOW_PENDING_TEXT } from '../../lib/buy/buyNow'
import { BuyNowSlowNotice } from './BuyNowSlowNotice'
import { useBuyNow } from './useBuyNow'
import { buttonClasses, Button } from '../ui/Button'
import { Num } from './Num'
import { GiftNote } from './GiftNote'
import { SizePanel } from './SizePanel'
import { AddonsPicker } from './AddonsPicker'
import { currentInstallModeLine, revealToolsOnChange, showToolSuggestions } from '../../lib/install/installChoice'
import { InstallChoice } from './InstallChoice'
import type { SizeDecision } from '../../lib/size/sizeEntry'

/** gift: «نص العرض» لو ظاهر — بيظهر كهدية فوق زرار الإضافة. */
export function ProductBuy({
  product,
  gift = '',
  addons = [],
  addonsTitle = '',
  installation = null,
  sizeEntry = 'cm',
  sizeTexts,
}: {
  product: StoreProduct
  gift?: string
  /** 0016 — منتجات قطعة بتتضاف مع الفيلم (بعددها). */
  addons?: StoreProduct[]
  addonsTitle?: string
  /** PR4 — إعداد الفني (0018). null = من غير «هتركّبه إزاي؟». */
  installation?: InstallationConfig | null
  /** LENGTH-INPUT — الطريقة الأولى لإدخال المقاس من «المحتوى» (الغايب = سنتيمتر). */
  sizeEntry?: ProductSizeEntry
  /** SIZE-TEXTS — نصوص «حدد المقاس» من «المحتوى» (الغايب = النصوص الافتراضية). */
  sizeTexts?: ProductSizeTexts
}) {
  const cart = useCart()
  // BUY-NOW — «اطلب دلوقتي»: إضافة مرة واحدة + علامة تحميل فورية + منع الضغط المتكرر (lib/buy/buyNow.ts)
  const buyNow = useBuyNow()
  const busy = buyNow.busy
  // PR4 — «هتركّبه إزاي؟»: النية على مستوى السلة (cart.installMode)، وCheckout الحكم النهائي
  const installerGovernorates = installation ? installationReadyGovernorates(installation) : []
  const fee = installation?.feePerMeterPiastres ?? null
  const showChoice = installerGovernorates.length > 0 && fee !== null
  const installer = showChoice && cart.installMode === 'installer'
  // قبل قراءة الاختيار المحفوظ (cart.ready) مانعرضش «بنفسي» الافتراضي — كان بيظهر الأدوات لحظة ويخفيها
  const choicePending = showChoice && !cart.ready
  // «هتركّبه إزاي؟» لازم يبقى اختيار صريح: قبل ما العميل يختار (unset) الإضافة والطلب مقفولين
  // والسبب ظاهر جنب الأزرار. فيلم من غير الكارت أو منتج بالقطعة مابيتأثروش.
  const choiceRequired = showChoice && cart.ready && cart.installMode === 'unset'
  const choiceHintId = useId()
  // سطر الاختيار الحالي (null لو لسه مااختارش)
  const currentLine = currentInstallModeLine(cart.installMode)
  const [revealTools, setRevealTools] = useState(false)
  const toolsRef = useRef<HTMLParagraphElement>(null)
  // «هركّبه بنفسي» بعد «فني»: الأدوات بتظهر والتركيز يروح لها (سلس، وفوري مع reduced motion).
  // مفيش أدوات = مفيش عنصر = مفيش scroll.
  useEffect(() => {
    if (!revealTools) return
    setRevealTools(false)
    const node = toolsRef.current
    if (!node) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    node.focus({ preventScroll: true })
  }, [revealTools])
  const [lengthCm, setLengthCm] = useState(product.min_length_cm)
  const [justAdded, setJustAdded] = useState(false)
  const [blocked, setBlocked] = useState(false)
  // LENGTH-INPUT — قرار الطلب من لقطة المقاس الحالية وقت الضغط (SizePanel بيحدّث الدالة بعد كل commit، قبل أي ضغطة):
  // السنتيمتر الفاضي أو الغلط أو تحت الحد = إظهار الخطأ من غير إضافة (ومن أول render)، والطول المضاف من نفس اللقطة.
  const decisionRef = useRef<(() => SizeDecision) | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** آخر سطر اتضاف (الطول والعرض) — «اطلب دلوقتي» مايضيفوش تاني لو هو هو. */
  const lastAddedRef = useRef<string | null>(null)
  const [addedLengthCm, setAddedLengthCm] = useState(product.min_length_cm)
  const [addonQty, setAddonQty] = useState<Record<number, number>>({})
  // عدد الأدوات اللي اتضافت فعلًا في آخر «ضيف للسلة» — للرسالة بس، بيتسجّل لحظة الإضافة (قبل ما addonQty يتصفّر)
  const [addedToolsCount, setAddedToolsCount] = useState(0)
  // 0015 — العرض المختار. المنتج بعرض واحد = مفيش اختيار ومفيش تغيير.
  const options = widthOptionsOf(product)
  const [widthCm, setWidthCm] = useState(product.width_cm)
  const effective = withWidth(product, widthCm) ?? product
  const chosenWidth = effective.width_cm === product.width_cm ? undefined : effective.width_cm

  // قفل الزرار (الفني · المقاس أكبر من المتاح · طول متر غير صالح). القرار الأخير وقت الضغط من decide() تحت.
  const canAdd = !blocked && !choiceRequired && validateLength(lengthCm, effective).ok

  /** القرار وقت الضغط: الفني المطلوب = ولا حاجة، وغير كده من لقطة المقاس الحالية (sizeDecision). */
  const decide = (): SizeDecision => {
    if (choiceRequired) return { kind: 'disabled' }
    const snapshot = decisionRef.current
    return snapshot === null ? { kind: 'disabled' } : snapshot()
  }
  const lineKey = (length: number) => String(length) + '|' + String(effective.width_cm)

  const handleAdd = () => {
    const decision = decide()
    if (decision.kind === 'reveal') setAttempt((value) => value + 1)
    if (decision.kind !== 'add') return
    cart.add(product.id, decision.lengthCm, chosenWidth)
    lastAddedRef.current = lineKey(decision.lengthCm)
    setAddedLengthCm(decision.lengthCm)
    setAddedToolsCount(addSelectedAddons())
    setJustAdded(true)
  }

  /**
   * الإضافات المختارة بتتضاف كسطور قطعة، والاختيار بيتصفّر عشان ماتتكررش.
   * بترجّع عدد الأدوات اللي اتضافت فعلًا في العملية دي (للرسالة بس).
   */
  function addSelectedAddons(): number {
    let added = 0
    for (const addon of addons) {
      const quantity = addonQty[addon.id] ?? 0
      if (quantity > 0) {
        cart.addPiece(addon.id, quantity, maxQuantityOf(addon))
        added += 1
      }
    }
    setAddonQty({})
    return added
  }

  // «اطلب دلوقتي»: يضيف ويروح للبيانات على طول. لو نفس الاختيار اتضاف لسه (justAdded) مابيضيفوش تاني — يروح بس.
  // BUY-NOW: السطر مرة واحدة بس مهما اتضغط، وأثناء الانتظار كل الاختيارات مقفولة، وبعد 15 ثانية تنبيه مش فشل.
  const handleBuyNow = () => {
    const decision = decide()
    if (decision.kind === 'reveal') setAttempt((value) => value + 1)
    if (decision.kind !== 'add') return
    const key = lineKey(decision.lengthCm)
    buyNow.go(
      key,
      justAdded && lastAddedRef.current === key,
      () => {
        cart.add(product.id, decision.lengthCm, chosenWidth)
        lastAddedRef.current = key
      },
      // الإضافات المختارة دلوقتي بتتضاف دايمًا (بتتصفّر بعد الإضافة، فمابتتكررش) — اللي ظاهر مختار = اللي بيتضاف
      () => {
        addSelectedAddons()
      },
    )
  }

  return (
    <div className="space-y-4">
      {/* BUY-NOW: وقت «اطلب دلوقتي» كل الاختيارات والأزرار مقفولة لحد ما الانتقال يتحسم — اللي ظاهر = اللي اتضاف */}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      {/* العرض جوه كارت المقاس نفسه — وتغييره بيعيد الحساب على نفس مقاس الشباك */}
      <SizePanel
        product={product}
        widthCm={effective.width_cm}
        onWidthChange={(next) => {
          setWidthCm(next)
          setJustAdded(false)
        }}
        lengthCm={lengthCm}
        onLengthChange={(next) => {
          setLengthCm(next)
          setJustAdded(false)
        }}
        onBlockedChange={(next) => {
          setBlocked(next)
          if (next) setJustAdded(false)
        }}
        sizeEntry={sizeEntry}
        sizeTexts={sizeTexts}
        decisionRef={decisionRef}
        attempt={attempt}
      />

      <GiftNote text={gift} />

      {showChoice && fee !== null && choicePending ? (
        // مكان ثابت لحد ما الاختيار المحفوظ يتقري — من غير وميض ولا قفزة في الصفحة
        <div aria-hidden="true" className="h-36 rounded-lg border border-border bg-card" />
      ) : null}
      {showChoice && fee !== null && !choicePending ? (
        <div className="space-y-2">
          <InstallChoice
            mode={cart.installMode}
            onChange={(next) => {
              // «هركّبه بنفسي» بعد اختيار تاني + فيه أدوات = الأدوات بتظهر والتركيز يروح لها (نفس الشرط بالحرف، lib/install)
              if (revealToolsOnChange(cart.installMode, next, addons.length)) setRevealTools(true)
              cart.setInstallMode(next)
              // أدوات مختارة ولسه مااتضافتش بتتصفّر — مابتتضافش من غير ما العميل يشوفها
              if (next === 'installer') setAddonQty({})
            }}
            feePerMeterPiastres={fee}
            lengthCm={lengthCm}
            governorates={installerGovernorates}
            context="product"
          />
          {/* الاختيار واحد للطلب كله (cart.installMode): لو متحدد، سطر واضح بالقيمة الحالية وإنها للطلب كله وبتتغيّر من هنا */}
          {currentLine !== null ? <p className="text-sm text-fg">{currentLine}</p> : null}
        </div>
      ) : null}

      {/* مع الفني اقتراحات الأدوات بتختفي — مش محتاجها. وقبل الاختيار مابتظهرش عشان «بنفسي» مايبانش افتراضي */}
      {!showToolSuggestions({ installer, choicePending, choiceRequired, addonCount: addons.length }) ? null : (
        <div className="space-y-2">
          {showChoice ? (
            <p ref={toolsRef} tabIndex={-1} className="scroll-mt-24 text-sm font-semibold text-fg outline-none">
              اختار أدوات التركيب اللي محتاجها
            </p>
          ) : null}
          <AddonsPicker
            addons={addons}
            title={addonsTitle}
            quantities={addonQty}
            onChange={setAddonQty}
            defaultOpen={revealTools}
          />
        </div>
      )}

      {/* «ضيف للسلة» الأساسي وفوق (المسار الأوضح مع الأدوات والفني)، و«اطلب دلوقتي» تحته ثانوي — السلوك زي ما هو */}
      <div className="grid gap-2">
        <Button
          size="lg"
          onClick={handleAdd}
          disabled={!canAdd || busy}
          {...(choiceRequired ? { 'aria-describedby': choiceHintId } : {})}
        >
          <ShoppingBag className="h-5 w-5" />
          ضيف للسلة
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={handleBuyNow}
          disabled={!canAdd || busy}
          aria-busy={busy}
          className={busy ? 'disabled:cursor-wait disabled:opacity-100' : undefined}
          {...(choiceRequired ? { 'aria-describedby': choiceHintId } : {})}
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {BUY_NOW_PENDING_TEXT}
            </>
          ) : (
            <>
              اطلب دلوقتي
              <ArrowLeft className="h-5 w-5" />
            </>
          )}
        </Button>
        {choiceRequired ? (
          <p id={choiceHintId} className="text-center text-xs font-semibold text-fg">
            اختار «هتركّبه إزاي؟» فوق الأول — بنفسي ولا مع فني — عشان تضيف أو تطلب.
          </p>
        ) : null}
      </div>
      </fieldset>

      {/* BUY-NOW: بعد 15 ثانية تنبيه (مش فشل) + تحميل كامل لصفحة البيانات — برّه الـ fieldset علشان يفضل شغّال */}
      <BuyNowSlowNotice phase={buyNow.phase} onRetry={buyNow.retry} />

      {justAdded ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" />
            اتضاف للسلة — <Num>{formatLength(addedLengthCm)}</Num>
            {options.length > 1 ? (
              <>
                {' · عرض '}
                <Num>{String(effective.width_cm)}</Num>
                {' سم'}
              </>
            ) : null}
          </p>
          {/* تأكيد بس لو أدوات اتضافت فعلًا في الضغطة دي — ومع الفني مفيش أي كلام عن الأدوات */}
          {!installer && addedToolsCount > 0 ? (
            <p className="text-xs font-semibold text-fg">اتضافت أدوات التركيب المختارة مع المنتج.</p>
          ) : null}
          {/* من غير دعوة تانية لصفحة الأدوات: الاختيار اتعمل فوق، والأدوات متاحة من السلة */}
          <Link href="/cart" className={buttonClasses('primary', 'md', 'w-full')}>
            روح للسلة
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/checkout" className={buttonClasses('secondary', 'md', 'w-full')}>
              إتمام الطلب
            </Link>
            <Link href="/" className={buttonClasses('secondary', 'md', 'w-full')}>
              كمّل تسوّق
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
