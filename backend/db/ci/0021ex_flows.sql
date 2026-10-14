-- EXPRESS-SHIPPING W1 — سيناريوهات الإعداد والطلب بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0021ex_sql_ci.sh بعد تطبيق 0021ex_express_shipping.sql فوق شكل Production
--   (A1 · D · P1 · P2 · D2 · TR) وإعدادات الـ shim (القاهرة 5000 · الجيزة 6000 · أسوان 9000 موقوفة · الحد المجاني 500000 ·
--   مناطق القاهرة: المعادي ومدينة نصر · الفني 1500 للمتر والانتقال للمعادي 2500 · كوبون PCT10).
-- • الهويات من shim الـ CI: مالك ...0a · أدمن شغّال ...0b · أدمن موقوف ...0c.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 38 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local statement_timeout = '120s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

-- النداء بدور وجلسة (sub بدور authenticated، أو من غير جلسة لو NULL). النتيجة نص، أو 'ERR <sqlstate> <detail>|<hint>'.
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
  v_detail text;
  v_hint text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims',
      case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    execute 'set local role ' || pg_catalog.quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    return 'ERR ' || v_state || ' ' || coalesce(v_detail, '') || '|' || coalesce(v_hint, '');
  end;
  return coalesce(r, 'null');
end
$f$;

create function pg_temp.ver() returns timestamptz language sql as $f$
  select o.updated_at from public.zell_shipping_options o where o.id;
$f$;

-- حفظ المالك (أو أي sub) بنسخة صريحة.
create function pg_temp.save_as(p_sub text, p_ts timestamptz, p_on boolean, p_govs jsonb)
returns text language sql as $f$
  select pg_temp.call_as('authenticated', p_sub,
    pg_catalog.format('select public.zell_shipping_options_save(%L::timestamptz, %L::boolean, %L::jsonb)::text', p_ts, p_on, p_govs));
$f$;

create function pg_temp.js(p text) returns jsonb language sql as $f$
  select case when p is null or p like 'ERR%' or p = 'null' then null else p::jsonb end;
$f$;

-- zell_create_order بالأسماء (زي /api/orders) كـ postgres. الطلب الناجح بيفضل لحد آخر المعاملة. الرفض: 'ERR <sqlstate> <detail>'.
create function pg_temp.co(p_key text, p_phone text, p_over jsonb, p_method text)
returns text language plpgsql as $f$
declare
  v jsonb := pg_catalog.jsonb_build_object(
    'p_items', '[{"productId":1,"lengthCm":300}]',
    'p_customer_name', 'عميل السيناريو',
    'p_customer_phone', p_phone,
    'p_governorate', 'القاهرة',
    'p_address', 'عنوان السيناريو طويل كفاية',
    'p_notes', null,
    'p_idempotency_key', 'flow-0021ex-' || p_key || '-0000000',
    'p_request_hash', repeat('a', 64),
    'p_checkout_session_hash', repeat('b', 64),
    'p_receipt_token_hash', repeat('c', 64)) || coalesce(p_over, '{}'::jsonb);
  k text;
  s text := '';
  r jsonb;
  v_state text;
  v_detail text;
begin
  for k in select x from pg_catalog.jsonb_object_keys(v) x order by x loop
    s := s || case when s = '' then '' else ', ' end || k || ' => '
         || case when v ->> k is null then 'null'
                 when k in ('p_items', 'p_preferred_delivery') then pg_catalog.quote_literal(v ->> k) || '::jsonb'
                 when k = 'p_installation' then pg_catalog.quote_literal(v ->> k) || '::boolean'
                 else pg_catalog.quote_literal(v ->> k) || '::text' end;
  end loop;
  if p_method is not null then
    s := s || ', p_shipping_method => ' || pg_catalog.quote_literal(p_method) || '::text';
  end if;
  begin
    execute 'select public.zell_create_order(' || s || ')' into r;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    return 'ERR ' || v_state || ' ' || coalesce(v_detail, '');
  end;
  return r::text;
end
$f$;

-- لقطة الطلب: طريقة/من/لـ/الشحن/الإجمالي
create function pg_temp.snap(p_res text) returns text language sql as $f$
  select coalesce((select coalesce(o.shipping_method, '-') || '/' || coalesce(o.shipping_days_min::text, '-') || '/'
                          || coalesce(o.shipping_days_max::text, '-') || '/' || o.shipping_piastres || '/' || o.total_piastres
                     from public.orders o where o.order_number = pg_temp.js(p_res) ->> 'order_number'), 'none');
$f$;

create function pg_temp.keys(p_res text) returns text language sql as $f$
  select coalesce((select pg_catalog.string_agg(k, ',' order by k collate "C") from pg_catalog.jsonb_object_keys(pg_temp.js(p_res)) k), '');
$f$;

-- A) القيم بعد التطبيق · الصلاحيات · الهوية
do $zA$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_admin text := '00000000-0000-0000-0000-00000000000b';
  v_off text := '00000000-0000-0000-0000-00000000000c';
  v_get text := 'select public.zell_shipping_options_get()::text';
  v_chk text := 'select public.zell_shipping_options_checkout()::text';
  v_save text;
  v_ts timestamptz := pg_temp.ver();
  v_r text;
begin
  v_save := pg_catalog.format('select public.zell_shipping_options_save(%L::timestamptz, false, %L::jsonb)::text', v_ts, '{}');
  v_r := pg_temp.call_as('service_role', null, v_chk);
  perform pg_temp.zt('F01 checkout read after apply = express off, no governorates',
    pg_temp.js(v_r) = '{"express_enabled": false, "governorates": {}}'::jsonb, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, v_get);
  perform pg_temp.zt('F02 owner get: express off, {}, updated_at = the row',
    pg_temp.js(v_r) -> 'express_enabled' = 'false'::jsonb and pg_temp.js(v_r) -> 'governorates' = '{}'::jsonb
    and (pg_temp.js(v_r) ->> 'updated_at')::timestamptz = v_ts, v_r);
  v_r := pg_temp.call_as('authenticated', v_admin, v_get);
  perform pg_temp.zt('F03 active admin can read the setting', pg_temp.js(v_r) ? 'express_enabled', v_r);
  perform pg_temp.zt('F04 get: no session -> 45400 · inactive admin -> 45401',
    pg_temp.call_as('authenticated', null, v_get) like 'ERR 45400%'
    and pg_temp.call_as('authenticated', v_off, v_get) like 'ERR 45401%', null);
  v_r := pg_temp.call_as('authenticated', v_admin, v_save);
  perform pg_temp.zt('F05 admin save -> 45402 (owner only)', v_r like 'ERR 45402%', v_r);
  perform pg_temp.zt('F06 EXECUTE: anon nothing · service_role checkout only · authenticated not checkout',
    pg_temp.call_as('anon', null, v_get) like 'ERR 42501%'
    and pg_temp.call_as('anon', null, v_save) like 'ERR 42501%'
    and pg_temp.call_as('anon', null, v_chk) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, v_get) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, v_save) like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, v_chk) like 'ERR 42501%', null);
  perform pg_temp.zt('F07 no direct table access for anon / authenticated / service_role',
    pg_temp.call_as('anon', null, 'select count(*)::text from public.zell_shipping_options') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, 'select count(*)::text from public.zell_shipping_options') like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, 'select count(*)::text from public.zell_shipping_options') like 'ERR 42501%'
    and pg_temp.call_as('anon', null, 'select count(*)::text from public.zell_shipping_options_log') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, 'select count(*)::text from public.zell_shipping_options_log') like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, 'select count(*)::text from public.zell_shipping_options_log') like 'ERR 42501%', null);
  perform pg_temp.zt('F08 refused calls wrote nothing (log empty, row unchanged)',
    (select count(*) from public.zell_shipping_options_log) = 0
    and (select o.updated_at = v_ts and not o.express_enabled and o.governorates = '{}'::jsonb and o.updated_by is null
           from public.zell_shipping_options o where o.id), null);
exception when others then
  perform pg_temp.zt('ABORT_A block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zA$;

-- B) النسخة (45404) والتحقق (45432: الحقل في detail، والمحافظة في hint)
do $zB$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_ts timestamptz := pg_temp.ver();
  v_ok jsonb := '{"express_enabled": true, "express_price_piastres": 12000, "express_days_min": 1, "express_days_max": 2}';
  v_r text;
  v_bad text := '';
  r record;
begin
  perform pg_temp.zt('F09 stale version (-1 ms) or no version -> 45404',
    pg_temp.save_as(v_owner, v_ts - interval '1 millisecond', false, '{}') like 'ERR 45404%'
    and pg_temp.save_as(v_owner, null, false, '{}') like 'ERR 45404%', null);
  v_r := pg_temp.save_as(v_owner, pg_catalog.date_trunc('milliseconds', v_ts), false, '{}');
  perform pg_temp.zt('F10 version compared at millisecond precision (as the admin sends it) · no change = changed false, no log',
    pg_temp.js(v_r) -> 'changed' = 'false'::jsonb and (select count(*) from public.zell_shipping_options_log) = 0
    and pg_temp.ver() = v_ts, v_r);
  perform pg_temp.zt('F11 express_enabled NULL -> 45432 express_enabled',
    pg_temp.save_as(v_owner, v_ts, null, '{}') = 'ERR 45432 express_enabled|', null);
  perform pg_temp.zt('F12 governorates: NULL / array / scalar / more than 60 -> 45432 governorates',
    pg_temp.save_as(v_owner, v_ts, false, null) = 'ERR 45432 governorates|'
    and pg_temp.save_as(v_owner, v_ts, false, '[]') = 'ERR 45432 governorates|'
    and pg_temp.save_as(v_owner, v_ts, false, '"x"') = 'ERR 45432 governorates|'
    and pg_temp.save_as(v_owner, v_ts, false,
          (select pg_catalog.jsonb_object_agg('g' || i, '{"express_enabled": false}'::jsonb) from pg_catalog.generate_series(1, 61) i))
        = 'ERR 45432 governorates|', null);
  for r in select * from (values
      ('{"": {"express_enabled": false}}'::jsonb, 'ERR 45432 governorate_name|'),
      ('{"   ": {"express_enabled": false}}', 'ERR 45432 governorate_name|'),
      ('{"ممممممممممممممممممممممممممممممممممممممممم": {"express_enabled": false}}', 'ERR 45432 governorate_name|ممممممممممممممممممممممممممممممممممممممممم'),
      ('{" القاهرة": {"express_enabled": false}, "القاهرة": {"express_enabled": false}}', 'ERR 45432 governorate_name|القاهرة'),
      ('{"القاهرة": 5}', 'ERR 45432 governorate_shape|القاهرة'),
      ('{"القاهرة": {"express_enabled": false, "price": 1}}', 'ERR 45432 governorate_shape|القاهرة')) t(g, e) loop
    v_r := pg_temp.save_as(v_owner, v_ts, false, r.g);
    if v_r is distinct from r.e then v_bad := v_bad || v_r || ' ; '; end if;
  end loop;
  perform pg_temp.zt('F13 governorate name (empty · spaces · > 40 · duplicate after NFC + trim) and shape (not an object · unknown key) -> 45432 with the governorate in hint',
    v_bad = '', v_bad);
  v_bad := '';
  for r in select * from (values
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": 3}}'::jsonb),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": "3", "standard_days_max": 5}}'),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": -1, "standard_days_max": 5}}'),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": 1.5, "standard_days_max": 5}}'),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": 6, "standard_days_max": 5}}'),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": 1, "standard_days_max": 61}}'),
      ('{"القاهرة": {"express_enabled": false, "standard_days_min": null, "standard_days_max": 5}}')) t(g) loop
    v_r := pg_temp.save_as(v_owner, v_ts, false, r.g);
    if v_r is distinct from 'ERR 45432 standard_days|القاهرة' then v_bad := v_bad || v_r || ' ; '; end if;
  end loop;
  perform pg_temp.zt('F14 standard days: one side · string · negative · fraction · min > max · > 60 · null + number -> 45432 standard_days',
    v_bad = '', v_bad);
  perform pg_temp.zt('F15 governorate express_enabled missing / not boolean -> 45432 express_enabled',
    pg_temp.save_as(v_owner, v_ts, false, '{"القاهرة": {}}') = 'ERR 45432 express_enabled|القاهرة'
    and pg_temp.save_as(v_owner, v_ts, false, '{"القاهرة": {"express_enabled": "true"}}') = 'ERR 45432 express_enabled|القاهرة', null);
  v_bad := '';
  for r in select * from (values
      (v_ok || '{"express_price_piastres": 0}', 'express_price'),
      (v_ok || '{"express_price_piastres": -1}', 'express_price'),
      (v_ok || '{"express_price_piastres": 1.5}', 'express_price'),
      (v_ok || '{"express_price_piastres": "12000"}', 'express_price'),
      (v_ok || '{"express_price_piastres": 100000001}', 'express_price'),
      (v_ok - 'express_price_piastres', 'express_price'),
      (v_ok || '{"express_price_piastres": null}', 'express_price'),
      (v_ok - 'express_days_min' - 'express_days_max', 'express_days'),
      (v_ok || '{"express_days_min": 3, "express_days_max": 2}', 'express_days'),
      (v_ok || '{"express_days_max": 61}', 'express_days'),
      (v_ok || '{"express_days_min": null}', 'express_days')) t(c, f) loop
    v_r := pg_temp.save_as(v_owner, v_ts, true, pg_catalog.jsonb_build_object('القاهرة', r.c));
    if v_r is distinct from 'ERR 45432 ' || r.f || '|القاهرة' then v_bad := v_bad || r.f || ':' || v_r || ' ; '; end if;
  end loop;
  perform pg_temp.zt('F16 express price (0 · negative · fraction · string · > 100,000,000 · missing when on) and days (missing when on · min > max · > 60 · one side) -> 45432 by field',
    v_bad = '', v_bad);
  perform pg_temp.zt('F17 express off keeps a valid draft price/days; boundaries accepted (price 1 and 100,000,000 · days 0..60) — nothing saved here',
    pg_temp.js(pg_temp.save_as(v_owner, v_ts, false,
      '{"القاهرة": {"express_enabled": false, "express_price_piastres": 1, "express_days_min": 0, "express_days_max": 60, "standard_days_min": 0, "standard_days_max": 0}}')) -> 'changed' = 'true'::jsonb
    and pg_temp.js(pg_temp.save_as(v_owner, pg_temp.ver(), false, '{}')) -> 'changed' = 'true'::jsonb
    and pg_temp.js(pg_temp.save_as(v_owner, pg_temp.ver(), true,
      '{"القاهرة": {"express_enabled": true, "express_price_piastres": 100000000, "express_days_min": 60, "express_days_max": 60}}')) -> 'changed' = 'true'::jsonb
    and pg_temp.js(pg_temp.save_as(v_owner, pg_temp.ver(), false, '{}')) -> 'changed' = 'true'::jsonb, null);
  perform pg_temp.zt('F18 the version is checked before validation (stale + invalid -> 45404)',
    pg_temp.save_as(v_owner, v_ts - interval '1 second', null, null) like 'ERR 45404%', null);
  perform pg_temp.zt('F19 rejected saves wrote nothing: 4 log rows from F17 only, row back to express off + {}',
    (select count(*) from public.zell_shipping_options_log) = 4
    and (select not o.express_enabled and o.governorates = '{}'::jsonb from public.zell_shipping_options o where o.id), null);
exception when others then
  perform pg_temp.zt('ABORT_B block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zB$;

-- C) الحفظ الحقيقي: التطبيع (NFC + trim والمفاتيح الست) · السجل · القراية
do $zC$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_in jsonb := '{" القاهرة ": {"standard_days_min": 3, "standard_days_max": 5, "express_enabled": true, "express_price_piastres": 12000, "express_days_min": 1, "express_days_max": 2},
                  "الجيزة": {"express_enabled": false, "express_price_piastres": 9000},
                  "\u0627\u0654سوان": {"express_enabled": true, "express_price_piastres": 7000, "express_days_min": 1, "express_days_max": 2}}';
  v_exp jsonb := '{"القاهرة": {"standard_days_min": 3, "standard_days_max": 5, "express_enabled": true, "express_price_piastres": 12000, "express_days_min": 1, "express_days_max": 2},
                   "الجيزة": {"standard_days_min": null, "standard_days_max": null, "express_enabled": false, "express_price_piastres": 9000, "express_days_min": null, "express_days_max": null},
                   "أسوان": {"standard_days_min": null, "standard_days_max": null, "express_enabled": true, "express_price_piastres": 7000, "express_days_min": 1, "express_days_max": 2}}';
  v_log integer := (select count(*) from public.zell_shipping_options_log);
  v_r text;
  v_ts timestamptz;
begin
  v_r := pg_temp.save_as(v_owner, pg_temp.ver(), true, v_in);
  v_ts := pg_temp.ver();
  perform pg_temp.zt('F20 owner save: names NFC + trim, 6 keys each (missing = null), changed, updated_by = owner, one log row (old -> new)',
    pg_temp.js(v_r) -> 'changed' = 'true'::jsonb and pg_temp.js(v_r) -> 'governorates' = v_exp
    and (select o.express_enabled and o.governorates = v_exp and o.updated_by = v_owner::uuid from public.zell_shipping_options o where o.id)
    and (select count(*) from public.zell_shipping_options_log) = v_log + 1
    and (select l.actor = v_owner::uuid and l.new_value = pg_catalog.jsonb_build_object('express_enabled', true, 'governorates', v_exp)
                and l.old_value = '{"express_enabled": false, "governorates": {}}'::jsonb
           from public.zell_shipping_options_log l order by l.id desc limit 1), v_r);
  v_r := pg_temp.save_as(v_owner, v_ts, true, v_exp);
  perform pg_temp.zt('F21 saving the same values again (normalized form) -> changed false, no log row, version unchanged',
    pg_temp.js(v_r) -> 'changed' = 'false'::jsonb and (select count(*) from public.zell_shipping_options_log) = v_log + 1
    and pg_temp.ver() = v_ts, v_r);
  v_r := pg_temp.call_as('service_role', null, 'select public.zell_shipping_options_checkout()::text');
  perform pg_temp.zt('F22 checkout read (service_role) = {express_enabled, governorates} as saved, nothing else',
    pg_temp.js(v_r) = pg_catalog.jsonb_build_object('express_enabled', true, 'governorates', v_exp), v_r);
  v_r := pg_temp.call_as('authenticated', '00000000-0000-0000-0000-00000000000b', 'select public.zell_shipping_options_get()::text');
  perform pg_temp.zt('F23 admin get reflects the save (values + version)',
    pg_temp.js(v_r) -> 'governorates' = v_exp and (pg_temp.js(v_r) ->> 'updated_at')::timestamptz = v_ts, v_r);
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

-- D) الثبات: السجل append-only · صف الإعداد مايتمسحش ومفيش تاني · governorates لازم object
do $zD$
declare
  e1 text; e2 text; e3 text; e4 text; e5 text; e6 text; e7 text;
begin
  begin update public.zell_shipping_options_log set actor = actor; e1 := 'none'; exception when others then e1 := sqlstate; end;
  begin delete from public.zell_shipping_options_log; e2 := 'none'; exception when others then e2 := sqlstate; end;
  begin truncate public.zell_shipping_options_log; e3 := 'none'; exception when others then e3 := sqlstate; end;
  perform pg_temp.zt('F24 log: UPDATE / DELETE / TRUNCATE -> 45413', e1 = '45413' and e2 = '45413' and e3 = '45413',
    e1 || ',' || e2 || ',' || e3);
  begin delete from public.zell_shipping_options; e4 := 'none'; exception when others then e4 := sqlstate; end;
  begin truncate public.zell_shipping_options; e5 := 'none'; exception when others then e5 := sqlstate; end;
  begin
    insert into public.zell_shipping_options (id, express_enabled, governorates) values (false, false, '{}');
    e6 := 'none';
  exception when others then e6 := sqlstate;
  end;
  begin update public.zell_shipping_options set governorates = '[]'; e7 := 'none'; exception when others then e7 := sqlstate; end;
  perform pg_temp.zt('F25 options row: no DELETE / TRUNCATE (45413), no second row, governorates must be an object (23514)',
    e4 = '45413' and e5 = '45413' and e6 in ('23514', '23505') and e7 = '23514', e4 || ',' || e5 || ',' || e6 || ',' || e7);
exception when others then
  perform pg_temp.zt('ABORT_D block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zD$;

-- E) الطلب: السريع والعادي واللقطة والمقدم والـ replay (الإعداد من C: السريع شغّال · القاهرة 12000 مدة 1–2 وعادي 3–5 ·
--    الجيزة سريع مقفول ومن غير مدة عادي · أسوان سريع متاح بس موقوفة في العادي)
do $zE$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_std text;
  v_def text;
  v_exp text;
  v_a text;
  v_b text;
  v_c text;
  v_d text;
  v_r1 text;
  v_r2 text;
  v_r3 text;
  v_cfg jsonb;
  v_bad text := '';
  r record;
begin
  v_exp := pg_temp.co('E30', '01000000030', null, 'express');
  v_std := pg_temp.co('E31', '01000000031', null, 'standard');
  v_def := pg_temp.co('E32', '01000000032', null, null);
  perform pg_temp.zt('F30 express (Cairo): shipping = the full express price 12000, total = items + 12000, snapshot express 1–2',
    pg_temp.js(v_exp) ->> 'shipping_piastres' = '12000' and pg_temp.js(v_exp) ->> 'total_piastres' = '102000'
    and pg_temp.snap(v_exp) = 'express/1/2/12000/102000', v_exp);
  perform pg_temp.zt('F31 standard (explicit) and no parameter: shipping 5000, snapshot standard with the standard days 3–5, same response keys as express',
    pg_temp.snap(v_std) = 'standard/3/5/5000/95000' and pg_temp.snap(v_def) = 'standard/3/5/5000/95000'
    and pg_temp.keys(v_std) = pg_temp.keys(v_exp) and pg_temp.keys(v_def) = pg_temp.keys(v_exp) and pg_temp.keys(v_exp) <> '',
    v_std || ' || ' || v_def);
  v_a := pg_temp.co('E33a', '01000000033', '{"p_items": "[{\"productId\":1,\"lengthCm\":2000}]"}', 'standard');
  v_b := pg_temp.co('E33b', '01000000034', '{"p_items": "[{\"productId\":1,\"lengthCm\":2000}]"}', 'express');
  perform pg_temp.zt('F32 above the free-shipping threshold: standard = 0, express = 12000 (no free shipping for express)',
    pg_temp.snap(v_a) = 'standard/3/5/0/600000' and pg_temp.snap(v_b) = 'express/1/2/12000/612000', v_a || ' || ' || v_b);
  v_a := pg_temp.co('E34a', '01000000035', '{"p_governorate": "الجيزة"}', 'standard');
  v_b := pg_temp.co('E34b', '01000000036', '{"p_governorate": "الجيزة"}', 'express');
  perform pg_temp.zt('F33 Giza: standard 6000 with no days (none configured) · express off for Giza -> 45431',
    pg_temp.snap(v_a) = 'standard/-/-/6000/96000' and v_b = 'ERR 45431 ', v_a || ' || ' || v_b);
  v_a := pg_temp.co('E35a', '01000000037', '{"p_governorate": "أسوان"}', 'express');
  v_b := pg_temp.co('E35b', '01000000038', '{"p_governorate": "الإسكندرية"}', 'express');
  perform pg_temp.zt('F34 express never opens a governorate the standard shipping does not serve (disabled Aswan · unknown) -> 45031',
    v_a like 'ERR 45031 %' and v_b like 'ERR 45031 %', v_a || ' || ' || v_b);
  v_a := pg_temp.co('E36a', '01000000039', '{"p_area": "الزمالك"}', 'express');
  v_b := pg_temp.co('E36b', '01000000040', '{"p_area": "المعادي", "p_installation": "true"}', 'express');
  v_c := pg_temp.co('E36c', '01000000041', '{"p_items": "[{\"productId\":3,\"quantity\":2}]", "p_installation": "true"}', 'express');
  perform pg_temp.zt('F35 express keeps area + installer rules: unknown area -> 45034 · Maadi + installer = 12000 + 4500 + 2500 travel · pieces only + installer -> 45033',
    v_a like 'ERR 45034 %' and pg_temp.snap(v_b) = 'express/1/2/12000/109000'
    and pg_temp.js(v_b) ->> 'installation_piastres' = '4500' and pg_temp.js(v_b) ->> 'installation_travel_piastres' = '2500'
    and v_c like 'ERR 45033 %', v_a || ' || ' || v_b || ' || ' || v_c);
  for r in select * from (values ('Express'), ('EXPRESS'), (''), (' express'), ('standard '), ('fast')) t(m) loop
    v_a := pg_temp.co('E37' || pg_catalog.md5(r.m), '01000000042', null, r.m);
    if v_a is distinct from 'ERR 45432 shipping_method' then v_bad := v_bad || '[' || r.m || '] ' || v_a || ' ; '; end if;
  end loop;
  perform pg_temp.zt('F36 any other method value -> 45432 shipping_method, nothing written',
    v_bad = '' and not exists (select 1 from public.orders o where o.customer_phone = '01000000042'), v_bad);
  v_a := pg_temp.co('E38a', '01000000043', '{"p_coupon_code": "PCT10"}', 'express');
  perform pg_temp.zt('F37 coupon with express: discount on items only (5000), shipping 12000 untouched',
    pg_temp.js(v_a) ->> 'discount_piastres' = '5000' and pg_temp.snap(v_a) = 'express/1/2/12000/97000', v_a);
  select s.confirmation_fee into v_cfg from public.zell_payment_settings s where s.id;
  update public.zell_payment_settings
     set confirmation_fee = '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 4000}'::jsonb where id;
  v_a := pg_temp.co('E39a', '01000000044', null, 'express');
  v_b := pg_temp.co('E39b', '01000000045', null, 'standard');
  perform pg_temp.zt('F38 deposit "shipping value" = the chosen method price (express 12000 · standard 5000), = zell_payment_fee_calc',
    (select o.confirmation_fee_piastres = 12000
            and o.confirmation_fee_piastres = public.zell_payment_fee_calc(
                  (select s.confirmation_fee from public.zell_payment_settings s where s.id), o.total_piastres, o.shipping_piastres, true, false)
       from public.orders o where o.order_number = pg_temp.js(v_a) ->> 'order_number')
    and (select o.confirmation_fee_piastres = 5000 from public.orders o where o.order_number = pg_temp.js(v_b) ->> 'order_number'),
    v_a || ' || ' || v_b);
  update public.zell_payment_settings set confirmation_fee = v_cfg where id;
  v_r1 := pg_temp.co('E40', '01000000046', null, 'express');
  perform pg_temp.save_as(v_owner, pg_temp.ver(), true,
    (select o.governorates || pg_catalog.jsonb_build_object('القاهرة', (o.governorates -> 'القاهرة') || '{"express_price_piastres": 15000}')
       from public.zell_shipping_options o where o.id));
  v_r2 := pg_temp.co('E40', '01000000046', null, 'express');
  perform pg_temp.save_as(v_owner, pg_temp.ver(), false, (select o.governorates from public.zell_shipping_options o where o.id));
  v_r3 := pg_temp.co('E40', '01000000046', null, 'express');
  v_c := pg_temp.co('E40', '01000000046', '{"p_request_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}', 'express');
  v_d := pg_temp.co('E40b', '01000000047', null, 'express');
  perform pg_temp.zt('F39 replay after a price change and after express is switched off = the original order (12000) · same key + other hash -> 45003 · new key -> 45431',
    pg_temp.js(v_r1) ->> 'shipping_piastres' = '12000'
    and pg_temp.js(v_r2) ->> 'replayed' = 'true' and pg_temp.js(v_r3) ->> 'replayed' = 'true'
    and pg_temp.js(v_r2) ->> 'order_number' = pg_temp.js(v_r1) ->> 'order_number'
    and pg_temp.js(v_r3) ->> 'order_number' = pg_temp.js(v_r1) ->> 'order_number'
    and pg_temp.js(v_r2) ->> 'shipping_piastres' = '12000' and pg_temp.js(v_r3) ->> 'total_piastres' = pg_temp.js(v_r1) ->> 'total_piastres'
    and pg_temp.snap(v_r3) = 'express/1/2/12000/102000'
    and v_c like 'ERR 45003 %' and v_d = 'ERR 45431 ', v_r1 || ' || ' || v_r3 || ' || ' || v_c || ' || ' || v_d);
  v_a := pg_temp.co('E41', '01000000048', null, 'standard');
  perform pg_temp.zt('F40 the global switch off does not touch standard: Cairo standard still 5000 with days 3–5',
    pg_temp.snap(v_a) = 'standard/3/5/5000/95000', v_a);
  -- إعداد بايظ (تعديل مباشر كـ postgres، برّه دالة الحفظ): السريع بيترفض، والعادي عمره ما بيترفض (المدة NULL).
  update public.zell_shipping_options
     set express_enabled = true,
         governorates = '{"القاهرة": {"standard_days_min": 9, "standard_days_max": 3, "express_enabled": true, "express_price_piastres": "12000", "express_days_min": 1, "express_days_max": 2},
                          "الجيزة": {"standard_days_min": "x", "standard_days_max": 2, "express_enabled": true, "express_price_piastres": 9000, "express_days_min": 1, "express_days_max": 70}}'
   where id;
  v_a := pg_temp.co('E42a', '01000000049', null, 'express');
  v_b := pg_temp.co('E42b', '01000000050', '{"p_governorate": "الجيزة"}', 'express');
  v_c := pg_temp.co('E42c', '01000000051', null, 'standard');
  v_d := pg_temp.co('E42d', '01000000052', '{"p_governorate": "الجيزة"}', null);
  perform pg_temp.zt('F41 malformed options: express -> 45431 (price not a number · days > 60) · standard never blocked, malformed days = NULL',
    v_a = 'ERR 45431 ' and v_b = 'ERR 45431 '
    and pg_temp.snap(v_c) = 'standard/-/-/5000/95000' and pg_temp.snap(v_d) = 'standard/-/-/6000/96000',
    v_a || ' || ' || v_b || ' || ' || v_c || ' || ' || v_d);
  perform pg_temp.zt('F42 every order created here carries a method; the shape check holds',
    (select count(*) from public.orders o where o.customer_phone like '010000000%' and o.shipping_method is null) = 0
    and (select count(*) from public.orders o where o.customer_phone like '010000000%') = 14, null);
exception when others then
  perform pg_temp.zt('ABORT_E block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zE$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 38 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
