/**
 * SIZE-TEXTS — حالات نصوص «حدد المقاس» في المتجر (منطق خالص — pnpm --filter @zell/storefront cases، suite size-texts).
 * النصوص الافتراضية والحدود مكتوبة هنا بالحرف (ونفسها في apps/admin/lib/content/sizeTexts.cases.ts)، فأي اختلاف بين
 * المتجر واللوحة أو أي تغيير في النص القديم بيفشل. وS05 بيثبت إن النصوص مالهاش دخل بالمقاس المحفوظ أو الحساب.
 */

import { widthOptionsOf, type StoreProduct } from '@zell/core'
import { cmEntryState, restoreSizeDraft, sizeDraftOf, sizeRulesKeyOf } from './sizeEntry'
import { DEFAULT_SIZE_TEXTS, SIZE_TEXT_KEYS, SIZE_TEXT_MAX, readProductSizeTexts, resolveSizeTexts } from './sizeTexts'

export type SizeTextsCaseFailure = { name: string; expected: string; actual: string }

const failures: SizeTextsCaseFailure[] = []
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
  check('S01 defaults = the old SizePanel texts exactly (10 keys, same order)', [SIZE_TEXT_KEYS, DEFAULT_SIZE_TEXTS], [Object.keys(OLD_TEXTS), OLD_TEXTS])
  check('S02 limits = admin limits exactly', SIZE_TEXT_MAX, { title: 40, intro: 200, rollHint: 200, widthLabel: 30, heightLabel: 30, heightExample: 30, guide: 200, toMeters: 60, toCentimeters: 60, meterNote: 200 })
  check('S03 read: not an object = {}', [readProductSizeTexts(undefined), readProductSizeTexts(null), readProductSizeTexts('x'), readProductSizeTexts([1]), readProductSizeTexts(5)], [{}, {}, {}, {}, {}])
  check(
    'S04 read: trims · drops empty/whitespace · drops non-strings · drops unknown keys · drops over the limit · keeps exactly the limit',
    readProductSizeTexts({
      title: '  مقاس الشباك  ',
      intro: '   ',
      rollHint: '',
      widthLabel: 12,
      heightLabel: LONG(31),
      heightExample: LONG(30),
      extra: 'x',
      guide: null,
    }),
    { title: 'مقاس الشباك', heightExample: LONG(30) },
  )
  check('S05 resolve: undefined and {} = the old texts', [resolveSizeTexts(undefined), resolveSizeTexts({})], [OLD_TEXTS, OLD_TEXTS])
  check(
    'S06 resolve: only the edited key changes · whitespace-only = default',
    resolveSizeTexts({ title: 'قيس مكانك', meterNote: '   ' }),
    { ...OLD_TEXTS, title: 'قيس مكانك' },
  )

  // S07 — تغيير النصوص مالوش دخل بالمقاس المحفوظ (بصمة المسودة ورجوعها) ولا بالحساب
  const P = product()
  const key = sizeRulesKeyOf(P)
  const oldFormula = [P.width_cm, P.min_length_cm, P.step_cm, P.max_length_cm, 0, widthOptionsOf(P).map((o) => o.width_cm).join(',')].join('|')
  const draft = sizeDraftOf({ rulesKey: key, widthCm: 120, mode: 'window', width: '120', height: '500', lengthCm: 500, meterCm: null })
  const before = { key, restore: restoreSizeDraft(draft, key, P), cm: cmEntryState('120', '500', P) }
  resolveSizeTexts({ title: 'عنوان جديد', widthLabel: 'العرض', heightLabel: 'الطول', guide: 'اكتب المقاس' })
  readProductSizeTexts({ title: 'عنوان جديد' })
  const after = { key: sizeRulesKeyOf(P), restore: restoreSizeDraft(draft, sizeRulesKeyOf(P), P), cm: cmEntryState('120', '500', P) }
  check('S07 texts do not touch the saved size: rules key = the old SizePanel formula · same draft restore · same calculation', [key === oldFormula, after], [true, before])

  return { passed, failures }
}
