/**
 * EXPRESS-SHIPPING W2 — حالات كارت «مدة الشحن والشحن السريع» (منطق خالص — pnpm --filter @zell/admin cases، suite shipping-options).
 */

import {
  EXPRESS_PRICE_MAX_PIASTRES,
  SHIPPING_FIELD_MESSAGES,
  SHIPPING_OPTIONS_TEXT,
  formOf,
  governoratesOf,
  inputOf,
  parseShippingOptionsSettings,
  payloadIssue,
  piastresText,
  shippingOptionsFailureKind,
  type ShippingOptionsForm,
  type ShippingOptionsSettings,
} from './shippingOptions'

export type ShippingOptionsCaseFailure = { name: string; expected: string; actual: string }

const failures: ShippingOptionsCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const AT = '2026-10-14T13:10:20.419507+00:00'
const FRESH: ShippingOptionsSettings = { expressEnabled: false, governorates: {}, updatedAt: AT }
const CAIRO = {
  standard_days_min: 3,
  standard_days_max: 5,
  express_enabled: true,
  express_price_piastres: 12050,
  express_days_min: 1,
  express_days_max: 2,
}
const SAVED_RAW = { express_enabled: true, governorates: { القاهرة: CAIRO, أسوان: { ...CAIRO, express_enabled: false, express_price_piastres: null, express_days_min: null, express_days_max: null } }, updated_at: AT }

function row(name: string, patch: Partial<ShippingOptionsForm['rows'][number]> = {}): ShippingOptionsForm['rows'][number] {
  return { name, served: true, standardMin: '', standardMax: '', expressEnabled: false, expressPrice: '', expressMin: '', expressMax: '', ...patch }
}

function form(rows: ShippingOptionsForm['rows'], expressEnabled = true): ShippingOptionsForm {
  return { expressEnabled, rows }
}

function message(result: ReturnType<typeof governoratesOf>): string | null {
  return result.ok ? null : result.message
}

export function runShippingOptionsCases(): { passed: number; failures: ShippingOptionsCaseFailure[] } {
  // parse
  check('S01 parse the apply values (express off, {})', parseShippingOptionsSettings({ express_enabled: false, governorates: {}, updated_at: AT }), FRESH)
  const saved = parseShippingOptionsSettings({ ...SAVED_RAW, changed: true })
  check('S02 parse a saved reply (6 keys per governorate, extra key ignored)', saved?.governorates['القاهرة'], {
    standardDaysMin: 3, standardDaysMax: 5, expressEnabled: true, expressPricePiastres: 12050, expressDaysMin: 1, expressDaysMax: 2,
  })
  check('S03 bad shapes = null («غير متاح»)', [
    parseShippingOptionsSettings(null),
    parseShippingOptionsSettings({ express_enabled: 'true', governorates: {}, updated_at: AT }),
    parseShippingOptionsSettings({ express_enabled: true, governorates: [], updated_at: AT }),
    parseShippingOptionsSettings({ express_enabled: true, governorates: {}, updated_at: '' }),
  ], [null, null, null, null])

  // الفورم: المحافظات المتاحة بترتيب الشحن العادي، وبعدها المحفوظة ومش متاحة (بعلامة)
  const opened = formOf(saved as ShippingOptionsSettings, ['الجيزة', 'القاهرة'])
  check('S04 rows = served in shipping order, then saved but not served', opened.rows.map((r) => r.name + ':' + String(r.served)), ['الجيزة:true', 'القاهرة:true', 'أسوان:false'])
  check('S05 saved values shown (price in pounds), empty governorate blank', [opened.rows[1]?.expressPrice, opened.rows[1]?.standardMin, opened.rows[0]?.expressPrice, opened.rows[0]?.expressEnabled], ['120.50', '3', '', false])
  check('S06 pounds text', [piastresText(12000), piastresText(12050), piastresText(1), piastresText(null)], ['120', '120.50', '0.01', ''])

  // البناء والتحقق (نفس قواعد الداتابيز)
  const ok = governoratesOf(form([row('القاهرة', { standardMin: '3', standardMax: '5', expressEnabled: true, expressPrice: '120', expressMin: '1', expressMax: '2' }), row('الجيزة')]))
  check('S07 valid row -> 6 keys, blank row omitted', ok.ok ? ok.governorates : null, {
    القاهرة: { standard_days_min: 3, standard_days_max: 5, express_enabled: true, express_price_piastres: 12000, express_days_min: 1, express_days_max: 2 },
  })
  check('S08 express off keeps a draft price / days', governoratesOf(form([row('القاهرة', { expressPrice: '99.99', expressMin: '0', expressMax: '60' })])).ok, true)
  const cairoMsg = (field: string) => 'محافظة «القاهرة»: ' + (SHIPPING_FIELD_MESSAGES[field] as string)
  check('S09 standard days: one side · min > max · > 60 · fraction -> standard_days', [
    message(governoratesOf(form([row('القاهرة', { standardMin: '3' })]))),
    message(governoratesOf(form([row('القاهرة', { standardMin: '6', standardMax: '5' })]))),
    message(governoratesOf(form([row('القاهرة', { standardMin: '1', standardMax: '61' })]))),
    message(governoratesOf(form([row('القاهرة', { standardMin: '1.5', standardMax: '2' })]))),
  ], [cairoMsg('standard_days'), cairoMsg('standard_days'), cairoMsg('standard_days'), cairoMsg('standard_days')])
  check('S10 express on needs price and days; price bounds (0 · > 1,000,000 ج.م · 3 decimals)', [
    message(governoratesOf(form([row('القاهرة', { expressEnabled: true, expressMin: '1', expressMax: '2' })]))),
    message(governoratesOf(form([row('القاهرة', { expressEnabled: true, expressPrice: '120' })]))),
    message(governoratesOf(form([row('القاهرة', { expressPrice: '0' })]))),
    message(governoratesOf(form([row('القاهرة', { expressPrice: '1000000.01' })]))),
    message(governoratesOf(form([row('القاهرة', { expressPrice: '1.005' })]))),
  ], [cairoMsg('express_price'), cairoMsg('express_days'), cairoMsg('express_price'), cairoMsg('express_price'), cairoMsg('express_price')])
  check('S11 max price accepted = 100,000,000 piastres', governoratesOf(form([row('القاهرة', { expressPrice: '1000000' })])).ok ? EXPRESS_PRICE_MAX_PIASTRES : null, 100000000)
  check('S12 duplicate name after NFC + trim -> governorate_name', message(governoratesOf(form([row('القاهرة', { standardMin: '1', standardMax: '2' }), row(' القاهرة ', { standardMin: '1', standardMax: '2' })]))), SHIPPING_FIELD_MESSAGES['governorate_name'])
  const input = inputOf(form([row('القاهرة', { standardMin: '3', standardMax: '5' })], false), FRESH)
  check('S13 input carries the version and the global switch', input.ok ? [input.input.expectedUpdatedAt, input.input.expressEnabled, Object.keys(input.input.governorates)] : null, [AT, false, ['القاهرة']])

  // فحص السيرفر قبل النداء
  check('S14 server check: valid payload = null', payloadIssue({ expressEnabled: true, governorates: { القاهرة: CAIRO } }), null)
  check('S15 server check: bad switch · not an object · unknown key · untrimmed name · express on without price', [
    payloadIssue({ expressEnabled: 'yes', governorates: {} }),
    payloadIssue({ expressEnabled: true, governorates: [] }),
    payloadIssue({ expressEnabled: true, governorates: { القاهرة: { ...CAIRO, price: 1 } } }),
    payloadIssue({ expressEnabled: true, governorates: { ' القاهرة': CAIRO } }),
    payloadIssue({ expressEnabled: true, governorates: { القاهرة: { ...CAIRO, express_price_piastres: null } } }),
  ], [
    SHIPPING_FIELD_MESSAGES['express_enabled'],
    SHIPPING_FIELD_MESSAGES['governorates'],
    cairoMsg('governorate_shape'),
    SHIPPING_FIELD_MESSAGES['governorate_name'],
    cairoMsg('express_price'),
  ])

  // أخطاء الداتابيز
  check('S16 45432 with detail + hint -> the field message for that governorate', shippingOptionsFailureKind({ code: '45432', details: 'express_days', hint: 'القاهرة', message: 'ZELL_SHIPPING_OPTIONS_INVALID' }, 400), { kind: 'validation', message: cairoMsg('express_days') })
  check('S17 45432 without hint -> the field message', shippingOptionsFailureKind({ code: '45432', details: 'governorates', message: 'x' }, 400), { kind: 'validation', message: SHIPPING_FIELD_MESSAGES['governorates'] })
  check('S18 45404 conflict · 45402 owner only · 45400 no session', [
    shippingOptionsFailureKind({ code: '45404', message: 'ZELL_ORD_CONFLICT' }, 409).kind,
    shippingOptionsFailureKind({ code: '45402', message: 'x' }, 403).kind,
    shippingOptionsFailureKind({ code: '45400', message: 'x' }, 401).kind,
  ], ['conflict', 'validation', 'unauthenticated'])
  check('S19 formal texts present', [SHIPPING_OPTIONS_TEXT.title, SHIPPING_OPTIONS_TEXT.globalToggle], ['مدة الشحن والشحن السريع', 'تفعيل الشحن السريع'])
  return { passed, failures }
}
