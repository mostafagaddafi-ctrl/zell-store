#!/usr/bin/env node
// EXPRESS-SHIPPING W2 — مقارنة شحن العرض في المتجر (packages/core/src/shippingOptions.ts) بالداتابيز (zell_create_order).
// بيطبع ملف SQL كامل في معاملة بترجع: لكل حالة (إعداد × محافظة × طول × طريقة) الناتج المتوقع من core ('OK شحن/من/لـ' أو
// 'ERR 45431')، ونداء حقيقي لـ zell_create_order في subtransaction بيترجع، والسطر الأخير: العدد|المختلف|أول اختلاف.
// إعداد الشحن العادي = إعداد shim الـ CI (0021p1_sql_ci.sh): القاهرة 5000 · الجيزة 6000 · الحد المجاني 500000.
// المنتج 1 = 30000 قرش للمتر، فالطول L سم = 300 × L قرش.
// التشغيل: node --experimental-strip-types backend/db/ci/0021ex_core_parity.mjs > parity.sql
import { expressOffer, parseShippingOptions, standardShippingDays, standardShippingPiastres } from '../../../packages/core/src/shippingOptions.ts'

const RATES = { 'القاهرة': 5000, 'الجيزة': 6000 }
const FREE = 500000
const GOVS = ['القاهرة', 'الجيزة']
const LENGTHS = [300, 1700, 2000]
const METHODS = [null, 'express']

const VALID = { standard_days_min: 3, standard_days_max: 5, express_enabled: true, express_price_piastres: 12000, express_days_min: 1, express_days_max: 2 }
const GIZA_OFF = { standard_days_min: null, standard_days_max: null, express_enabled: false, express_price_piastres: 9000, express_days_min: null, express_days_max: null }
const cairo = (cfg, enabled = true) => ({ express_enabled: enabled, governorates: { 'القاهرة': cfg, 'الجيزة': GIZA_OFF } })

const SETTINGS = [
  { express_enabled: false, governorates: {} },
  cairo(VALID),
  cairo(VALID, false),
  cairo({ ...VALID, express_price_piastres: '12000' }),
  cairo({ ...VALID, express_price_piastres: 0 }),
  cairo({ ...VALID, express_price_piastres: 1.5 }),
  cairo({ ...VALID, express_price_piastres: 100000001 }),
  cairo({ ...VALID, express_price_piastres: 100000000, express_days_min: 60, express_days_max: 60 }),
  cairo({ ...VALID, express_price_piastres: 1, express_days_min: 0, express_days_max: 0 }),
  cairo({ ...VALID, express_days_max: 70 }),
  cairo({ ...VALID, express_days_min: 3, express_days_max: 2 }),
  cairo({ standard_days_min: 3, standard_days_max: 5, express_enabled: true, express_price_piastres: 12000 }),
  cairo({ ...VALID, express_enabled: 'true' }),
  { express_enabled: true, governorates: { 'القاهرة': 5, 'الجيزة': GIZA_OFF } },
  cairo({ ...VALID, standard_days_min: 9, standard_days_max: 3 }),
  { express_enabled: true, governorates: { 'القاهرة': VALID, 'الجيزة': { standard_days_min: 'x', standard_days_max: 2, express_enabled: true, express_price_piastres: 9000, express_days_min: 1, express_days_max: 70 } } },
  { express_enabled: true, governorates: { 'القاهرة': VALID, 'الجيزة': { standard_days_min: 0, standard_days_max: 60, express_enabled: true, express_price_piastres: 99999999, express_days_min: 2, express_days_max: 4 } } },
  cairo({ ...VALID, standard_days_min: 3, standard_days_max: null }),
  { express_enabled: true, governorates: { ' القاهرة': VALID, 'الجيزة': GIZA_OFF } },
  cairo({ ...VALID, express_price_piastres: 450000, express_days_min: 0, express_days_max: 1 }),
]

function lit(text) {
  return "'" + String(text).replace(/'/g, "''") + "'"
}

function expected(settings, gov, length, method) {
  const options = parseShippingOptions(settings)
  const subtotal = 300 * length
  if (method === 'express') {
    const offer = expressOffer(options, gov)
    return offer === null ? 'ERR 45431' : 'OK ' + offer.pricePiastres + '/' + offer.days.min + '/' + offer.days.max
  }
  const days = standardShippingDays(options, gov)
  const shipping = standardShippingPiastres(gov, subtotal, RATES, 0, FREE)
  return 'OK ' + shipping + '/' + (days === null ? '-' : days.min) + '/' + (days === null ? '-' : days.max)
}

const calls = []
let n = 0
for (const settings of SETTINGS) {
  for (const gov of GOVS) {
    for (const length of LENGTHS) {
      for (const method of METHODS) {
        n += 1
        calls.push(
          '  perform pg_temp.ship_case(' + n + ', ' + lit(JSON.stringify(settings)) + '::jsonb, ' + lit(gov) + ', ' + length + ', ' +
            (method === null ? 'null' : lit(method)) + ', ' + lit(expected(settings, gov, length, method)) + ');',
        )
      }
    }
  }
}

const sql = [
  'begin;',
  "set local statement_timeout = '120s';",
  'create temporary table ci_ship (n integer, expected text, actual text) on commit drop;',
  'create function pg_temp.ship_case(p_n integer, p_opts jsonb, p_gov text, p_len integer, p_method text, p_expected text)',
  'returns void language plpgsql as $f$',
  'declare',
  '  r jsonb;',
  '  v text;',
  '  v_items jsonb := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(' + lit('productId') + ', 1, ' + lit('lengthCm') + ', p_len));',
  'begin',
  "  update public.zell_shipping_options set express_enabled = (p_opts ->> 'express_enabled')::boolean, governorates = p_opts -> 'governorates' where id;",
  '  begin',
  '    if p_method is null then',
  "      r := public.zell_create_order(p_items => v_items, p_customer_name => 'عميل المقارنة', p_customer_phone => '01055555555',",
  "             p_governorate => p_gov, p_address => 'عنوان المقارنة طويل كفاية', p_notes => null, p_idempotency_key => 'ci-ship-parity-' || p_n,",
  "             p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64));",
  '    else',
  "      r := public.zell_create_order(p_items => v_items, p_customer_name => 'عميل المقارنة', p_customer_phone => '01055555555',",
  "             p_governorate => p_gov, p_address => 'عنوان المقارنة طويل كفاية', p_notes => null, p_idempotency_key => 'ci-ship-parity-' || p_n,",
  "             p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64),",
  '             p_shipping_method => p_method);',
  '    end if;',
  "    select 'OK ' || o.shipping_piastres || '/' || coalesce(o.shipping_days_min::text, '-') || '/' || coalesce(o.shipping_days_max::text, '-')",
  "      into v from public.orders o where o.order_number = r ->> 'order_number';",
  "    raise exception using errcode = 'ZZ999';",
  '  exception',
  "    when sqlstate 'ZZ999' then null;",
  "    when others then v := 'ERR ' || sqlstate;",
  '  end;',
  '  insert into ci_ship values (p_n, p_expected, v);',
  'end',
  '$f$;',
  'do $cases$',
  'begin',
  ...calls,
  'end',
  '$cases$;',
  "select count(*) || '|' || count(*) filter (where expected is distinct from actual) || '|'",
  "       || coalesce((select n || ':' || expected || ' != ' || coalesce(actual, 'null') from ci_ship where expected is distinct from actual order by n limit 1), '')",
  '  from ci_ship;',
  'rollback;',
]
process.stdout.write(sql.join('\n') + '\n')
