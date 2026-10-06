/**
 * حالات اختبار PR5 (أكواد الخصم في اللوحة) — منطق خالص بس، من غير أي نداء داتابيز ولا كتابة.
 * runAdminCouponCases() بترجّع الحالات اللي فشلت بس (فاضية = كله تمام). الـCI بيعمل typecheck
 * للملف ده، ومحدش بيستورده فمابيدخلش في الـbundle.
 *
 * ⚠️ مفيش هنا أي إنشاء كوبون ولا تغيير coupons_enabled ولا حالة أوردر.
 */

import { ORDER_CANCELLED_FINAL_MESSAGE, statusTargets } from '../enums'
import * as form from './form'
import {
  CODE_LOCKED_MESSAGE,
  ENABLE_NEEDS_LIVE_MESSAGE,
  KIND_LOCKED_MESSAGE,
  OWNER_ONLY_MESSAGE,
  couponIdentityLocked,
  couponLimitLabel,
  couponToForm,
  couponValueLabel,
  discountRowLabel,
  discountRowValue,
  emptyCouponForm,
  enableGate,
  formToCouponInput,
  isCouponLive,
  lockedFieldsError,
  orderCouponSnapshot,
  orderTotalFormula,
  ownerGate,
  parseCouponId,
  toAdminCoupon,
  validateCouponInput,
  type CouponInput,
  type CouponRow,
} from './form'

export type AdminCouponCaseFailure = { name: string; expected: string; actual: string }

const PERCENT: CouponInput = {
  code: ' zell10 ',
  kind: 'percent',
  percentOff: 10,
  amountOffPiastres: null,
  maxDiscountPiastres: null,
  minSubtotalPiastres: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  maxUsesPerPhone: 1,
  isActive: true,
  internalNote: '',
}

const FIXED: CouponInput = { ...PERCENT, code: 'FIX5000', kind: 'fixed', percentOff: null, amountOffPiastres: 5000 }

/** [الاسم، المدخلات، المتوقع: 'ok' أو جزء من رسالة الرفض] */
export const VALIDATION_CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['percent ok', PERCENT, 'ok'],
  ['percent with cap ok', { ...PERCENT, maxDiscountPiastres: 10000 }, 'ok'],
  ['fixed ok', FIXED, 'ok'],
  ['not an object', null, 'غير صالحة'],
  ['arabic code', { ...PERCENT, code: 'خصم10' }, 'الكود'],
  ['short code', { ...PERCENT, code: 'AB' }, 'الكود'],
  ['inner space', { ...PERCENT, code: 'ZELL 10' }, 'الكود'],
  ['unknown kind', { ...PERCENT, kind: 'free' }, 'نوع الخصم'],
  ['percent 0', { ...PERCENT, percentOff: 0 }, 'النسبة'],
  ['percent 91', { ...PERCENT, percentOff: 91 }, 'النسبة'],
  ['percent 90 ok', { ...PERCENT, percentOff: 90 }, 'ok'],
  ['percent fraction', { ...PERCENT, percentOff: 10.5 }, 'النسبة'],
  ['percent with amount', { ...PERCENT, amountOffPiastres: 5000 }, 'مالوش مبلغ'],
  ['cap 0', { ...PERCENT, maxDiscountPiastres: 0 }, 'أقصى خصم'],
  ['cap above max', { ...PERCENT, maxDiscountPiastres: 10000001 }, 'أقصى خصم'],
  ['fixed 0', { ...FIXED, amountOffPiastres: 0 }, 'مبلغ الخصم'],
  ['fixed max ok', { ...FIXED, amountOffPiastres: 10000000 }, 'ok'],
  ['fixed above max', { ...FIXED, amountOffPiastres: 10000001 }, 'مبلغ الخصم'],
  ['fixed with percent', { ...FIXED, percentOff: 10 }, 'مالوش نسبة'],
  ['fixed with cap', { ...FIXED, maxDiscountPiastres: 1000 }, 'للنسبة بس'],
  ['min negative', { ...PERCENT, minSubtotalPiastres: -1 }, 'الحد الأدنى'],
  ['min max ok', { ...PERCENT, minSubtotalPiastres: 100000000 }, 'ok'],
  ['min above max', { ...PERCENT, minSubtotalPiastres: 100000001 }, 'الحد الأدنى'],
  ['ends before starts', { ...PERCENT, startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }, 'بعد البداية'],
  ['ends equal starts', { ...PERCENT, startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }, 'بعد البداية'],
  ['window ok', { ...PERCENT, startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-02T00:00:00Z' }, 'ok'],
  ['bad date', { ...PERCENT, startsAt: 'yesterday' }, 'البداية'],
  ['max uses 0', { ...PERCENT, maxUses: 0 }, 'الحد الإجمالي'],
  ['max uses 1 ok', { ...PERCENT, maxUses: 1 }, 'ok'],
  ['max uses above int4', { ...PERCENT, maxUses: 2147483648 }, 'الحد الإجمالي'],
  ['per phone 0', { ...PERCENT, maxUsesPerPhone: 0 }, 'لكل موبايل'],
  ['per phone unlimited ok', { ...PERCENT, maxUsesPerPhone: null }, 'ok'],
  ['active missing', { ...PERCENT, isActive: undefined }, 'حالة الكوبون'],
  ['note 500 ok', { ...PERCENT, internalNote: 'ن'.repeat(500) }, 'ok'],
  ['note 501', { ...PERCENT, internalNote: 'ن'.repeat(501) }, '٥٠٠'],
  ['note 300 emoji = 300 chars ok', { ...PERCENT, internalNote: '🎁'.repeat(300) }, 'ok'],
  ['note number', { ...PERCENT, internalNote: 5 }, 'الملاحظة'],
]

const ROW: CouponRow = {
  id: 7,
  code: 'HALF50',
  kind: 'percent',
  percent_off: 50,
  amount_off_piastres: null,
  max_discount_piastres: 10000,
  min_subtotal_piastres: 50000,
  starts_at: '2030-01-01T10:00:00.000Z',
  ends_at: '2030-02-01T10:00:00.000Z',
  max_uses: 100,
  max_uses_per_phone: null,
  is_active: true,
  internal_note: 'حملة يناير',
  created_at: '2029-12-01T00:00:00Z',
  updated_at: '2029-12-02T00:00:00Z',
  uses: [{ count: 3 }],
  references: [{ count: 4 }],
}

export function runAdminCouponCases(): AdminCouponCaseFailure[] {
  const failures: AdminCouponCaseFailure[] = []
  const check = (name: string, expected: string, actual: string) => {
    if (expected !== actual) failures.push({ name, expected, actual })
  }

  // ── الصلاحية: المالك بس (السيرفر بيطبقها في كل action قبل أي حاجة) ──
  check('owner: allowed', 'null', String(ownerGate('owner')))
  check('admin: forbidden', 'FORBIDDEN|' + OWNER_ONLY_MESSAGE, (ownerGate('admin')?.code ?? '') + '|' + (ownerGate('admin')?.message ?? ''))
  check('unknown role: forbidden', 'FORBIDDEN', String(ownerGate('')?.code))

  // ── مفيش حذف نهائي: ولا دالة حذف في الوحدة ──
  check('no delete export', '', Object.keys(form).filter((key) => /delete|remove|destroy/i.test(key)).join(','))

  // ── التحقق لكل نوع وحدوده ──
  for (const [name, input, expected] of VALIDATION_CASES) {
    const result = validateCouponInput(input)
    const actual = result.ok ? 'ok' : result.message.includes(expected) ? expected : result.message
    check('validate: ' + name, expected, actual)
  }
  const normalized = validateCouponInput(PERCENT)
  check('validate: code normalized', 'ZELL10', normalized.ok ? normalized.value.code : 'fail')
  check('validate: empty note = null', 'null', normalized.ok ? String(normalized.value.internal_note) : 'fail')
  const defaultPhone = validateCouponInput({ ...PERCENT, maxUsesPerPhone: undefined })
  check('validate: per phone default 1', '1', defaultPhone.ok ? String(defaultPhone.value.max_uses_per_phone) : 'fail')
  const fixedWrite = validateCouponInput(FIXED)
  check(
    'validate: fixed shape',
    'fixed|null|5000|null',
    fixedWrite.ok
      ? [fixedWrite.value.kind, fixedWrite.value.percent_off, fixedWrite.value.amount_off_piastres, fixedWrite.value.max_discount_piastres].map(String).join('|')
      : 'fail',
  )

  // ── منع تغيير الكود/النوع بعد الاستخدام ──
  check('lock: unused code change ok', 'null', String(lockedFieldsError({ code: 'A1B2', kind: 'percent' }, { code: 'C3D4', kind: 'percent' }, 0)))
  check('lock: used code change', CODE_LOCKED_MESSAGE, String(lockedFieldsError({ code: 'A1B2', kind: 'percent' }, { code: 'C3D4', kind: 'percent' }, 1)))
  check('lock: used kind change', KIND_LOCKED_MESSAGE, String(lockedFieldsError({ code: 'A1B2', kind: 'percent' }, { code: 'A1B2', kind: 'fixed' }, 2)))
  check('lock: used other fields ok', 'null', String(lockedFieldsError({ code: 'A1B2', kind: 'percent' }, { code: 'A1B2', kind: 'percent' }, 5)))

  // ── التشغيل: لازم كوبون ساري (والاختبار مابيشغّلش حاجة) ──
  check('enable: no live coupon', ENABLE_NEEDS_LIVE_MESSAGE, String(enableGate(true, 0)?.message))
  check('enable: one live coupon', 'null', String(enableGate(true, 1)))
  check('disable: always allowed', 'null', String(enableGate(false, 0)))
  const now = Date.parse('2030-01-15T00:00:00Z')
  check('live: active no window', 'true', String(isCouponLive({ isActive: true, startsAt: null, endsAt: null }, now)))
  check('live: stopped', 'false', String(isCouponLive({ isActive: false, startsAt: null, endsAt: null }, now)))
  check('live: future start', 'false', String(isCouponLive({ isActive: true, startsAt: '2030-01-16T00:00:00Z', endsAt: null }, now)))
  check('live: starts now', 'true', String(isCouponLive({ isActive: true, startsAt: '2030-01-15T00:00:00Z', endsAt: null }, now)))
  check('live: ends now (half-open)', 'false', String(isCouponLive({ isActive: true, startsAt: null, endsAt: '2030-01-15T00:00:00Z' }, now)))
  check('live: ended', 'false', String(isCouponLive({ isActive: true, startsAt: null, endsAt: '2030-01-14T00:00:00Z' }, now)))

  // ── المعرّف ──
  check('id: numeric string', '12', String(parseCouponId('12')))
  check('id: number', '12', String(parseCouponId(12)))
  check('id: zero', 'null', String(parseCouponId('0')))
  check('id: injection', 'null', String(parseCouponId('1&is_active=eq.true')))
  check('id: negative', 'null', String(parseCouponId(-1)))

  // ── القايمة: الاستخدامات من orders(count) في نفس الطلب ──
  const coupon = toAdminCoupon(ROW)
  check('list: uses from embedded count', '3', String(coupon.uses))
  check('list: id as text', '7', coupon.id)
  check('list: references incl. cancelled', '4', String(coupon.references))
  const noCounts = toAdminCoupon({ ...ROW, uses: undefined, references: undefined })
  check('list: no counts = 0', '0|0', String(noCounts.uses) + '|' + String(noCounts.references))

  // ── قفل الهوية في النموذج = قاعدة السيرفر (كل المراجع، حتى الملغية) ──
  for (const [name, uses, references, locked] of [
    ['live use', 1, 1, true],
    ['cancelled use only', 0, 1, true],
    ['no orders', 0, 0, false],
  ] as const) {
    const row = toAdminCoupon({ ...ROW, uses: [{ count: uses }], references: [{ count: references }] })
    check('identity: ' + name + ' uses', String(uses), String(row.uses))
    check('identity: ' + name + ' references', String(references), String(row.references))
    check('identity: ' + name + ' form lock', String(locked), String(couponIdentityLocked(row)))
    check(
      'identity: ' + name + ' server lock',
      String(locked),
      String(lockedFieldsError({ code: row.code, kind: row.kind }, { code: 'NEWCODE1', kind: row.kind }, row.references) !== null),
    )
  }
  check('list: value label with cap', '50% · أقصى خصم 100 ج.م', couponValueLabel(coupon))
  check('list: fixed label', '50 ج.م', couponValueLabel({ kind: 'fixed', percentOff: null, amountOffPiastres: 5000, maxDiscountPiastres: null }))
  check('list: unlimited label', 'من غير حد', couponLimitLabel(coupon.maxUsesPerPhone))

  // ── النموذج: الخانات ↔ المدخلات ↔ الكتابة ──
  check('form: default per phone', '1', emptyCouponForm().maxUsesPerPhone)
  const roundTrip = formToCouponInput(couponToForm(coupon))
  const roundWrite = roundTrip.ok ? validateCouponInput(roundTrip.value) : null
  check(
    'form: round trip',
    JSON.stringify({ code: 'HALF50', percent: 50, cap: 10000, min: 50000, starts: ROW.starts_at, ends: ROW.ends_at, maxUses: 100, perPhone: null, note: 'حملة يناير' }),
    roundWrite !== null && roundWrite.ok
      ? JSON.stringify({
          code: roundWrite.value.code,
          percent: roundWrite.value.percent_off,
          cap: roundWrite.value.max_discount_piastres,
          min: roundWrite.value.min_subtotal_piastres,
          starts: roundWrite.value.starts_at,
          ends: roundWrite.value.ends_at,
          maxUses: roundWrite.value.max_uses,
          perPhone: roundWrite.value.max_uses_per_phone,
          note: roundWrite.value.internal_note,
        })
      : 'fail',
  )
  const fixedForm = { ...emptyCouponForm(), code: 'fix50', kind: 'fixed' as const, amount: '50.25' }
  const fixedParsed = formToCouponInput(fixedForm)
  check('form: pounds → piastres', '5025', fixedParsed.ok ? String(fixedParsed.value.amountOffPiastres) : 'fail')
  check('form: three decimals rejected', 'false', String(formToCouponInput({ ...fixedForm, amount: '50.255' }).ok))
  check('form: amount required', 'false', String(formToCouponInput({ ...fixedForm, amount: '' }).ok))
  check('form: percent text rejected', 'false', String(formToCouponInput({ ...emptyCouponForm(), code: 'ZELL10', percent: '10.5' }).ok))
  const unlimited = formToCouponInput({ ...emptyCouponForm(), code: 'ZELL10', percent: '10', maxUsesPerPhone: '' })
  check('form: empty per phone = unlimited', 'null', unlimited.ok ? String(unlimited.value.maxUsesPerPhone) : 'fail')

  // ── الطلبات: لقطة الكوبون والمعادلة ──
  const snapshot = orderCouponSnapshot({
    coupon_code: 'ZELL10',
    coupon_kind: 'percent',
    coupon_percent: 10,
    coupon_amount_piastres: null,
    coupon_max_discount_piastres: 10000,
    discount_piastres: 6000,
  })
  check('order: snapshot', 'ZELL10|percent|10|10000|6000', snapshot ? [snapshot.code, snapshot.kind, snapshot.percentOff, snapshot.maxDiscountPiastres, snapshot.discountPiastres].map(String).join('|') : 'null')
  check('order: snapshot label', '10% · أقصى خصم 100 ج.م', snapshot ? couponValueLabel(snapshot) : 'null')
  check('order: old order = no snapshot', 'null', String(orderCouponSnapshot({})))
  check('order: no coupon (0019 shape)', 'null', String(orderCouponSnapshot({ coupon_code: null, discount_piastres: 0 })))
  check('order: discount row', 'خصم (ZELL10)|\u221260 ج.م', discountRowLabel('ZELL10') + '|' + discountRowValue(6000))
  check(
    'order: formula with installer',
    'الأصناف 600 ج.م \u2212 الخصم 60 ج.م + الشحن 80 ج.م + التركيب 300 ج.م + الانتقال 50 ج.م = 970 ج.م',
    orderTotalFormula({
      subtotalPiastres: 60000,
      discountPiastres: 6000,
      shippingPiastres: 8000,
      installationRequested: true,
      installationPiastres: 30000,
      installationTravelPiastres: 5000,
      totalPiastres: 97000,
    }),
  )
  check(
    'order: formula without installer',
    'الأصناف 600 ج.م \u2212 الخصم 60 ج.م + الشحن 80 ج.م = 620 ج.م',
    orderTotalFormula({
      subtotalPiastres: 60000,
      discountPiastres: 6000,
      shippingPiastres: 8000,
      installationRequested: false,
      installationPiastres: 0,
      installationTravelPiastres: 0,
      totalPiastres: 62000,
    }),
  )

  // ── الإلغاء النهائي ──
  check('cancelled: no transitions', '', statusTargets('cancelled').join(','))
  check('new: other statuses', 'confirmed,shipped,delivered,cancelled', statusTargets('new').join(','))
  check('cancelled: message', 'الطلب ده ملغي، والإلغاء نهائي — مينفعش يرجع لأي حالة تانية.', ORDER_CANCELLED_FINAL_MESSAGE)

  return failures
}
