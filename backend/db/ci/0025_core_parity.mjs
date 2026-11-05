#!/usr/bin/env node
// INSTALLER-SHIPPING C — مقارنة حساب المتجر (packages/core) بالداتابيز بعد 0025 (zell_create_order)، بصفر اختلاف مطلوب.
// بيطبع ملف SQL كامل في معاملة بترجع: البيانات (زي 0025_flows.sql، جوه المعاملة) + لكل حالة الناتج المتوقع من core ونداء حقيقي
// في subtransaction بيترجع. أول سطر: «-- cases: N …»، والسطر الأخير من الناتج: العدد|المختلف|أول اختلاف.
// الحساب المتوقع من core: standardShippingPiastres · expressOffer · installationFeePiastres · installationTravelPiastres ·
// couponDiscountPiastres · confirmationFeePiastres · chargedShippingPiastres (الجديدة). سطر المتر = round(السعر × الطول ÷ 100)
// (= computeSubtotalPiastres؛ pricing.ts مابيتستوردش هنا لأنه بيستورد ملفات تانية من غير امتداد، ومقارنة التسعير اتعملت في 0019/P1).
// المقارن: الشحن · الإجمالي · الخصم · أجر التركيب · الانتقال · المقدّم · لقطة طريقة الشحن (والرفض بالكود).
// التشغيل: node --experimental-strip-types backend/db/ci/0025_core_parity.mjs > parity.sql
import { expressOffer, parseShippingOptions, standardShippingPiastres } from '../../../packages/core/src/shippingOptions.ts'
import { installationFeePiastres, installationTravelPiastres, parseInstallationConfig } from '../../../packages/core/src/installation.ts'
import { couponDiscountPiastres } from '../../../packages/core/src/coupons.ts'
import { confirmationFeePiastres } from '../../../packages/core/src/confirmationFee.ts'
import { chargedShippingPiastres } from '../../../packages/core/src/installerShipping.ts'

const METER = 30000
const PIECE = 15000
const FREE = 500000
const RATES = { 'القاهرة': 5000, 'الجيزة': 6000, 'أسوان': 9000 }
const INSTALL_RAW = { enabled: true, feePerMeterPiastres: 1500, areas: { 'القاهرة': { 'المعادي': 2500, 'مدينة نصر': 0 } } }
const SHIP_RAW = {
  express_enabled: true,
  governorates: {
    'القاهرة': { standard_days_min: 2, standard_days_max: 4, express_enabled: true, express_price_piastres: 11000, express_days_min: 1, express_days_max: 1 },
    'الجيزة': { standard_days_min: 3, standard_days_max: 5, express_enabled: false },
  },
}
const INSTALL = parseInstallationConfig(INSTALL_RAW)
const OPTIONS = parseShippingOptions(SHIP_RAW)
const COUPONS = [
  null,
  { code: 'ISPC10', kind: 'percent', percentOff: 10, amountOffPiastres: null, maxDiscountPiastres: 5000, minSubtotalPiastres: 0 },
  { code: 'ISFX20', kind: 'fixed', percentOff: null, amountOffPiastres: 2000, maxDiscountPiastres: null, minSubtotalPiastres: 100000 },
]
const CFGS = [
  { enabled: false },
  { enabled: true, scope: 'all', method: 'fixed', fixed_piastres: 5000 },
  { enabled: true, scope: 'made_to_measure', method: 'percent', percent_bp: 1000 },
  { enabled: true, scope: 'with_installation', method: 'shipping', shipping_fallback_piastres: 3000 },
  { enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 250000, threshold_piastres: 100000 },
  { enabled: true, scope: 'all', method: 'shipping', shipping_fallback_piastres: 4000 },
  { enabled: true, scope: 'all', method: 'percent', percent_bp: 3333 },
  { enabled: true, scope: 'with_installation', method: 'percent', percent_bp: 500 },
  { enabled: true, scope: 'made_to_measure', method: 'shipping', shipping_fallback_piastres: 80000 },
]
const CARTS = [
  [['m', 100]], [['m', 150]], [['m', 300]], [['m', 350]], [['m', 1000]], [['m', 1600]], [['m', 1650]], [['m', 2000]], [['m', 2500]],
  [['m', 300], ['p', 1]], [['m', 1600], ['p', 1]], [['p', 2]],
]
const COMBOS = [['القاهرة', null, false], ['القاهرة', 'المعادي', false], ['الجيزة', null, false], ['القاهرة', 'المعادي', true], ['القاهرة', 'مدينة نصر', true]]
const METHODS = [null, 'express']

function lit(text) {
  return "'" + String(text).replace(/'/g, "''") + "'"
}

// المتوقع من core، أو null لو الحالة غامضة (أكتر من سبب رفض) أو core مابيعرضش الفني أصلًا (سلة قطع بس).
function expected(cart, combo, coupon, method, cfg) {
  const [gov, area, inst] = combo
  let subtotal = 0
  let cm = 0
  for (const [kind, value] of cart) {
    if (kind === 'm') { subtotal += Math.round((METER * value) / 100); cm += value } else subtotal += PIECE * value
  }
  const madeToMeasure = cm > 0
  if (inst && !madeToMeasure) return null
  const errors = []
  let discount = 0
  if (coupon !== null) {
    const r = couponDiscountPiastres(coupon, subtotal)
    if (r.status === 'ok') discount = r.discountPiastres
    else if (r.status === 'below_minimum') errors.push('45073')
    else return null
  }
  let ship = 0
  let snap = 'standard'
  if (method === 'express' && !inst) {
    const offer = expressOffer(OPTIONS, gov)
    if (offer === null) errors.push('45431')
    else { ship = offer.pricePiastres; snap = 'express' }
  } else {
    ship = standardShippingPiastres(gov, subtotal, RATES, 0, FREE)
  }
  if (errors.length > 1) return null
  if (errors.length === 1) return { text: 'ERR ' + errors[0], inst, shipBefore: null }
  const travel = inst ? installationTravelPiastres(INSTALL, gov, area) : 0
  if (travel === null) return null
  const fee = inst ? installationFeePiastres(INSTALL.feePerMeterPiastres, cm) : 0
  const charged = chargedShippingPiastres(inst, ship)
  const total = subtotal - discount + charged + fee + travel
  const deposit = confirmationFeePiastres(cfg, { totalPiastres: total, shippingPiastres: charged, madeToMeasure, installation: inst })
  return { text: ['OK', charged, total, discount, fee, travel, deposit, inst ? '-' : snap].join('|'), inst, shipBefore: ship }
}

const calls = []
let n = 0
let installerOk = 0
let shippingDropped = 0
let expressIgnored = 0
let rejected = 0
for (const cart of CARTS) {
  for (const combo of COMBOS) {
    for (const coupon of COUPONS) {
      for (const method of METHODS) {
        for (const cfg of CFGS) {
          const e = expected(cart, combo, coupon, method, cfg)
          if (e === null) continue
          n += 1
          if (e.text.startsWith('ERR')) rejected += 1
          if (e.inst && e.text.startsWith('OK')) {
            installerOk += 1
            if (e.shipBefore > 0) shippingDropped += 1
            if (method === 'express') expressIgnored += 1
          }
          const lines = cart.map(([kind, value]) => kind + ':' + value).join(',')
          calls.push('  perform pg_temp.cp(' + n + ', ' + lit(lines) + ', ' + lit(combo[0]) + ', ' + (combo[1] === null ? 'null' : lit(combo[1])) + ', ' +
            String(combo[2]) + ', ' + (coupon === null ? 'null' : lit(coupon.code)) + ', ' + (method === null ? 'null' : lit(method)) + ', ' +
            lit(JSON.stringify(cfg)) + '::jsonb, ' + lit(e.text) + ');')
        }
      }
    }
  }
}

const sql = [
  '-- cases: ' + n + ' installer_ok: ' + installerOk + ' shipping_dropped: ' + shippingDropped + ' express_ignored: ' + expressIgnored + ' rejected: ' + rejected,
  'begin;',
  "set local statement_timeout = '900s';",
  'create temporary table ci_fx (k text primary key, v text) on commit drop;',
  'create temporary table ci_cp (n integer, expected text, actual text) on commit drop;',
  'do $fx$',
  'declare',
  '  v_p1 public.products.id%type;',
  '  v_p3 public.products.id%type;',
  'begin',
  "  insert into public.products (name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity)",
  "  values ('ci-0025 فيلم', " + METER + ", 50, 100, 50, 3000, true, 'meter', 1) returning id into v_p1;",
  "  insert into public.products (name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity)",
  "  values ('ci-0025 أداة', " + PIECE + ", 50, 100, 50, 3000, true, 'piece', 10) returning id into v_p3;",
  "  insert into pg_temp.ci_fx (k, v) values ('p1', v_p1::text), ('p3', v_p3::text);",
  '  insert into public.settings (key, value) values',
  "    ('shipping_rates', " + lit(JSON.stringify(RATES)) + '),',
  "    ('free_shipping_threshold_piastres', '" + FREE + "'),",
  "    ('shipping_disabled_governorates', '[\"أسوان\"]'),",
  "    ('shipping_areas', '{\"القاهرة\": [\"المعادي\", \"مدينة نصر\"]}'),",
  "    ('installation', " + lit(JSON.stringify(INSTALL_RAW)) + '),',
  "    ('coupons_enabled', 'true')",
  '  on conflict (key) do update set value = excluded.value;',
  '  insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres, starts_at, ends_at, max_uses, max_uses_per_phone)',
  "  values ('ISPC10', 'percent', 10, null, 5000, 0, pg_catalog.now() - interval '2 days', null, null, 1),",
  "         ('ISFX20', 'fixed', null, 2000, null, 100000, pg_catalog.now() - interval '2 days', null, null, 1);",
  '  update public.zell_shipping_options set express_enabled = true, governorates = ' + lit(JSON.stringify(SHIP_RAW.governorates)) + '::jsonb where id;',
  'end',
  '$fx$;',
  'create function pg_temp.cp(p_n integer, p_lines text, p_gov text, p_area text, p_inst boolean, p_coupon text, p_method text, p_cfg jsonb, p_expected text)',
  'returns void language plpgsql as $f$',
  'declare',
  "  v_p1 bigint := (select f.v from pg_temp.ci_fx f where f.k = 'p1')::bigint;",
  "  v_p3 bigint := (select f.v from pg_temp.ci_fx f where f.k = 'p3')::bigint;",
  "  v_items jsonb := '[]'::jsonb;",
  '  v_tok text;',
  '  v_res jsonb;',
  '  v_out text;',
  'begin',
  "  foreach v_tok in array pg_catalog.string_to_array(p_lines, ',') loop",
  "    if pg_catalog.split_part(v_tok, ':', 1) = 'm' then",
  "      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('productId', v_p1, 'lengthCm', pg_catalog.split_part(v_tok, ':', 2)::integer));",
  '    else',
  "      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('productId', v_p3, 'quantity', pg_catalog.split_part(v_tok, ':', 2)::integer));",
  '    end if;',
  '  end loop;',
  '  update public.zell_payment_settings set confirmation_fee = p_cfg where id;',
  '  begin',
  "    v_res := public.zell_create_order(p_items => v_items, p_customer_name => 'عميل المقارنة', p_customer_phone => '012' || pg_catalog.lpad(p_n::text, 8, '0'),",
  "             p_governorate => p_gov, p_address => 'عنوان المقارنة طويل كفاية', p_notes => null,",
  "             p_idempotency_key => 'ci-0025-cp-' || pg_catalog.lpad(p_n::text, 6, '0'), p_request_hash => pg_catalog.repeat('a', 64),",
  "             p_checkout_session_hash => pg_catalog.repeat('b', 64), p_receipt_token_hash => pg_catalog.repeat('c', 64),",
  '             p_area => p_area, p_installation => p_inst, p_coupon_code => p_coupon, p_shipping_method => p_method);',
  "    select 'OK|' || o.shipping_piastres || '|' || o.total_piastres || '|' || coalesce(o.discount_piastres, 0) || '|' || coalesce(o.installation_piastres, 0)",
  "           || '|' || coalesce(o.installation_travel_piastres, 0) || '|' || coalesce(o.confirmation_fee_piastres, 0) || '|' || coalesce(o.shipping_method, '-')",
  "      into v_out from public.orders o where o.order_number = v_res ->> 'order_number';",
  "    raise exception using errcode = 'ZZ999';",
  '  exception',
  "    when sqlstate 'ZZ999' then null;",
  "    when others then v_out := 'ERR ' || sqlstate;",
  '  end;',
  '  insert into pg_temp.ci_cp values (p_n, p_expected, v_out);',
  'end',
  '$f$;',
  'do $cases$',
  'begin',
  ...calls,
  'end',
  '$cases$;',
  "select pg_catalog.count(*) || '|' || pg_catalog.count(*) filter (where c.expected is distinct from c.actual) || '|'",
  "       || coalesce((select x.n || ':' || x.expected || ' != ' || coalesce(x.actual, 'null') from pg_temp.ci_cp x where x.expected is distinct from x.actual order by x.n limit 1), '')",
  '  from pg_temp.ci_cp c;',
  'rollback;',
].join('\n')
process.stdout.write(sql + '\n')
