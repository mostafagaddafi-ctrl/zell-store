/**
 * LENGTH-INPUT — حالات طريقة إدخال المقاس وتنبيه الحد الأدنى (منطق خالص — pnpm --filter @zell/storefront cases، suite size).
 * الحساب نفسه من @zell/core بالحرف؛ الحالات بتتأكد من التصنيف والمنع والرسايل والمسودة والطريقة الأولى، ومن قرار الطلب
 * من لقطة المدخلات الحالية (sizeDecision) — ده نفس اللي زرارا «ضيف للسلة» و«اطلب دلوقتي» بيستعملوه وقت الضغط.
 */

import type { StoreProduct } from '@zell/core'
import {
  cmEntryState,
  cmErrorVisible,
  entryBlocksOrder,
  entryDisablesOrder,
  isUntouchedSize,
  meterLengthOf,
  minLengthMessage,
  modeOfEntry,
  parseSizeDraftRecord,
  readProductSizeEntry,
  restoreSizeDraft,
  sizeDecision,
  sizeDraftOf,
  switchToMetersParts,
  type SizeMode,
} from './sizeEntry'

export type SizeCaseFailure = { name: string; expected: string; actual: string }

const failures: SizeCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

function product(patch: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 7,
    name_ar: 'فيلم تجربة',
    name_en: null,
    brand: null,
    description_ar: null,
    width_cm: 120,
    lock_width: false,
    price_per_meter_piastres: 15000,
    compare_at_piastres: null,
    min_length_cm: 300,
    step_cm: 50,
    max_length_cm: 3000,
    ...patch,
  } as unknown as StoreProduct
}

const P = product()
const LOCKED = product({ lock_width: true })
const P250 = product({ min_length_cm: 250 })
const KEY = 'rules-v1'

function kind(width: string, height: string, rules: StoreProduct = P): string {
  return cmEntryState(width, height, rules).kind
}

function decide(mode: SizeMode, widthText: string, heightText: string, rules: StoreProduct, meterLengthCm: number) {
  return sizeDecision({ mode, widthText, heightText, rules, meterLengthCm })
}

/** حفظ ← تخزين (JSON) ← قراية ← رجوع، زي sessionStorage بالظبط. */
function storeAndRestore(draft: ReturnType<typeof sizeDraftOf> | Record<string, unknown>) {
  const stored = JSON.parse(JSON.stringify({ v: 1, ...draft })) as Record<string, unknown>
  return restoreSizeDraft(parseSizeDraftRecord(stored), KEY, P)
}

export function runSizeCases(): { passed: number; failures: SizeCaseFailure[] } {
  // ── الإعداد والطريقة الأولى ──
  check('Z01 setting: only "m" = meters; missing · empty · "M" · number · object = cm', [
    readProductSizeEntry('m'),
    readProductSizeEntry('cm'),
    readProductSizeEntry(undefined),
    readProductSizeEntry(''),
    readProductSizeEntry('M'),
    readProductSizeEntry(1),
    readProductSizeEntry({ value: 'm' }),
  ], ['m', 'cm', 'cm', 'cm', 'cm', 'cm', 'cm'])
  check('Z02 first method from the setting; first render: empty cm reveals, meters at the minimum adds', [
    modeOfEntry('cm'),
    modeOfEntry('m'),
    decide(modeOfEntry('cm'), '', '', P, P.min_length_cm),
    decide(modeOfEntry('cm'), String(LOCKED.width_cm), '', LOCKED, LOCKED.min_length_cm),
    decide(modeOfEntry('m'), '', '', P, P.min_length_cm),
  ], ['window', 'length', { kind: 'reveal' }, { kind: 'reveal' }, { kind: 'add', lengthCm: 300 }])

  // ── الحد الأدنى (المقارنة بالطول المحسوب قبل التقريب) ──
  check('Z10 locked width = one strip: the typed height is the length; below the minimum is blocked', [
    cmEntryState(String(LOCKED.width_cm), '150', LOCKED),
    kind(String(LOCKED.width_cm), '299', LOCKED),
    kind(String(LOCKED.width_cm), '300', LOCKED),
  ], [
    { kind: 'below_min', message: 'أقل طول للطلب 300 سم (3 متر).', strips: 1, neededCm: 150 },
    'below_min',
    'ok',
  ])
  check('Z11 equal to the minimum is allowed (length = minimum, as today)', cmEntryState('100', '300', P), { kind: 'ok', lengthCm: 300, strips: 1, neededCm: 300 })
  check('Z12 more strips: compare strips × height, not each dimension alone', [
    cmEntryState('200', '150', P),
    kind('250', '90', P),
    kind('100', '290', P),
  ], [{ kind: 'ok', lengthCm: 300, strips: 2, neededCm: 300 }, 'below_min', 'below_min'])
  check('Z13 above the minimum: rounding up to the step exactly as today', [
    cmEntryState('100', '310', P),
    cmEntryState('130', '200', P),
  ], [
    { kind: 'ok', lengthCm: 350, strips: 1, neededCm: 310 },
    { kind: 'ok', lengthCm: 400, strips: 2, neededCm: 400 },
  ])
  check('Z14 typing 3 → 30 → 300: blocked, blocked, allowed (no rejection while typing)', [
    entryBlocksOrder('window', cmEntryState('100', '3', P)),
    entryBlocksOrder('window', cmEntryState('100', '30', P)),
    entryBlocksOrder('window', cmEntryState('100', '300', P)),
    cmErrorVisible(cmEntryState('100', '30', P), false),
  ], [true, true, false, false])

  // ── الإدخال غير الصالح ──
  check('Z20 empty · zero · negative · not a number · too large: blocked', [
    kind('', ''),
    kind('100', ''),
    kind('', '300'),
    kind('100', '0'),
    kind('100', '-50'),
    kind('abc', '300'),
    kind('100', '6000'),
    kind(String(LOCKED.width_cm), '', LOCKED),
  ], ['empty', 'empty', 'empty', 'invalid', 'invalid', 'invalid', 'invalid', 'empty'])
  check('Z21 core messages are reused for empty/invalid input', [
    (cmEntryState('', '', P) as { message: string }).message,
    (cmEntryState('100', '6000', P) as { message: string }).message,
  ], ['اكتب عرض وارتفاع الشباك بالسنتيمتر', 'المقاس ده كبير جداً — راجع الأرقام'])
  check('Z22 exceeds the maximum: disables (as today) and is not an entry block', [
    kind('100', '3100'),
    entryDisablesOrder('window', cmEntryState('100', '3100', P)),
    entryBlocksOrder('window', cmEntryState('100', '3100', P)),
  ], ['exceeds_max', true, false])
  check('Z23 meter method never blocks or disables through the cm fields', [
    entryBlocksOrder('length', cmEntryState('', '', P)),
    entryDisablesOrder('length', cmEntryState('100', '3100', P)),
  ], [false, false])
  check('Z30 error visible only after blur or an order attempt; gone once valid', [
    cmErrorVisible(cmEntryState('100', '150', P), false),
    cmErrorVisible(cmEntryState('100', '150', P), true),
    cmErrorVisible(cmEntryState('100', '300', P), true),
    cmErrorVisible(cmEntryState('100', '3100', P), true),
  ], [false, true, false, false])

  // ── قرار الطلب من لقطة المدخلات الحالية وقت الضغط (B1) ──
  check('Z31 valid → empty: the click uses the current (empty) fields, never the previous length', [
    decide('window', '100', '310', P, 300),
    decide('window', '100', '', P, 300),
    decide('window', '', '310', P, 300),
  ], [{ kind: 'add', lengthCm: 350 }, { kind: 'reveal' }, { kind: 'reveal' }])
  check('Z32 valid → below the minimum: reveal, no add', [
    decide('window', '100', '400', P, 300),
    decide('window', '100', '150', P, 300),
  ], [{ kind: 'add', lengthCm: 400 }, { kind: 'reveal' }])
  check('Z33 roll width change re-checks the same fields with the new rules in the same snapshot (120 → 152)', [
    decide('window', '150', '150', P, 300),
    decide('window', '150', '150', product({ width_cm: 152 }), 300),
    decide('window', '200', '200', product({ width_cm: 152 }), 300),
  ], [{ kind: 'add', lengthCm: 300 }, { kind: 'reveal' }, { kind: 'add', lengthCm: 400 }])
  check('Z34 switching methods then clicking at once: cm invalid never uses the meter length; meters use their own length; back to cm uses the fields', [
    decide('window', '100', '150', P, 500),
    decide('length', '100', '150', P, 500),
    decide('window', '100', '310', P, 500),
  ], [{ kind: 'reveal' }, { kind: 'add', lengthCm: 500 }, { kind: 'add', lengthCm: 350 }])
  check('Z35 locked buttons stay locked: exceeds max · invalid meter length · unusable rules = disabled (no reveal, no add)', [
    decide('window', '100', '3100', P, 300),
    decide('length', '', '', P, 275),
    decide('window', '100', '300', product({ step_cm: 0 }), 300),
  ], [{ kind: 'disabled' }, { kind: 'disabled' }, { kind: 'disabled' }])

  // ── الرسايل ──
  check('Z40 messages from the product minimum (300 · 250)', [
    minLengthMessage(300),
    minLengthMessage(250),
    switchToMetersParts(300),
    Object.values(switchToMetersParts(250)).join(''),
  ], [
    'أقل طول للطلب 300 سم (3 متر).',
    'أقل طول للطلب 250 سم (2.5 متر).',
    { before: 'لو محتاج كمية أصغر، أقل طول متاح للطلب هو 3 متر. تقدر تختاره من ', link: '«الطول بالمتر»', after: '.' },
    'لو محتاج كمية أصغر، أقل طول متاح للطلب هو 2.5 متر. تقدر تختاره من «الطول بالمتر».',
  ])
  check('Z41 below-minimum message follows the product (250)', (cmEntryState('100', '200', P250) as { message: string }).message, 'أقل طول للطلب 250 سم (2.5 متر).')

  // ── طريقة المتر بعد التحويل ──
  check('Z50 meters after the switch: last valid meter choice, otherwise the minimum', [
    meterLengthOf(null, P),
    meterLengthOf(450, P),
    meterLengthOf(275, P),
    meterLengthOf(250, P),
  ], [300, 450, 300, 300])

  // ── المسودة (B2: اختيار المتر محفوظ لوحده) ──
  const meter500ThenCm400 = sizeDraftOf({ rulesKey: KEY, widthCm: 120, mode: 'window', width: '100', height: '400', lengthCm: 400, meterCm: 500 })
  const restoredA = storeAndRestore(meter500ThenCm400)
  check('Z60 round trip: meters 500 → cm 400 → save/restore → cm fields kept and meters back to 500', [
    restoredA,
    restoredA === null ? null : decide(restoredA.mode, restoredA.windowWidth, restoredA.windowHeight, P, 400),
    restoredA === null ? null : meterLengthOf(restoredA.meterLengthCm, P),
  ], [
    { widthCm: 120, mode: 'window', windowWidth: '100', windowHeight: '400', meterLengthCm: 500 },
    { kind: 'add', lengthCm: 400 },
    500,
  ])
  const cmOnly = storeAndRestore(sizeDraftOf({ rulesKey: KEY, widthCm: 120, mode: 'window', width: '100', height: '400', lengthCm: 400, meterCm: null }))
  check('Z61 cm only, then the first switch to meters = the minimum (the cm length is never a meter choice)', [cmOnly?.meterLengthCm ?? null, meterLengthOf(cmOnly?.meterLengthCm ?? null, P)], [null, 300])
  const cmBelow = storeAndRestore(sizeDraftOf({ rulesKey: KEY, widthCm: 120, mode: 'window', width: '100', height: '150', lengthCm: 300, meterCm: null }))
  check('Z62 cm draft below the minimum restores its values and stays blocked', [
    cmBelow,
    cmBelow === null ? null : decide(cmBelow.mode, cmBelow.windowWidth, cmBelow.windowHeight, P, 300),
  ], [{ widthCm: 120, mode: 'window', windowWidth: '100', windowHeight: '150', meterLengthCm: null }, { kind: 'reveal' }])
  check('Z63 meter draft: valid choice kept · invalid choice = minimum', [
    storeAndRestore(sizeDraftOf({ rulesKey: KEY, widthCm: 120, mode: 'length', width: '', height: '', lengthCm: 500, meterCm: 500 }))?.meterLengthCm,
    meterLengthOf(storeAndRestore(sizeDraftOf({ rulesKey: KEY, widthCm: 120, mode: 'length', width: '', height: '', lengthCm: 520, meterCm: 520 }))?.meterLengthCm ?? null, P),
  ], [500, 300])
  check('Z64 old drafts (no meterCm): meters = lengthCm · cm = no meter choice', [
    storeAndRestore({ rules: KEY, widthCm: 120, mode: 'length', windowWidth: '', windowHeight: '', lengthCm: 450 })?.meterLengthCm,
    storeAndRestore({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '100', windowHeight: '400', lengthCm: 400 })?.meterLengthCm,
  ], [450, null])
  check('Z65 bad meterCm in storage = the whole draft is ignored', [
    parseSizeDraftRecord({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '', windowHeight: '', lengthCm: 300, meterCm: 'x' }),
    parseSizeDraftRecord({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '', windowHeight: '', lengthCm: 300, meterCm: 0 }),
    parseSizeDraftRecord({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '12a', windowHeight: '', lengthCm: 300, meterCm: null }),
  ], [null, null, null])
  check('Z66 other rules fingerprint or an unavailable width = ignored (the setting decides)', [
    restoreSizeDraft({ rules: 'old', widthCm: 120, mode: 'length', windowWidth: '', windowHeight: '', lengthCm: 500, meterCm: 500 }, KEY, P),
    restoreSizeDraft({ rules: KEY, widthCm: 999, mode: 'window', windowWidth: '1', windowHeight: '1', lengthCm: 300, meterCm: null }, KEY, P),
    restoreSizeDraft(null, KEY, P),
  ], [null, null, null])
  check('Z67 untouched detection honours the first method and the meter choice', [
    isUntouchedSize({ mode: 'window', initialMode: 'window', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300, meterCm: null }),
    isUntouchedSize({ mode: 'length', initialMode: 'length', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300, meterCm: null }),
    isUntouchedSize({ mode: 'length', initialMode: 'window', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300, meterCm: null }),
    isUntouchedSize({ mode: 'window', initialMode: 'window', width: '', height: '150', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300, meterCm: null }),
    isUntouchedSize({ mode: 'window', initialMode: 'window', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300, meterCm: 500 }),
  ], [true, true, false, false, false])
  return { passed, failures }
}
