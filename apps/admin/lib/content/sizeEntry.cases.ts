/**
 * LENGTH-INPUT — حالات «طريقة إدخال المقاس في صفحة المنتج» في اللوحة (منطق خالص — pnpm --filter @zell/admin cases،
 * suite size-entry). القراية نفس قاعدة المتجر بالحرف، والتحقق بيكتب الحقل دايمًا.
 */

import {
  DEFAULT_PRODUCT_SIZE_ENTRY,
  SIZE_ENTRY_INVALID,
  SIZE_ENTRY_NOTE,
  SIZE_ENTRY_OPTIONS,
  SIZE_ENTRY_TITLE,
  checkProductSizeEntry,
  readProductSizeEntry,
} from './sizeEntry'

export type SizeEntryCaseFailure = { name: string; expected: string; actual: string }

const failures: SizeEntryCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

export function runSizeEntryCases(): { passed: number; failures: SizeEntryCaseFailure[] } {
  check('E01 read: only "m" = meters; missing · empty · "M" · number · object = cm (same rule as the storefront)', [
    readProductSizeEntry('m'),
    readProductSizeEntry('cm'),
    readProductSizeEntry(undefined),
    readProductSizeEntry(''),
    readProductSizeEntry('M'),
    readProductSizeEntry(1),
    readProductSizeEntry({ value: 'm' }),
  ], ['m', 'cm', 'cm', 'cm', 'cm', 'cm', 'cm'])
  check('E02 server check: cm and m accepted · missing/null = cm · anything else rejected', [
    checkProductSizeEntry('cm'),
    checkProductSizeEntry('m'),
    checkProductSizeEntry(undefined),
    checkProductSizeEntry(null),
    checkProductSizeEntry('M'),
    checkProductSizeEntry(''),
    checkProductSizeEntry(2),
  ], [
    { ok: true, value: 'cm' },
    { ok: true, value: 'm' },
    { ok: true, value: 'cm' },
    { ok: true, value: 'cm' },
    { ok: false, message: SIZE_ENTRY_INVALID },
    { ok: false, message: SIZE_ENTRY_INVALID },
    { ok: false, message: SIZE_ENTRY_INVALID },
  ])
  // قراية ← حفظ ← قراية: القيمة نفسها (الحقل مابيضيعش مع حفظ باقي المحتوى)
  const roundTrip = (stored: unknown) => {
    const read = readProductSizeEntry(stored)
    const saved = checkProductSizeEntry(read)
    return saved.ok ? readProductSizeEntry(saved.value) : 'rejected'
  }
  check('E03 read → save → read keeps the value (m stays m, missing becomes cm and is written)', [roundTrip('m'), roundTrip('cm'), roundTrip(undefined), roundTrip('x')], ['m', 'cm', 'cm', 'cm'])
  check('E04 default and formal texts', [
    DEFAULT_PRODUCT_SIZE_ENTRY,
    SIZE_ENTRY_TITLE,
    SIZE_ENTRY_OPTIONS.map((option) => option.value),
    SIZE_ENTRY_OPTIONS.map((option) => option.label),
    SIZE_ENTRY_NOTE,
  ], [
    'cm',
    'طريقة إدخال المقاس في صفحة المنتج',
    ['cm', 'm'],
    ['مقاس المكان بالسنتيمتر (الافتراضي)', 'الطول بالمتر'],
    'يحدد هذا الإعداد الطريقة التي تظهر أولًا فقط، وتظل الطريقتان متاحتين للعميل. لا يؤثر على الحساب أو الأسعار.',
  ])
  return { passed, failures }
}
