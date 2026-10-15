import {
  areRulesUsable,
  formatLength,
  requiredLength,
  validateLength,
  withWidth,
  type ProductSizeEntry,
  type StoreProduct,
} from '@zell/core'

/**
 * LENGTH-INPUT — طريقة إدخال المقاس وتنبيه الحد الأدنى في صفحة المنتج (docs/contracts/LENGTH-INPUT.md). منطق خالص
 * (من غير server-only ولا أي استيراد قيمة برّه المجلد غير @zell/core)، فحالات suite size بتشغّله فعليًا.
 *
 *   • الحساب من @zell/core زي ما هو بالحرف (requiredLength). الملف ده بيصنّف النتيجة بس: المقارنة بالحد الأدنى على
 *     neededCm (الشرايح × الارتفاع) قبل التقريب والرفع للحد الأدنى، والمساوي للحد مسموح.
 *   • طريقة السنتيمتر الفاضية أو الغلط أو تحت الحد = الطلب ممنوع، من غير ما الزرار يتقفل (الضغط بيظهر الخطأ)، ومفيش
 *     طول قديم أو افتراضي بيتستعمل. exceeds_max زي النهارده (منع وقفل ورسالة على طول).
 *   • الإعداد (hero.productSizeEntry) بيحدد الطريقة الأولى بس، والمسودة ببصمة القواعد الحالية ليها الأولوية.
 */

export type SizeMode = 'window' | 'length'

/** قراية الإعداد: 'm' بالحرف = متر، وأي حاجة تانية = سنتيمتر (نفس قاعدة اللوحة بالحرف). */
export function readProductSizeEntry(raw: unknown): ProductSizeEntry {
  return raw === 'm' ? 'm' : 'cm'
}

/** الطريقة اللي بتظهر أولًا من الإعداد. */
export function modeOfEntry(entry: ProductSizeEntry): SizeMode {
  return entry === 'm' ? 'length' : 'window'
}

/** من أول ظهور للصفحة: طريقة السنتيمتر خاناتها فاضية = الطلب ممنوع. */
export function orderBlockedAtStart(entry: ProductSizeEntry): boolean {
  return modeOfEntry(entry) === 'window'
}

export type CmEntryState =
  | { kind: 'ok'; lengthCm: number; strips: number; neededCm: number }
  | { kind: 'empty'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'below_min'; message: string; strips: number; neededCm: number }
  | { kind: 'exceeds_max'; message: string }

/** «أقل طول للطلب 300 سم (3 متر).» — من الحد الأدنى للمنتج. */
export function minLengthMessage(minLengthCm: number): string {
  return 'أقل طول للطلب ' + String(minLengthCm) + ' سم (' + formatLength(minLengthCm) + ').'
}

/** سطر التحويل للمتر، و«الطول بالمتر» زرار بيحوّل بضغطة العميل بس. */
export function switchToMetersParts(minLengthCm: number): { before: string; link: string; after: string } {
  return {
    before: 'لو محتاج كمية أصغر، أقل طول متاح للطلب هو ' + formatLength(minLengthCm) + '. تقدر تختاره من ',
    link: '«الطول بالمتر»',
    after: '.',
  }
}

/** حالة خانات السنتيمتر. widthText للعرض المقفول = عرض الرول نفسه. */
export function cmEntryState(widthText: string, heightText: string, rules: StoreProduct): CmEntryState {
  const empty = widthText.trim() === '' || heightText.trim() === ''
  const result = requiredLength(Number(widthText), Number(heightText), rules)
  if (!result.ok) {
    if (result.code === 'exceeds_max') return { kind: 'exceeds_max', message: result.message }
    return { kind: empty ? 'empty' : 'invalid', message: result.message }
  }
  if (empty) return { kind: 'empty', message: 'اكتب عرض وارتفاع الشباك بالسنتيمتر' }
  if (result.neededCm < rules.min_length_cm) {
    return { kind: 'below_min', message: minLengthMessage(rules.min_length_cm), strips: result.strips, neededCm: result.neededCm }
  }
  return { kind: 'ok', lengthCm: result.lengthCm, strips: result.strips, neededCm: result.neededCm }
}

/** الطلب ممنوع من غير قفل الزرار (الضغط بيظهر الخطأ): طريقة السنتيمتر فاضية أو غلط أو تحت الحد. */
export function entryBlocksOrder(mode: SizeMode, state: CmEntryState): boolean {
  return mode === 'window' && (state.kind === 'empty' || state.kind === 'invalid' || state.kind === 'below_min')
}

/** قفل الزرار زي النهارده (exceeds_max). */
export function entryDisablesOrder(mode: SizeMode, state: CmEntryState): boolean {
  return mode === 'window' && state.kind === 'exceeds_max'
}

/** الخطأ بيظهر بعد الخروج من الخانة أو محاولة الطلب بس. */
export function cmErrorVisible(state: CmEntryState, touched: boolean): boolean {
  return touched && (state.kind === 'empty' || state.kind === 'invalid' || state.kind === 'below_min')
}

/** الضغط على «ضيف للسلة» أو «اطلب دلوقتي»: قفل = ولا حاجة · ممنوع = إظهار الخطأ من غير إضافة · غير كده = إضافة. */
export function orderAttempt(canAdd: boolean, orderBlocked: boolean): 'none' | 'reveal' | 'add' {
  if (!canAdd) return 'none'
  return orderBlocked ? 'reveal' : 'add'
}

/** طول طريقة المتر بعد التحويل: آخر طول صالح، وإلا الحد الأدنى. */
export function meterLengthOf(last: number | null, rules: StoreProduct): number {
  return last !== null && validateLength(last, rules).ok ? last : rules.min_length_cm
}

export type SizeDraftLike = {
  rules: string
  widthCm: number
  mode: SizeMode
  windowWidth: string
  windowHeight: string
  lengthCm: number
}

export type SizeDraftRestore = {
  widthCm: number
  mode: SizeMode
  windowWidth: string
  windowHeight: string
  /** طول المتر من المسودة لو صالح بس (وإلا null = الحد الأدنى). مابيتستعملش في طريقة السنتيمتر أبدًا. */
  meterLengthCm: number | null
}

/**
 * رجوع المسودة: لازم بصمة القواعد الحالية. مسودة السنتيمتر بترجع بخاناتها زي ما هي (حتى لو ناقصة أو تحت الحد)،
 * والطول بيتحسب من الخانات. طول المتر بيرجع بس لو صالح. بصمة مختلفة أو عرض مش متاح = null (الإعداد هو اللي بيحدد).
 */
export function restoreSizeDraft(draft: SizeDraftLike | null, rulesKey: string, product: StoreProduct): SizeDraftRestore | null {
  if (draft === null || draft.rules !== rulesKey) return null
  const rules = withWidth(product, draft.widthCm)
  if (!rules || !areRulesUsable(rules)) return null
  return {
    widthCm: rules.width_cm,
    mode: draft.mode,
    windowWidth: draft.windowWidth,
    windowHeight: draft.windowHeight,
    meterLengthCm: validateLength(draft.lengthCm, rules).ok ? draft.lengthCm : null,
  }
}

/** مفيش حاجة اتغيّرت عن البداية = المسودة بتتمسح بدل ما تتحفظ. */
export function isUntouchedSize(input: {
  mode: SizeMode
  initialMode: SizeMode
  width: string
  height: string
  widthCm: number
  productWidthCm: number
  lengthCm: number
  minLengthCm: number
}): boolean {
  return (
    input.mode === input.initialMode &&
    input.width === '' &&
    input.height === '' &&
    input.widthCm === input.productWidthCm &&
    input.lengthCm === input.minLengthCm
  )
}
