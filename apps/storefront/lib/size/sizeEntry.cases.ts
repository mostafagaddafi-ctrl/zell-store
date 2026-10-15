/**
 * LENGTH-INPUT — حالات طريقة إدخال المقاس وتنبيه الحد الأدنى (منطق خالص — pnpm --filter @zell/storefront cases، suite size).
 * الحساب نفسه من @zell/core بالحرف؛ الحالات بتتأكد من التصنيف والمنع والرسايل والمسودة والطريقة الأولى.
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
  orderAttempt,
  orderBlockedAtStart,
  readProductSizeEntry,
  restoreSizeDraft,
  switchToMetersParts,
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

function kind(width: string, height: string, rules: StoreProduct = P): string {
  return cmEntryState(width, height, rules).kind
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
  check('Z02 first method from the setting · order blocked from the first render in the cm method only', [
    modeOfEntry('cm'), modeOfEntry('m'), orderBlockedAtStart('cm'), orderBlockedAtStart('m'),
  ], ['window', 'length', true, false])

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
  check('Z20 empty · zero · negative · not a number · too large: blocked, never a previous length', [
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

  // ── التوقيت ومحاولة الطلب ──
  check('Z30 error visible only after blur or an order attempt; gone once valid', [
    cmErrorVisible(cmEntryState('100', '150', P), false),
    cmErrorVisible(cmEntryState('100', '150', P), true),
    cmErrorVisible(cmEntryState('100', '300', P), true),
    cmErrorVisible(cmEntryState('100', '3100', P), true),
  ], [false, true, false, false])
  check('Z31 order attempt: locked (installer choice · exceeds max) = nothing · blocked = reveal, no add · valid = add', [
    orderAttempt(false, true),
    orderAttempt(false, false),
    orderAttempt(true, true),
    orderAttempt(true, false),
  ], ['none', 'none', 'reveal', 'add'])
  check('Z32 attempt before leaving the field on first render (empty cm) reveals, never adds', orderAttempt(true, orderBlockedAtStart('cm')), 'reveal')

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
  check('Z50 meters after the switch: last valid length, otherwise the minimum', [
    meterLengthOf(null, P),
    meterLengthOf(450, P),
    meterLengthOf(275, P),
    meterLengthOf(250, P),
  ], [300, 450, 300, 300])

  // ── المسودة ──
  const KEY = 'rules-v1'
  check('Z60 cm draft restores its values even when incomplete or below the minimum; meter length only when valid', [
    restoreSizeDraft({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '100', windowHeight: '150', lengthCm: 300 }, KEY, P),
    restoreSizeDraft({ rules: KEY, widthCm: 120, mode: 'window', windowWidth: '', windowHeight: '40', lengthCm: 275 }, KEY, P),
  ], [
    { widthCm: 120, mode: 'window', windowWidth: '100', windowHeight: '150', meterLengthCm: 300 },
    { widthCm: 120, mode: 'window', windowWidth: '', windowHeight: '40', meterLengthCm: null },
  ])
  check('Z61 restored cm draft below the minimum stays blocked (no stored length used in cm)', entryBlocksOrder('window', cmEntryState('100', '150', P)), true)
  check('Z62 meter draft: valid length kept · invalid = minimum', [
    restoreSizeDraft({ rules: KEY, widthCm: 120, mode: 'length', windowWidth: '', windowHeight: '', lengthCm: 500 }, KEY, P)?.meterLengthCm,
    meterLengthOf(restoreSizeDraft({ rules: KEY, widthCm: 120, mode: 'length', windowWidth: '', windowHeight: '', lengthCm: 520 }, KEY, P)?.meterLengthCm ?? null, P),
  ], [500, 300])
  check('Z63 other rules fingerprint or an unavailable width = ignored (the setting decides)', [
    restoreSizeDraft({ rules: 'old', widthCm: 120, mode: 'length', windowWidth: '', windowHeight: '', lengthCm: 500 }, KEY, P),
    restoreSizeDraft({ rules: KEY, widthCm: 999, mode: 'window', windowWidth: '1', windowHeight: '1', lengthCm: 300 }, KEY, P),
    restoreSizeDraft(null, KEY, P),
  ], [null, null, null])
  check('Z64 roll width change re-checks the same fields on the new width (120 → 152)', [
    kind('150', '150', P),
    kind('150', '150', product({ width_cm: 152 })),
  ], ['ok', 'below_min'])
  check('Z65 untouched detection honours the first method from the setting', [
    isUntouchedSize({ mode: 'window', initialMode: 'window', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300 }),
    isUntouchedSize({ mode: 'length', initialMode: 'length', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300 }),
    isUntouchedSize({ mode: 'length', initialMode: 'window', width: '', height: '', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300 }),
    isUntouchedSize({ mode: 'window', initialMode: 'window', width: '', height: '150', widthCm: 120, productWidthCm: 120, lengthCm: 300, minLengthCm: 300 }),
  ], [true, true, false, false])
  return { passed, failures }
}
