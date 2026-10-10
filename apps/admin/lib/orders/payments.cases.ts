/**
 * 0021-A P2 — حالات الدفعات ورسوم التأكيد في اللوحة: المبالغ والنسبة (عرض نسبة مئوية وتخزين 0.01%) · فورم الإعداد
 * بقواعد الداتابيز · قراءة الردود · تحويل الأخطاء (من غير أكواد داخلية) · متى يظهر إيه · قالب واتساب.
 * منطق خالص بس. المشغّل: scripts/run-cases.mjs (suite «payments»).
 */
import { orderFailureKind } from './cycle'
import {
  FEE_METHOD_LABELS,
  FEE_SCOPE_LABELS,
  KIND_LABELS,
  PAYMENT_ERROR_MESSAGES,
  PAYMENT_FIELD_MESSAGES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TEXT,
  PURPOSE_LABELS,
  bpToPercentInput,
  bpToPercentLabel,
  canDeliver,
  canRecordPayment,
  canRefund,
  feeConfigLine,
  feeConfigOf,
  feeFormOf,
  needsRefund,
  parseMethods,
  parsePaymentSummary,
  parseSettings,
  paymentFailureKind,
  percentInputToBp,
  piastresToPoundsInput,
  poundsInputToPiastres,
  renderTemplate,
  suggestedAmount,
  suggestedPurpose,
  whatsappHref,
  type FeeForm,
  type PaymentSummary,
} from './payments'

type Failure = { name: string; expected: string; actual: string }
export type PaymentCasesReport = { passed: number; failures: Failure[] }

const LATIN = /[A-Za-z_]/

const SUMMARY_RAW = {
  ok: true, order_id: 7, status: 'shipped', updated_at: '2026-10-10T10:00:00Z', total_piastres: 40000, paid_piastres: 5000,
  remaining_piastres: 35000, confirmation_fee_piastres: 5000, fee_due_piastres: 0, payment_status: 'partial', has_refund: false,
  refunded_piastres: 0,
  payments: [{ id: 1, kind: 'payment', amount_piastres: 5000, purpose: 'confirmation_fee', method_id: 1, method_name: 'كاش',
               method_is_other: false, reference: 'TX-1', note: null, actor: 'x', paid_after_piastres: 5000, created_at: '2026-10-10T09:00:00Z' }],
}

export async function runPaymentCases(): Promise<PaymentCasesReport> {
  let passed = 0
  const failures: Failure[] = []
  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed++
    else failures.push({ name, expected: e, actual: a })
  }

  // ── A: المبالغ ──
  check('A1 pounds -> piastres', ['150', '150.5', '150.05', '٢٠٠', '0.01', '1٫25'].map((v) => poundsInputToPiastres(v)), [15000, 15050, 15005, 20000, 1, 125])
  check('A2 invalid pounds', ['', '0', '-5', '1.234', 'abc', '1e3', '10000000000'].map((v) => poundsInputToPiastres(v)), [null, null, null, null, null, null, null])
  check('A3 pounds cap', [poundsInputToPiastres('1000000'), poundsInputToPiastres('1000000.01'), poundsInputToPiastres('500', 40000)], [100000000, null, null])
  check('A4 piastres -> pounds input', [15000, 15050, 15005, 1, 12340].map(piastresToPoundsInput), ['150', '150.5', '150.05', '0.01', '123.4'])

  // ── B: النسبة (عرض % · تخزين 0.01%) ──
  check('B1 percent -> bp', ['10', '2.5', '2.55', '100', '0.01', '٢٫٥', '12.5%'].map(percentInputToBp), [1000, 250, 255, 10000, 1, 250, 1250])
  check('B2 invalid percent', ['', '0', '100.01', '101', '2.555', '-1', 'x'].map(percentInputToBp), [null, null, null, null, null, null, null])
  check('B3 bp -> percent label', [1000, 250, 255, 10000, 1, 1250].map(bpToPercentLabel), ['10%', '2.5%', '2.55%', '100%', '0.01%', '12.5%'])
  check('B4 round trip bp', [1, 50, 250, 999, 1000, 3333, 10000].map((bp) => percentInputToBp(bpToPercentInput(bp))), [1, 50, 250, 999, 1000, 3333, 10000])

  // ── F: فورم الإعداد بقواعد الحفظ ──
  const base: FeeForm = { enabled: true, scope: 'made_to_measure', method: 'percent', percent: '10', fixedPounds: '', fallbackPounds: '', thresholdPounds: '' }
  check('F1 enabled percent', feeConfigOf(base), { ok: true, config: { enabled: true, scope: 'made_to_measure', method: 'percent', percent_bp: 1000 } })
  check('F2 enabled percent missing -> percent field', feeConfigOf({ ...base, percent: '' }), { ok: false, field: 'percent_bp', message: PAYMENT_FIELD_MESSAGES['percent_bp'] })
  check('F3 shipping needs fallback, above_amount needs threshold', [
    feeConfigOf({ ...base, method: 'shipping', percent: '' }),
    feeConfigOf({ ...base, scope: 'above_amount', method: 'fixed', percent: '', fixedPounds: '50' }),
  ].map((r) => (r.ok ? 'ok' : r.field)), ['shipping_fallback_piastres', 'threshold_piastres'])
  check('F4 disabled keeps valid values, needs nothing', feeConfigOf({ ...base, enabled: false, percent: '', fixedPounds: '50' }), { ok: true, config: { enabled: false, scope: 'made_to_measure', method: 'percent', fixed_piastres: 5000 } })
  check('F5 disabled with a broken value -> field', feeConfigOf({ ...base, enabled: false, fixedPounds: '0' }).ok, false)
  check('F6 form <- config round trip', feeConfigOf(feeFormOf({ enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 25050, threshold_piastres: 100000 })), { ok: true, config: { enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 25050, threshold_piastres: 100000 } })
  check('F7 default form (no numbers): made_to_measure + shipping', feeFormOf({ enabled: false }), { enabled: false, scope: 'made_to_measure', method: 'shipping', percent: '', fixedPounds: '', fallbackPounds: '', thresholdPounds: '' })
  check('F8 config line', [feeConfigLine({ enabled: false }), feeConfigLine({ enabled: true, scope: 'all', method: 'percent', percent_bp: 250 })], ['رسوم التأكيد مقفولة.', 'مفعّلة · كل الطلبات · نسبة من إجمالي الطلب 2.5%'])

  // ── P: قراءة الردود ──
  const summary = parsePaymentSummary(SUMMARY_RAW) as PaymentSummary
  check('P1 summary parsed', [summary.totalPiastres, summary.paidPiastres, summary.remainingPiastres, summary.paymentStatus, summary.payments.length, summary.payments[0]?.methodName], [40000, 5000, 35000, 'partial', 1, 'كاش'])
  check('P2 bad summaries', [parsePaymentSummary({ ...SUMMARY_RAW, ok: false }), parsePaymentSummary({ ...SUMMARY_RAW, payment_status: 'x' }), parsePaymentSummary({ ...SUMMARY_RAW, paid_piastres: '5' }), parsePaymentSummary(null)], [null, null, null, null])
  check('P3 summary without rows', parsePaymentSummary({ ...SUMMARY_RAW, payments: undefined })?.payments.length, 0)
  check('P4 methods', [parseMethods([{ id: 1, name: 'كاش', sort_order: 10, is_archived: false, used: true, updated_at: 't' }])?.[0]?.used, parseMethods([{ id: 'x' }]), parseMethods({})], [true, null, null])
  check('P5 settings', parseSettings({ confirmation_fee: { enabled: true, scope: 'all', method: 'fixed', fixed_piastres: 5000, bogus: 1 }, customer_credit_enabled: false, payment_numbers: null, fee_policy: 'x', whatsapp_template: null, updated_at: 't' }), { fee: { enabled: true, scope: 'all', method: 'fixed', fixed_piastres: 5000 }, creditEnabled: false, paymentNumbers: null, feePolicy: 'x', whatsappTemplate: null, updatedAt: 't' })
  check('P6 bad settings', [parseSettings({ confirmation_fee: {}, customer_credit_enabled: false, updated_at: 't' }), parseSettings({ confirmation_fee: { enabled: false }, updated_at: 't' })], [null, null])

  // ── E: الأخطاء ──
  const kind = (error: unknown) => paymentFailureKind(error, 400)
  check('E1 every payment code -> clear validation message', Object.keys(PAYMENT_ERROR_MESSAGES).map((code) => kind({ code }).kind).filter((k) => k !== 'validation').length, 0)
  check('E2 field details', [kind({ code: '45416', details: 'reference' }), kind({ code: '45417', details: 'percent_bp' }), kind({ code: '45417', details: 'method' }), kind({ code: '45416', details: 'zzz' })],
    [{ kind: 'validation', message: PAYMENT_FIELD_MESSAGES['reference'] }, { kind: 'validation', message: PAYMENT_FIELD_MESSAGES['percent_bp'] }, { kind: 'validation', message: PAYMENT_FIELD_MESSAGES['method_fee'] }, { kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45416'] }])
  check('E3 identity / conflict / not found from the cycle', [kind({ code: '45400' }).kind, kind({ code: '45401' }).kind, kind({ code: '45403' }).kind, kind({ code: '45404' }).kind, kind({ code: '42501' }).kind], ['unauthenticated', 'forbidden', 'not_found', 'conflict', 'internal'])
  check('E4 sentinel names in message', [kind({ message: 'ZELL_PAY_BALANCE_DUE' }), kind({ message: 'ZELL_PAY_COMMAND_REUSED: x' })], [{ kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45420'] }, { kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45425'] }])
  check('E5 transitions show the deposit / balance rules too', [orderFailureKind({ code: '45419' }, 400), orderFailureKind({ code: '45420' }, 400), orderFailureKind({ code: '45421' }, 400)],
    [{ kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45419'] }, { kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45420'] }, { kind: 'validation', message: PAYMENT_ERROR_MESSAGES['45421'] }])

  // ── V: متى يظهر إيه ──
  const s = (patch: Partial<PaymentSummary>): PaymentSummary => ({ ...summary, ...patch })
  check('V1 record', [canRecordPayment(summary), canRecordPayment(s({ status: 'cancelled' })), canRecordPayment(s({ remainingPiastres: 0 })), canRecordPayment(s({ status: 'delivered' }))], [true, false, false, true])
  check('V2 refund / deliver', [canRefund(summary), canRefund(s({ paidPiastres: 0 })), canDeliver(summary), canDeliver(s({ status: 'confirmed' }))], [true, false, true, false])
  check('V3 suggestions', [suggestedPurpose(summary), suggestedPurpose(s({ feeDuePiastres: 3000 })), suggestedAmount(s({ feeDuePiastres: 3000 }), 'confirmation_fee'), suggestedAmount(summary, 'balance')], ['balance', 'confirmation_fee', 3000, 35000])
  check('V4 needs refund', [needsRefund(s({ status: 'cancelled' })), needsRefund(s({ status: 'cancelled', paidPiastres: 0 })), needsRefund(summary)], [true, false, false])

  // ── W: واتساب ──
  check('W1 template', renderTemplate('أهلًا {name}، طلب {order_number}: الإجمالي {total}، المقدم {fee}، الباقي {remaining}. {payment_numbers} {policy} {unknown}',
    { name: 'أحمد', orderNumber: 'FLM-ABC123', total: '400 ج.م', fee: '50 ج.م', remaining: '350 ج.م', paymentNumbers: '010', policy: 'سياسة' }),
    'أهلًا أحمد، طلب FLM-ABC123: الإجمالي 400 ج.م، المقدم 50 ج.م، الباقي 350 ج.م. 010 سياسة {unknown}')
  check('W2 link', [whatsappHref('01012345678', 'سلام'), whatsappHref('01012345678', '  ')], ['https://wa.me/201012345678?text=' + encodeURIComponent('سلام'), 'https://wa.me/201012345678'])

  // ── T: النصوص من غير أي كود داخلي ──
  const texts = [
    ...Object.values(PAYMENT_STATUS_LABELS), ...Object.values(PURPOSE_LABELS), ...Object.values(KIND_LABELS),
    ...Object.values(FEE_SCOPE_LABELS), ...Object.values(FEE_METHOD_LABELS), ...Object.values(PAYMENT_TEXT),
    ...Object.values(PAYMENT_ERROR_MESSAGES), ...Object.values(PAYMENT_FIELD_MESSAGES),
  ]
  check('T1 no internal codes in visible text', texts.filter((t) => LATIN.test(t)), [])

  return { passed, failures }
}
