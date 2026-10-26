/**
 * SIZE-TEXTS — حالات «نصوص حدد المقاس» في اللوحة (منطق خالص — pnpm --filter @zell/admin cases، suite size-texts).
 * النصوص الافتراضية والحدود مكتوبة هنا بالحرف (ونفسها في apps/storefront/lib/size/sizeTexts.cases.ts)، فأي اختلاف
 * بين اللوحة والمتجر بيفشل. التحقق مابيقبلش قص صامت، والقراية ثم التحقق بيرجّعوا نفس القيمة (الحفظ مابيضيّعش النصوص).
 */

import {
  DEFAULT_SIZE_TEXTS,
  SIZE_TEXTS_INVALID,
  SIZE_TEXT_FIELDS,
  SIZE_TEXT_MAX,
  checkProductSizeTexts,
  readProductSizeTexts,
} from './sizeTexts'

export type SizeTextsCaseFailure = { name: string; expected: string; actual: string }

const failures: SizeTextsCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const OLD_TEXTS = {
  title: 'حدد المقاس',
  intro: 'قيس المكان اللي هيتركّب عليه الفيلم — شباك، باب، قزاز، مراية — بالسنتيمتر، وإحنا نحسب كام متر محتاج.',
  rollHint: 'ده عرض الفيلم نفسه (الشريحة الواحدة). لو المكان أعرض منه، بنقسمه شرايح.',
  widthLabel: 'عرض المكان',
  heightLabel: 'ارتفاع المكان',
  heightExample: 'مثال: 500 سم',
  guide: 'اكتب العرض والارتفاع بالسنتيمتر وإحنا نحسب عدد الشرايح والطول.',
  toMeters: 'عارف الطول اللي محتاجه بالمتر؟',
  toCentimeters: 'ارجع للمقاس بالسنتيمتر',
  meterNote: 'مش متأكد؟ ارجع للمقاس واكتبه بالسنتيمتر وإحنا نحسب.',
}

const LONG = (n: number) => 'ن'.repeat(n)

export function runSizeTextsCases(): { passed: number; failures: SizeTextsCaseFailure[] } {
  check('A01 defaults = the storefront texts exactly (10 keys, same order)', [Object.keys(DEFAULT_SIZE_TEXTS), DEFAULT_SIZE_TEXTS], [Object.keys(OLD_TEXTS), OLD_TEXTS])
  check('A02 limits = storefront limits exactly', SIZE_TEXT_MAX, { title: 40, intro: 200, rollHint: 200, widthLabel: 30, heightLabel: 30, heightExample: 30, guide: 200, toMeters: 60, toCentimeters: 60, meterNote: 200 })
  check('A03 fields: 10 in order · default text and limit per key', SIZE_TEXT_FIELDS.map((f) => [f.key, f.max, f.defaultText === DEFAULT_SIZE_TEXTS[f.key]]), Object.keys(OLD_TEXTS).map((k) => [k, (SIZE_TEXT_MAX as Record<string, number>)[k], true]))
  check('A04 check: missing / null = {}', [checkProductSizeTexts(undefined), checkProductSizeTexts(null)], [{ ok: true, value: {} }, { ok: true, value: {} }])
  check(
    'A05 check: trims · empty and whitespace removed (= default in the store) · null key skipped',
    checkProductSizeTexts({ title: '  قيس مكانك  ', intro: '', guide: '   ', meterNote: null }),
    { ok: true, value: { title: 'قيس مكانك' } },
  )
  check(
    'A06 check: exactly the limit accepted · over the limit rejected with the field name (no silent cut)',
    [checkProductSizeTexts({ title: LONG(40) }), checkProductSizeTexts({ title: LONG(41) })],
    [{ ok: true, value: { title: LONG(40) } }, { ok: false, message: 'عنوان القسم أطول من المسموح (40 حرف)' }],
  )
  check(
    'A07 check: not an object · unknown key · non-string value = rejected',
    [checkProductSizeTexts('x'), checkProductSizeTexts([1]), checkProductSizeTexts({ extra: 'x' }), checkProductSizeTexts({ title: 5 })],
    [
      { ok: false, message: SIZE_TEXTS_INVALID },
      { ok: false, message: SIZE_TEXTS_INVALID },
      { ok: false, message: SIZE_TEXTS_INVALID },
      { ok: false, message: SIZE_TEXTS_INVALID },
    ],
  )
  check('A08 read: tolerant (same rule as the store) · bad values ignored', readProductSizeTexts({ title: ' أ ', intro: 7, extra: 'x', guide: LONG(201) }), { title: 'أ' })
  const stored = { title: 'قيس مكانك', widthLabel: 'العرض', meterNote: 'اسألنا على واتساب' }
  const reread = readProductSizeTexts(stored)
  check('A09 round trip: read then check = the stored value (saving the rest of the content keeps the texts)', checkProductSizeTexts(reread), { ok: true, value: stored })

  return { passed, failures }
}
