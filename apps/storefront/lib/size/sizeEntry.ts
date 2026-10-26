import {
  areRulesUsable,
  formatLength,
  requiredLength,
  validateLength,
  widthOptionsOf,
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
 *   • قرار الطلب (sizeDecision) من **لقطة واحدة حالية** وقت الضغط: الطريقة + الخانات + العرض (القواعد) + طول المتر.
 *     السنتيمتر الصالح = الطول من نفس اللقطة · الفاضي أو الغلط أو تحت الحد = إظهار الخطأ من غير إضافة · exceeds_max = قفل.
 *     مفيش طول قديم أو افتراضي بيتستعمل، ومفيش اعتماد على مزامنة حالة بين المكونات.
 *   • الإعداد (hero.productSizeEntry) بيحدد الطريقة الأولى بس، والمسودة ببصمة القواعد الحالية ليها الأولوية. آخر طول
 *     اختاره العميل بالمتر بيتحفظ لوحده (meterCm)، وطول السنتيمتر عمره ما بيتحوّل لاختيار متر.
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

/** لقطة المقاس الحالية وقت الضغط على «ضيف للسلة» أو «اطلب دلوقتي». */
export type SizeSnapshot = {
  mode: SizeMode
  /** خانة العرض زي ما هي (أو عرض الرول نفسه لو العرض مقفول). */
  widthText: string
  heightText: string
  /** قواعد المنتج بالعرض المختار في نفس اللقطة. */
  rules: StoreProduct
  /** الطول المعروض في طريقة المتر. */
  meterLengthCm: number
}

export type SizeDecision = { kind: 'add'; lengthCm: number } | { kind: 'reveal' } | { kind: 'disabled' }

/**
 * قرار الطلب من لقطة واحدة: السنتيمتر الصالح = الطول المحسوب من نفس اللقطة · الفاضي أو الغلط أو تحت الحد = reveal
 * (مفيش إضافة ولا انتقال) · exceeds_max أو قواعد ناقصة أو طول متر غير صالح = disabled.
 */
export function sizeDecision(snapshot: SizeSnapshot): SizeDecision {
  if (!areRulesUsable(snapshot.rules)) return { kind: 'disabled' }
  if (snapshot.mode === 'length') {
    return validateLength(snapshot.meterLengthCm, snapshot.rules).ok ? { kind: 'add', lengthCm: snapshot.meterLengthCm } : { kind: 'disabled' }
  }
  const state = cmEntryState(snapshot.widthText, snapshot.heightText, snapshot.rules)
  if (state.kind === 'ok') return { kind: 'add', lengthCm: state.lengthCm }
  if (state.kind === 'exceeds_max') return { kind: 'disabled' }
  return { kind: 'reveal' }
}

/** طول طريقة المتر بعد التحويل: آخر اختيار صالح بالمتر، وإلا الحد الأدنى. */
export function meterLengthOf(last: number | null, rules: StoreProduct): number {
  return last !== null && validateLength(last, rules).ok ? last : rules.min_length_cm
}

// ── المسودة ───────────────────────────────────────────────────────────
export type SizeDraft = {
  /** بصمة قواعد المقاس وقت الحفظ — لو اتغيّرت من اللوحة المسودة بتتجاهل. */
  rules: string
  widthCm: number
  mode: SizeMode
  windowWidth: string
  windowHeight: string
  /** الطول المعروض وقت الحفظ (مشترك) — مابيتستعملش كاختيار متر غير في المسودات القديمة لطريقة المتر. */
  lengthCm: number
  /**
   * LENGTH-INPUT — آخر طول اختاره العميل بالمتر، منفصل عن ناتج السنتيمتر. null = ماختارش بالمتر.
   * غايب = مسودة قديمة (قبل LENGTH-INPUT): طريقة المتر = lengthCm، وطريقة السنتيمتر = null.
   */
  meterCm?: number | null
}

/** خانة سم زي ما المتصفح بيدّيها: فاضية، أو رقم موجب صغير بكسر عشري اختياري. */
const CM_TEXT = /^(?:[0-9]{1,4}(?:\.[0-9]{1,2})?)?$/
const MAX_RULES = 300
const MAX_CM = 100000

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_CM ? value : null
}

/** فحص المسودة المخزّنة: أي حقل غلط = المسودة كلها بتتجاهل (من غير تصليح قيم). */
export function parseSizeDraftRecord(record: Record<string, unknown>): SizeDraft | null {
  const rulesRaw = record['rules']
  const rules = typeof rulesRaw === 'string' && rulesRaw.length <= MAX_RULES ? rulesRaw : null
  const widthCm = positiveInt(record['widthCm'])
  const lengthCm = positiveInt(record['lengthCm'])
  const mode = record['mode']
  const windowWidth = record['windowWidth']
  const windowHeight = record['windowHeight']
  if (rules === null || widthCm === null || lengthCm === null) return null
  if (mode !== 'window' && mode !== 'length') return null
  if (typeof windowWidth !== 'string' || !CM_TEXT.test(windowWidth)) return null
  if (typeof windowHeight !== 'string' || !CM_TEXT.test(windowHeight)) return null
  const draft: SizeDraft = { rules, widthCm, mode, windowWidth, windowHeight, lengthCm }
  if ('meterCm' in record) {
    const raw = record['meterCm']
    if (raw === null) draft.meterCm = null
    else {
      const meterCm = positiveInt(raw)
      if (meterCm === null) return null
      draft.meterCm = meterCm
    }
  }
  return draft
}

/**
 * بصمة قواعد المقاس — أي تغيير فيها من اللوحة بيلغي مسودة المقاس القديمة. اتنقلت بالحرف من SizePanel (SIZE-TEXTS)
 * علشان تتختبر في suite size-texts: نصوص «حدد المقاس» مش جزء منها.
 */
export function sizeRulesKeyOf(product: StoreProduct): string {
  return [
    product.width_cm,
    product.min_length_cm,
    product.step_cm,
    product.max_length_cm,
    product.lock_width === true ? 1 : 0,
    widthOptionsOf(product).map((option) => option.width_cm).join(','),
  ].join('|')
}

/** شكل المسودة اللي بتتحفظ (دايمًا فيها meterCm). */
export function sizeDraftOf(input: {
  rulesKey: string
  widthCm: number
  mode: SizeMode
  width: string
  height: string
  lengthCm: number
  meterCm: number | null
}): SizeDraft {
  return {
    rules: input.rulesKey,
    widthCm: input.widthCm,
    mode: input.mode,
    windowWidth: input.width,
    windowHeight: input.height,
    lengthCm: input.lengthCm,
    meterCm: input.meterCm,
  }
}

export type SizeDraftRestore = {
  widthCm: number
  mode: SizeMode
  windowWidth: string
  windowHeight: string
  /** آخر اختيار صالح بالمتر (وإلا null = الحد الأدنى). مابيتستعملش في طريقة السنتيمتر أبدًا. */
  meterLengthCm: number | null
}

/**
 * رجوع المسودة: لازم بصمة القواعد الحالية. مسودة السنتيمتر بترجع بخاناتها زي ما هي (حتى لو ناقصة أو تحت الحد)،
 * والطول بيتحسب من الخانات. اختيار المتر = meterCm (أو lengthCm لمسودة متر قديمة من غير meterCm) لو صالح بس.
 * بصمة مختلفة أو عرض مش متاح = null (الإعداد هو اللي بيحدد).
 */
export function restoreSizeDraft(draft: SizeDraft | null, rulesKey: string, product: StoreProduct): SizeDraftRestore | null {
  if (draft === null || draft.rules !== rulesKey) return null
  const rules = withWidth(product, draft.widthCm)
  if (!rules || !areRulesUsable(rules)) return null
  const meterSource = draft.meterCm !== undefined ? draft.meterCm : draft.mode === 'length' ? draft.lengthCm : null
  return {
    widthCm: rules.width_cm,
    mode: draft.mode,
    windowWidth: draft.windowWidth,
    windowHeight: draft.windowHeight,
    meterLengthCm: meterSource !== null && validateLength(meterSource, rules).ok ? meterSource : null,
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
  meterCm: number | null
}): boolean {
  return (
    input.mode === input.initialMode &&
    input.width === '' &&
    input.height === '' &&
    input.widthCm === input.productWidthCm &&
    input.lengthCm === input.minLengthCm &&
    input.meterCm === null
  )
}
