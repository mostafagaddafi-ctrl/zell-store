/**
 * حالات اختبار أكواد الخصم — من غير أي مكتبة اختبار (الريبو مافيهوش test runner).
 * runCouponCases() بترجّع الحالات اللي فشلت بس (فاضية = كله تمام). الـCI بيعمل typecheck للملف ده،
 * ومش متصدّر من index فمابيدخلش في المتجر ولا اللوحة.
 *
 * PTEST_0019 = نفس الأرقام اللي 0019_coupons_ptest.sql ثبّتها على Production (جوه معاملات بترجع).
 */
import { couponDiscountPiastres, normalizeCouponCode, parseCouponPreview, type CouponDiscountResult, type CouponTerms } from './coupons'

export type CouponCaseFailure = { name: string; expected: string; actual: string }

function pct(code: string, percentOff: number, maxDiscountPiastres: number | null = null, minSubtotalPiastres = 0): CouponTerms {
  return { code, kind: 'percent', percentOff, amountOffPiastres: null, maxDiscountPiastres, minSubtotalPiastres }
}

function fixed(code: string, amountOffPiastres: number, minSubtotalPiastres = 0): CouponTerms {
  return { code, kind: 'fixed', percentOff: null, amountOffPiastres, maxDiscountPiastres: null, minSubtotalPiastres }
}

function show(result: CouponDiscountResult): string {
  if (result.status === 'ok') return 'ok:' + String(result.discountPiastres)
  if (result.status === 'below_minimum') return 'below_minimum:' + String(result.minSubtotalPiastres)
  return result.status
}

/** [الاسم، القيمة الخام، المتوقع بعد التطبيع] */
export const NORMALIZE_CASES: ReadonlyArray<readonly [string, unknown, string | null]> = [
  ['lowercase', 'zell10', 'ZELL10'],
  ['edge spaces', '  zell10  ', 'ZELL10'],
  ['tabs/newline at edges', '\tZELL10\n', 'ZELL10'],
  ['dash and underscore', 'zell-10_a', 'ZELL-10_A'],
  ['exactly 4', 'ab12', 'AB12'],
  ['exactly 32', 'A'.repeat(32), 'A'.repeat(32)],
  ['NFD é', 'cafe\u0301', null],
  ['NFC é', 'caf\u00e9', null],
  ['fullwidth', '\uff3a\uff25\uff2c\uff2c10', null],
  ['arabic', 'خصم10', null],
  ['arabic digits', 'ZELL\u0661\u0660', null],
  ['too short', 'AB', null],
  ['too long', 'A'.repeat(33), null],
  ['inner space', 'ZELL 10', null],
  ['empty', '', null],
  ['spaces only', '   ', null],
  ['german ß (no SS)', 'stra\u00dfe', null],
  ['dotless ı (no I)', 'z\u0131ll10', null],
  ['number', 123456, null],
  ['null', null, null],
  ['object', { code: 'ZELL10' }, null],
]

/** نتايج 0019 على Production (ptest): [الاسم، الشروط، subtotal بالقرش، المتوقع]. */
export const PTEST_0019: ReadonlyArray<readonly [string, CouponTerms, number, string]> = [
  ['C1 10% of 600', pct('ZELL10', 10), 60000, 'ok:6000'],
  ['C2 round 6172.5 → 6173', pct('ZELL10', 10), 61725, 'ok:6173'],
  ['C3 50% capped 100', pct('HALF50', 50, 10000), 60000, 'ok:10000'],
  ['C4 fixed 50', fixed('FIX5000', 5000), 60000, 'ok:5000'],
  ['C5 fixed > subtotal', fixed('FIXBIG', 9999999), 60000, 'ok:60000'],
  ['C6 min = subtotal', pct('MIN60000', 10, null, 60000), 60000, 'ok:6000'],
  ['C7 min = subtotal + 1', pct('MIN60001', 10, null, 60001), 60000, 'below_minimum:60001'],
  ['C24 installer order (items only)', pct('ZELL10', 10), 60000, 'ok:6000'],
  ['C24b film + tool', pct('ZELL10', 10), 80000, 'ok:8000'],
  ['C25 1% of 10 piastres', pct('ONE1PCT', 1), 10, 'not_applicable'],
]

/** حالات إضافية: التقريب، الحد الأدنى بقرش، صفر، وشروط/مدخلات مش صالحة. */
export const EXTRA_CASES: ReadonlyArray<readonly [string, CouponTerms, number, string]> = [
  ['15% of 61725 = 9258.75', pct('PCT15', 15), 61725, 'ok:9259'],
  ['10% of 61715 = 6171.5', pct('PCT10', 10), 61715, 'ok:6172'],
  ['10% of 61704 = 6170.4', pct('PCT10', 10), 61704, 'ok:6170'],
  ['1% of 50 = 0.5 → 1', pct('PCT01', 1), 50, 'ok:1'],
  ['1% of 49 = 0.49 → 0', pct('PCT01', 1), 49, 'not_applicable'],
  ['90% of 1000', pct('PCT90', 90), 1000, 'ok:900'],
  ['cap above percent', pct('CAPHI', 10, 10000), 60000, 'ok:6000'],
  ['cap = 1', pct('CAP1', 50, 1), 60000, 'ok:1'],
  ['fixed below subtotal', fixed('FIXLOW', 2500), 60000, 'ok:2500'],
  ['fixed = subtotal', fixed('FIXEQ', 60000), 60000, 'ok:60000'],
  ['min exact', pct('MINX', 10, null, 50000), 50000, 'ok:5000'],
  ['min minus one piastre', pct('MINX', 10, null, 50000), 49999, 'below_minimum:50000'],
  ['subtotal 0 percent', pct('ZERO10', 10), 0, 'not_applicable'],
  ['subtotal 0 fixed', fixed('ZEROFX', 5000), 0, 'not_applicable'],
  ['subtotal 0 below min', pct('ZEROMN', 10, null, 1), 0, 'below_minimum:1'],
  ['int4 max subtotal 90%', pct('BIG90', 90), 2147483647, 'ok:1932735282'],
  ['subtotal fraction', pct('ZELL10', 10), 100.5, 'invalid_terms'],
  ['subtotal negative', pct('ZELL10', 10), -1, 'invalid_terms'],
  ['subtotal > int4', pct('ZELL10', 10), 2147483648, 'invalid_terms'],
  ['percent 0', pct('BAD000', 0), 60000, 'invalid_terms'],
  ['percent 91', pct('BAD091', 91), 60000, 'invalid_terms'],
  ['percent 10.5', pct('BAD105', 10.5), 60000, 'invalid_terms'],
  ['cap 0', pct('BADCAP', 10, 0), 60000, 'invalid_terms'],
  ['fixed 0', fixed('BADFX0', 0), 60000, 'invalid_terms'],
  ['fixed above max', fixed('BADFXM', 10000001), 60000, 'invalid_terms'],
  ['min negative', pct('BADMIN', 10, null, -1), 60000, 'invalid_terms'],
  ['min above max', pct('BADMAX', 10, null, 100000001), 60000, 'invalid_terms'],
  ['code not normalized', pct('zell10', 10), 60000, 'invalid_terms'],
]

const VALID_PREVIEW = {
  ok: true,
  code: 'ZELL10',
  kind: 'percent',
  percent_off: 10,
  amount_off_piastres: null,
  max_discount_piastres: null,
  min_subtotal_piastres: 0,
}

const VALID_FIXED_PREVIEW = {
  ok: true,
  code: 'FIX5000',
  kind: 'fixed',
  percent_off: null,
  amount_off_piastres: 5000,
  max_discount_piastres: null,
  min_subtotal_piastres: 0,
}

/** [الاسم، الرد الخام، المتوقع: 'ok:<discount on 60000>' أو 'null'] */
export const PREVIEW_CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['valid percent (ptest C29)', VALID_PREVIEW, 'ok:6000'],
  ['valid percent with cap', { ...VALID_PREVIEW, code: 'HALF50', percent_off: 50, max_discount_piastres: 10000 }, 'ok:10000'],
  ['valid fixed (ptest C29)', VALID_FIXED_PREVIEW, 'ok:5000'],
  ['valid with min', { ...VALID_PREVIEW, min_subtotal_piastres: 60001 }, 'below_minimum:60001'],
  ['ok false', { ...VALID_PREVIEW, ok: false }, 'null'],
  ['missing key', { ok: true, code: 'ZELL10', kind: 'percent', percent_off: 10, amount_off_piastres: null, min_subtotal_piastres: 0 }, 'null'],
  ['extra discount key', { ...VALID_PREVIEW, discount_piastres: 6000 }, 'null'],
  ['lowercase code', { ...VALID_PREVIEW, code: 'zell10' }, 'null'],
  ['arabic code', { ...VALID_PREVIEW, code: 'خصم10' }, 'null'],
  ['unknown kind', { ...VALID_PREVIEW, kind: 'free' }, 'null'],
  ['percent as string', { ...VALID_PREVIEW, percent_off: '10' }, 'null'],
  ['percent 0', { ...VALID_PREVIEW, percent_off: 0 }, 'null'],
  ['percent 91', { ...VALID_PREVIEW, percent_off: 91 }, 'null'],
  ['percent fraction', { ...VALID_PREVIEW, percent_off: 10.5 }, 'null'],
  ['percent with amount', { ...VALID_PREVIEW, amount_off_piastres: 5000 }, 'null'],
  ['percent cap 0', { ...VALID_PREVIEW, max_discount_piastres: 0 }, 'null'],
  ['percent cap above max', { ...VALID_PREVIEW, max_discount_piastres: 10000001 }, 'null'],
  ['fixed with percent', { ...VALID_FIXED_PREVIEW, percent_off: 10 }, 'null'],
  ['fixed with cap', { ...VALID_FIXED_PREVIEW, max_discount_piastres: 1000 }, 'null'],
  ['fixed amount 0', { ...VALID_FIXED_PREVIEW, amount_off_piastres: 0 }, 'null'],
  ['fixed amount above max', { ...VALID_FIXED_PREVIEW, amount_off_piastres: 10000001 }, 'null'],
  ['fixed amount null', { ...VALID_FIXED_PREVIEW, amount_off_piastres: null }, 'null'],
  ['min negative', { ...VALID_PREVIEW, min_subtotal_piastres: -1 }, 'null'],
  ['min above max', { ...VALID_PREVIEW, min_subtotal_piastres: 100000001 }, 'null'],
  ['min missing value', { ...VALID_PREVIEW, min_subtotal_piastres: null }, 'null'],
  ['array', [VALID_PREVIEW], 'null'],
  ['null', null, 'null'],
  ['string', 'ZELL10', 'null'],
]

export function runCouponCases(): CouponCaseFailure[] {
  const failures: CouponCaseFailure[] = []
  const check = (name: string, expected: string, actual: string) => {
    if (expected !== actual) failures.push({ name, expected, actual })
  }
  for (const [name, raw, expected] of NORMALIZE_CASES) {
    check('normalize: ' + name, String(expected), String(normalizeCouponCode(raw)))
  }
  check('normalize: NFD = NFC', String(normalizeCouponCode('cafe\u0301')), String(normalizeCouponCode('caf\u00e9')))
  for (const [name, terms, subtotal, expected] of [...PTEST_0019, ...EXTRA_CASES]) {
    check('discount: ' + name, expected, show(couponDiscountPiastres(terms, subtotal)))
  }
  for (const [name, raw, expected] of PREVIEW_CASES) {
    const terms = parseCouponPreview(raw)
    check('preview: ' + name, expected, terms === null ? 'null' : show(couponDiscountPiastres(terms, 60000)))
  }
  return failures
}
