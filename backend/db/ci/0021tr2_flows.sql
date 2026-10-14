-- TRACK-ORDER v2 W1 — سيناريوهات الشحنة ورسايل العميل ورد التتبّع بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0021tr2_sql_ci.sh بعد تطبيق 0021tr2_track_order_v2.sql فوق شكل Production
--   (A1 · D · P1 · P2 · D2 · TR · EXPRESS) وإعدادات الـ shim (القاهرة 5000 · كوبون PCT10 · طريقة دفع «كاش»).
-- • الهويات من shim الـ CI: مالك ...0a · أدمن شغّال ...0b · أدمن موقوف ...0c.
-- • الطلبات بتتعمل بالدوال الحقيقية (zell_create_order · zell_order_transition · zell_payment_record / _refund ·
--   zell_order_set_confirmed_delivery · zell_order_set_internal_note · zell_order_set_gate)، فالسجل والدفعات حقيقيين.
-- • نسخة v1 من دالة التتبّع (جسم TR W1 بالحرف) في pg_temp للمقارنة: حقول v1 في رد v2 = رد v1 بالظبط لكل طلب.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 34 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local statement_timeout = '120s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zt_orders (tag text primary key, num text not null) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

-- النداء بدور وجلسة (sub بدور authenticated، أو من غير جلسة لو NULL). النتيجة نص، أو 'ERR <sqlstate>[ <detail>]'.
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
  v_detail text;
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
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    return 'ERR ' || v_state || coalesce(' ' || nullif(v_detail, ''), '');
  end;
  return coalesce(r, 'null');
end
$f$;

create function pg_temp.owner_id() returns text language sql as $f$ select '00000000-0000-0000-0000-00000000000a' $f$;
create function pg_temp.admin_id() returns text language sql as $f$ select '00000000-0000-0000-0000-00000000000b' $f$;
create function pg_temp.off_id() returns text language sql as $f$ select '00000000-0000-0000-0000-00000000000c' $f$;
create function pg_temp.adm(p_sql text) returns text language sql as $f$ select pg_temp.call_as('authenticated', pg_temp.admin_id(), p_sql) $f$;
create function pg_temp.own(p_sql text) returns text language sql as $f$ select pg_temp.call_as('authenticated', pg_temp.owner_id(), p_sql) $f$;
create function pg_temp.who(p_who text, p_sql text) returns text language sql as $f$
  select case p_who when 'owner' then pg_temp.own(p_sql) when 'admin' then pg_temp.adm(p_sql)
                    when 'off' then pg_temp.call_as('authenticated', pg_temp.off_id(), p_sql)
                    when 'nosession' then pg_temp.call_as('authenticated', null, p_sql)
                    else pg_temp.call_as(p_who, null, p_sql) end
$f$;

create function pg_temp.js(p text) returns jsonb language sql as $f$
  select case when p is null or p like 'ERR%' or p = 'null' then null else p::jsonb end;
$f$;

-- لازم ينجح (التحضير): أي خطأ بيوقف البلوك.
create function pg_temp.must(p text) returns text language plpgsql as $f$
begin
  if p is null or p like 'ERR%' then
    raise exception 'setup step failed: %', coalesce(p, 'null');
  end if;
  return p;
end
$f$;

create function pg_temp.num(p_tag text) returns text language sql as $f$ select o.num from pg_temp.zt_orders o where o.tag = p_tag $f$;
create function pg_temp.oid_of(p_tag text) returns integer language sql as $f$
  select o.id from public.orders o where o.order_number = pg_temp.num(p_tag)
$f$;
create function pg_temp.ver(p_tag text) returns text language sql as $f$
  select pg_catalog.quote_literal(o.updated_at::text) || '::timestamptz' from public.orders o where o.order_number = pg_temp.num(p_tag)
$f$;
create function pg_temp.sver(p_tag text) returns text language sql as $f$
  select coalesce((select pg_catalog.quote_literal(s.updated_at::text) || '::timestamptz' from public.zell_order_shipments s
                    where s.order_id = pg_temp.oid_of(p_tag)), 'null')
$f$;
create function pg_temp.uver(p_id bigint) returns text language sql as $f$
  select coalesce((select pg_catalog.quote_literal(u.updated_at::text) || '::timestamptz' from public.zell_order_customer_updates u
                    where u.id = p_id), 'null')
$f$;
create function pg_temp.today() returns date language sql as $f$ select (pg_catalog.now() at time zone 'Africa/Cairo')::date $f$;

-- zell_create_order بالأسماء (زي /api/orders) كـ postgres ← رقم الطلب.
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
    'p_idempotency_key', 'flow-0021tr2-' || p_key || '-0000000',
    'p_request_hash', repeat('a', 64),
    'p_checkout_session_hash', repeat('b', 64),
    'p_receipt_token_hash', repeat('c', 64)) || coalesce(p_over, '{}'::jsonb);
  k text;
  s text := '';
  r jsonb;
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
  execute 'select public.zell_create_order(' || s || ')' into r;
  return r ->> 'order_number';
end
$f$;

create function pg_temp.tr(p_tag text, p_to text, p_reason text) returns text language sql as $f$
  select pg_temp.adm(pg_catalog.format('select public.zell_order_transition(%s, %s, %L, %L)::text',
                                       pg_temp.oid_of(p_tag), pg_temp.ver(p_tag), p_to, p_reason))
$f$;
create function pg_temp.pay(p_who text, p_fn text, p_cmd integer, p_tag text, p_amount integer, p_ref text, p_note text)
returns text language sql as $f$
  select pg_temp.who(p_who, pg_catalog.format(
    'select public.%s(%L::uuid, %s, %s, %s, %L, %s, null, %L, %L)::text', p_fn,
    '00000000-0000-4000-8000-' || lpad(p_cmd::text, 12, '0'), pg_temp.oid_of(p_tag), pg_temp.ver(p_tag), p_amount, 'balance',
    (select m.id from public.zell_payment_methods m where m.name = 'كاش'), p_ref, p_note))
$f$;
create function pg_temp.ship(p_who text, p_tag text, p_ver text, p_carrier text, p_number text, p_url text, p_shipped date,
                             p_expected date)
returns text language sql as $f$
  select pg_temp.who(p_who, pg_catalog.format(
    'select public.zell_shipment_save(%L, %s, %L, %L, %L, %L::date, %L::date)::text',
    coalesce(pg_temp.num(p_tag), p_tag), p_ver, p_carrier, p_number, p_url, p_shipped, p_expected))
$f$;
create function pg_temp.uadd(p_who text, p_tag text, p_text text) returns text language sql as $f$
  select pg_temp.who(p_who, pg_catalog.format('select public.zell_customer_update_add(%L, %L)::text',
                                              coalesce(pg_temp.num(p_tag), p_tag), p_text))
$f$;
create function pg_temp.uedit(p_who text, p_tag text, p_id bigint, p_ver text, p_text text) returns text language sql as $f$
  select pg_temp.who(p_who, pg_catalog.format('select public.zell_customer_update_edit(%L, %s, %s, %L)::text',
                                              coalesce(pg_temp.num(p_tag), p_tag), p_id, p_ver, p_text))
$f$;
create function pg_temp.uhide(p_who text, p_tag text, p_id bigint, p_ver text, p_hidden boolean) returns text language sql as $f$
  select pg_temp.who(p_who, pg_catalog.format('select public.zell_customer_update_set_hidden(%L, %s, %s, %L::boolean)::text',
                                              coalesce(pg_temp.num(p_tag), p_tag), p_id, p_ver, p_hidden))
$f$;
create function pg_temp.track(p_tag text) returns jsonb language sql as $f$
  select pg_temp.js(pg_temp.call_as('service_role', null,
           pg_catalog.format('select public.zell_checkout_track_order(%L)::text', pg_temp.num(p_tag))))
$f$;
create function pg_temp.slog(p_tag text) returns bigint language sql as $f$
  select count(*) from public.zell_order_shipments_log l where l.order_id = pg_temp.oid_of(p_tag)
$f$;
create function pg_temp.ulog() returns bigint language sql as $f$ select count(*) from public.zell_order_customer_updates_log $f$;
create function pg_temp.statuses(p_r jsonb) returns text language sql as $f$
  select coalesce(pg_catalog.string_agg(e ->> 'status', ',' order by n), '')
    from pg_catalog.jsonb_array_elements(p_r -> 'history') with ordinality x(e, n)
$f$;

-- نسخة v1 (جسم TR W1 بالحرف) للمقارنة.
create function pg_temp.track_v1(p_order_number text)
returns jsonb language sql stable as $fn$
  select pg_catalog.jsonb_build_object(
           'order_number',   o.order_number,
           'status',         o.status,
           'created_at',     o.created_at,
           'total_piastres', o.total_piastres,
           'items', (
             select coalesce(
                      pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'product_name_ar',     i.product_name_ar,
                          'length_cm',           i.length_cm,
                          'width_cm',            i.width_cm,
                          'quantity',            i.quantity,
                          'sale_unit',           i.sale_unit,
                          'line_total_piastres', i.line_total_piastres)
                        order by i.id),
                      '[]'::jsonb)
               from public.order_items i
              where i.order_id = o.id),
           'delivery', case
             when o.delivery_confirmed_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'confirmed'::text,
               'date',   pg_catalog.to_char(o.delivery_confirmed_date, 'YYYY-MM-DD'),
               'period', o.delivery_confirmed_period)
             when o.preferred_delivery_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'preferred'::text,
               'date',   pg_catalog.to_char(o.preferred_delivery_date, 'YYYY-MM-DD'),
               'period', o.preferred_delivery_period)
           end)
    from public.orders o
   where p_order_number ~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
     and o.order_number = p_order_number
$fn$;

-- S) التحضير: طلبات بكل الحالات (البوابة مقفولة الأول، وبعدين مفتوحة للتجهيز والرفض).
--   A جديد (كوبون + ملاحظة عميل + ملاحظة داخلية) · B مؤكد (موعد مفضّل ثم مؤكد) · C ملغي بسبب · D مشحون من confirmed (قبل
--   البوابة) بدفعة ورد · E مسلّم بالمراحل كلها · F مرفوض بدفعة ورد · G سريع · H طلب قديم من غير طريقة شحن · I جاري التجهيز.
do $zS$
begin
  update public.zell_shipping_options
     set express_enabled = true,
         governorates = '{"القاهرة": {"standard_days_min": 2, "standard_days_max": 4, "express_enabled": true, "express_price_piastres": 11000, "express_days_min": 1, "express_days_max": 1}}'::jsonb
   where id;
  insert into pg_temp.zt_orders values
    ('A', pg_temp.co('A', '01000000201', '{"p_coupon_code": "PCT10", "p_notes": "ملاحظة العميل السرية 77"}', 'standard')),
    ('B', pg_temp.co('B', '01000000202', pg_catalog.jsonb_build_object(
            'p_items', '[{"productId":1,"lengthCm":300},{"productId":3,"quantity":2}]',
            'p_preferred_delivery', pg_catalog.jsonb_build_object('date', pg_catalog.to_char(pg_temp.today() + 3, 'YYYY-MM-DD'),
                                                                  'period', 'morning', 'note', 'ملاحظة موعد سرية 66')::text), null)),
    ('C', pg_temp.co('C', '01000000203', '{"p_items": "[{\"productId\":3,\"quantity\":1}]"}', null)),
    ('D', pg_temp.co('D', '01000000204', null, null)),
    ('E', pg_temp.co('E', '01000000205', null, null)),
    ('F', pg_temp.co('F', '01000000206', null, null)),
    ('G', pg_temp.co('G', '01000000207', null, 'express')),
    ('I', pg_temp.co('I', '01000000209', null, null));
  insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres)
  values ('FLM-TRHAAA', 'عميل قديم', '01000000208', 'القاهرة', 'عنوان قديم طويل كفاية', 30000, 5000, 35000);
  insert into pg_temp.zt_orders values ('H', 'FLM-TRHAAA');
  perform pg_temp.must(pg_temp.adm(pg_catalog.format('select public.zell_order_set_internal_note(%s, %s, %L)::text',
                                                     pg_temp.oid_of('A'), pg_temp.ver('A'), 'ملاحظة داخلية سرية 88')));
  perform pg_temp.must(pg_temp.tr('B', 'confirmed', null));
  perform pg_temp.must(pg_temp.adm(pg_catalog.format('select public.zell_order_set_confirmed_delivery(%s, %s, %L::date, %L, %L)::text',
                                                     pg_temp.oid_of('B'), pg_temp.ver('B'), pg_temp.today() + 2, 'noon', 'ملاحظة تأكيد سرية 55')));
  perform pg_temp.must(pg_temp.tr('C', 'cancelled', 'سبب إلغاء داخلي 99'));
  perform pg_temp.must(pg_temp.tr('D', 'confirmed', null));
  perform pg_temp.must(pg_temp.tr('D', 'shipped', null));
  perform pg_temp.must(pg_temp.pay('admin', 'zell_payment_record', 1, 'D', 10000, 'REF-SECRET-41', 'ملاحظة دفع سرية 44'));
  perform pg_temp.must(pg_temp.pay('owner', 'zell_payment_refund', 2, 'D', 3000, 'REF-SECRET-42', 'ملاحظة رد سرية 45'));
  perform pg_temp.must(pg_temp.own(pg_catalog.format('select public.zell_order_set_gate(true, %L)::text', 'owner-approval-2026-10-15-ci-tr2-flows')));
  perform pg_temp.must(pg_temp.tr('E', 'confirmed', null));
  perform pg_temp.must(pg_temp.tr('E', 'preparing', null));
  perform pg_temp.must(pg_temp.tr('E', 'shipped', null));
  perform pg_temp.must(pg_temp.pay('admin', 'zell_payment_record', 3, 'E',
                                   (select o.total_piastres from public.orders o where o.order_number = pg_temp.num('E')), null, null));
  perform pg_temp.must(pg_temp.tr('E', 'delivered', null));
  perform pg_temp.must(pg_temp.tr('F', 'confirmed', null));
  perform pg_temp.must(pg_temp.tr('F', 'preparing', null));
  perform pg_temp.must(pg_temp.tr('F', 'shipped', null));
  perform pg_temp.must(pg_temp.pay('admin', 'zell_payment_record', 4, 'F', 20000, null, null));
  perform pg_temp.must(pg_temp.tr('F', 'refused', 'سبب رفض داخلي 98'));
  perform pg_temp.must(pg_temp.pay('owner', 'zell_payment_refund', 5, 'F', 5000, null, null));
  perform pg_temp.must(pg_temp.tr('I', 'confirmed', null));
  perform pg_temp.must(pg_temp.tr('I', 'preparing', null));
  perform pg_temp.zt('F00 setup: 9 orders in new / confirmed / cancelled / shipped / delivered / refused / preparing, express + old order',
    (select pg_catalog.string_agg(z.tag || '=' || o.status, ',' order by z.tag)
       from pg_temp.zt_orders z join public.orders o on o.order_number = z.num)
    = 'A=new,B=confirmed,C=cancelled,D=shipped,E=delivered,F=refused,G=new,H=new,I=preparing', null);
exception when others then
  perform pg_temp.zt('ABORT_S setup block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zS$;

-- A) الهوية والصلاحيات
do $zA$
declare
  v_get text := pg_catalog.format('select public.zell_shipment_get(%L)::text', pg_temp.num('B'));
  v_list text := pg_catalog.format('select public.zell_customer_update_list(%L)::text', pg_temp.num('B'));
  v_r text;
  v_bad text := '';
  r record;
begin
  perform pg_temp.zt('F01 no session -> 45400 · inactive admin -> 45401 (get / list / save / add)',
    pg_temp.who('nosession', v_get) = 'ERR 45400' and pg_temp.who('nosession', v_list) = 'ERR 45400'
    and pg_temp.who('off', v_get) = 'ERR 45401' and pg_temp.who('off', v_list) = 'ERR 45401'
    and pg_temp.ship('off', 'B', 'null', 'x', null, null, null, null) = 'ERR 45401'
    and pg_temp.uadd('off', 'B', 'x') = 'ERR 45401'
    and pg_temp.ship('nosession', 'B', 'null', 'x', null, null, null, null) = 'ERR 45400'
    and pg_temp.uadd('nosession', 'B', 'x') = 'ERR 45400', null);
  for r in select * from (values ('anon'), ('service_role')) t(ro) loop
    v_r := pg_temp.who(r.ro, v_get) || '|' || pg_temp.who(r.ro, v_list) || '|' || pg_temp.ship(r.ro, 'B', 'null', 'x', null, null, null, null)
           || '|' || pg_temp.uadd(r.ro, 'B', 'x');
    if v_r <> 'ERR 42501|ERR 42501|ERR 42501|ERR 42501' then v_bad := v_bad || r.ro || ': ' || v_r || ' ; '; end if;
    v_r := pg_temp.call_as(r.ro, null, 'select count(*)::text from public.zell_order_shipments');
    if v_r <> 'ERR 42501' then v_bad := v_bad || r.ro || ' table: ' || v_r || ' ; '; end if;
  end loop;
  v_r := pg_temp.call_as('authenticated', pg_temp.admin_id(), 'select count(*)::text from public.zell_order_customer_updates');
  perform pg_temp.zt('F02 anon / service_role -> 42501 on the 4 functions · no direct table read for anon / service_role / authenticated',
    v_bad = '' and v_r = 'ERR 42501', v_bad || ' auth=' || v_r);
  v_r := pg_temp.adm(v_get);
  perform pg_temp.zt('F03 admin get: confirmed order, editable, shipment null · owner list: empty',
    pg_temp.js(v_r) = pg_catalog.jsonb_build_object('order_number', pg_temp.num('B'), 'status', 'confirmed', 'editable', true, 'shipment', null)
    and pg_temp.js(pg_temp.own(v_list)) = pg_catalog.jsonb_build_object('order_number', pg_temp.num('B'), 'status', 'confirmed', 'updates', '[]'::jsonb),
    v_r);
  perform pg_temp.zt('F04 unknown order -> 45403 (get / list / save / add / edit / hide)',
    pg_temp.adm('select public.zell_shipment_get(''FLM-ZZZZZZ'')::text') = 'ERR 45403'
    and pg_temp.adm('select public.zell_customer_update_list(''FLM-ZZZZZZ'')::text') = 'ERR 45403'
    and pg_temp.ship('admin', 'FLM-ZZZZZZ', 'null', 'x', null, null, null, null) = 'ERR 45403'
    and pg_temp.uadd('admin', 'FLM-ZZZZZZ', 'x') = 'ERR 45403'
    and pg_temp.uedit('admin', 'FLM-ZZZZZZ', 1, 'now()', 'x') = 'ERR 45403'
    and pg_temp.uhide('admin', 'FLM-ZZZZZZ', 1, 'now()', true) = 'ERR 45403', null);
exception when others then
  perform pg_temp.zt('ABORT_A block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zA$;

-- B) الشحنة
do $zB$
declare
  v_ord text;
  v_ev bigint;
  v_r text;
  v_r2 text;
  v_ts timestamptz;
  v_bad text := '';
  r record;
begin
  v_r := pg_temp.ship('admin', 'A', 'null', 'بوسطة', null, null, null, null) || '|' || pg_temp.ship('admin', 'C', 'null', 'بوسطة', null, null, null, null)
         || '|' || pg_temp.ship('owner', 'F', 'null', 'بوسطة', null, null, null, null) || '|' || pg_temp.ship('owner', 'G', 'null', 'بوسطة', null, null, null, null);
  perform pg_temp.zt('F10 save refused in new / cancelled / refused -> 45410, nothing written',
    v_r = 'ERR 45410|ERR 45410|ERR 45410|ERR 45410' and not exists (select 1 from public.zell_order_shipments)
    and not exists (select 1 from public.zell_order_shipments_log), v_r);
  select o.status || '|' || o.updated_at::text into v_ord from public.orders o where o.order_number = pg_temp.num('B');
  select count(*) into v_ev from public.order_events e where e.order_id = pg_temp.oid_of('B');
  v_r := pg_temp.ship('admin', 'B', 'null', '  أرامكس  ', ' AWB 123 ', ' https://track.example.com/a?b=1 ', pg_temp.today(), pg_temp.today() + 3);
  perform pg_temp.zt('F11 first save (admin, confirmed): trimmed values, changed, one log row (old null, actor admin), order status + updated_at + events untouched',
    pg_temp.js(v_r) ->> 'changed' = 'true'
    and (pg_temp.js(v_r) -> 'shipment') - 'updated_at'
        = pg_catalog.jsonb_build_object('carrier', 'أرامكس', 'tracking_number', 'AWB 123', 'tracking_url', 'https://track.example.com/a?b=1',
                                        'shipped_on', pg_catalog.to_char(pg_temp.today(), 'YYYY-MM-DD'),
                                        'expected_on', pg_catalog.to_char(pg_temp.today() + 3, 'YYYY-MM-DD'))
    and (select count(*) from public.zell_order_shipments_log l
          where l.order_id = pg_temp.oid_of('B') and l.old_value is null and l.actor = pg_temp.admin_id()::uuid) = 1
    and pg_temp.slog('B') = 1
    and (select o.status || '|' || o.updated_at::text from public.orders o where o.order_number = pg_temp.num('B')) = v_ord
    and (select count(*) from public.order_events e where e.order_id = pg_temp.oid_of('B')) = v_ev, v_r);
  v_r := pg_temp.ship('admin', 'B', 'null', 'بوسطة', null, null, null, null);
  v_r2 := pg_temp.ship('admin', 'B', quote_literal('2000-01-01') || '::timestamptz', 'بوسطة', null, null, null, null);
  perform pg_temp.zt('F12 version: null when a shipment exists -> 45404 · stale -> 45404 · nothing written',
    v_r = 'ERR 45404' and v_r2 = 'ERR 45404' and pg_temp.slog('B') = 1, v_r || ' | ' || v_r2);
  select s.updated_at into v_ts from public.zell_order_shipments s where s.order_id = pg_temp.oid_of('B');
  v_r := pg_temp.ship('owner', 'B', pg_temp.sver('B'), 'أرامكس', 'AWB 123', 'https://track.example.com/a?b=1', pg_temp.today(), pg_temp.today() + 3);
  perform pg_temp.zt('F13 same values -> changed false, no log row, version unchanged',
    pg_temp.js(v_r) ->> 'changed' = 'false' and pg_temp.slog('B') = 1
    and (select s.updated_at from public.zell_order_shipments s where s.order_id = pg_temp.oid_of('B')) = v_ts, v_r);
  v_r := pg_temp.ship('owner', 'B', pg_temp.sver('B'), 'بوسطة', '', '   ', null, pg_temp.today() + 5);
  perform pg_temp.zt('F14 owner edit with the current version: empty optional values -> null, second log row (old = the first new, actor owner)',
    (pg_temp.js(v_r) -> 'shipment') - 'updated_at'
        = pg_catalog.jsonb_build_object('carrier', 'بوسطة', 'tracking_number', null, 'tracking_url', null, 'shipped_on', null,
                                        'expected_on', pg_catalog.to_char(pg_temp.today() + 5, 'YYYY-MM-DD'))
    and pg_temp.slog('B') = 2
    and (select l.old_value ->> 'carrier' = 'أرامكس' and l.new_value ->> 'carrier' = 'بوسطة' and l.actor = pg_temp.owner_id()::uuid
           from public.zell_order_shipments_log l where l.order_id = pg_temp.oid_of('B') order by l.id desc limit 1), v_r);
  for r in select * from (values
      ('carrier', null::text, null::text, null::text, null::date, null::date),
      ('carrier', '   ', null, null, null, null),
      ('carrier', repeat('ش', 61), null, null, null, null),
      ('carrier', 'شركة' || chr(7), null, null, null, null),
      ('tracking_number', 'بوسطة', repeat('9', 61), null, null, null),
      ('tracking_number', 'بوسطة', 'A' || chr(9) || 'B', null, null, null),
      ('tracking_url', 'بوسطة', null, 'http://track.example.com/x', null, null),
      ('tracking_url', 'بوسطة', null, 'javascript:alert(1)', null, null),
      ('tracking_url', 'بوسطة', null, 'https://', null, null),
      ('tracking_url', 'بوسطة', null, 'https://nodot/x', null, null),
      ('tracking_url', 'بوسطة', null, 'https://track.example.com/a b', null, null),
      ('tracking_url', 'بوسطة', null, 'HTTPS://track.example.com/x', null, null),
      ('tracking_url', 'بوسطة', null, 'https://track.example.com/' || repeat('x', 280), null, null),
      ('shipped_on', 'بوسطة', null, null, (pg_catalog.now() at time zone 'Africa/Cairo')::date - 1, null),
      ('shipped_on', 'بوسطة', null, null, (pg_catalog.now() at time zone 'Africa/Cairo')::date + 1, null),
      ('expected_on', 'بوسطة', null, null, (pg_catalog.now() at time zone 'Africa/Cairo')::date,
                      (pg_catalog.now() at time zone 'Africa/Cairo')::date - 1),
      ('expected_on', 'بوسطة', null, null, null, (pg_catalog.now() at time zone 'Africa/Cairo')::date + 400)) t(f, c, n, u, s, e) loop
    v_r := pg_temp.ship('admin', 'B', pg_temp.sver('B'), r.c, r.n, r.u, r.s, r.e);
    if v_r is distinct from 'ERR 45433 ' || r.f then v_bad := v_bad || r.f || ' -> ' || v_r || ' ; '; end if;
  end loop;
  perform pg_temp.zt('F15 validation by field -> 45433 + the field (carrier · tracking_number · tracking_url · shipped_on · expected_on), nothing written',
    v_bad = '' and pg_temp.slog('B') = 2, v_bad);
  v_r := pg_temp.ship('admin', 'I', 'null', 'شركة التجهيز', null, 'https://a.example.com', pg_temp.today(), null);
  v_r2 := pg_temp.ship('owner', 'E', 'null', 'شركة التسليم', 'E-1', null, null, null);
  perform pg_temp.zt('F16 allowed in preparing (admin) and delivered (owner) · statuses unchanged',
    pg_temp.js(v_r) ->> 'changed' = 'true' and pg_temp.js(v_r2) ->> 'changed' = 'true'
    and (select o.status from public.orders o where o.order_number = pg_temp.num('I')) = 'preparing'
    and (select o.status from public.orders o where o.order_number = pg_temp.num('E')) = 'delivered', v_r || ' | ' || v_r2);
  v_r := pg_temp.tr('I', 'shipped', null);
  perform pg_temp.zt('F17 status change keeps the shipment as is (I preparing -> shipped) · shipped order D without a shipment stays without one',
    v_r like '{%' and pg_temp.slog('I') = 1
    and (select s.carrier from public.zell_order_shipments s where s.order_id = pg_temp.oid_of('I')) = 'شركة التجهيز'
    and not exists (select 1 from public.zell_order_shipments s where s.order_id = pg_temp.oid_of('D'))
    and pg_temp.track('D') -> 'shipment' = 'null'::jsonb, v_r);
  declare
    e1 text; e2 text; e3 text; e4 text; e5 text;
  begin
    begin delete from public.zell_order_shipments; e1 := 'none'; exception when others then e1 := sqlstate; end;
    begin truncate public.zell_order_shipments; e2 := 'none'; exception when others then e2 := sqlstate; end;
    begin update public.zell_order_shipments_log set actor = actor; e3 := 'none'; exception when others then e3 := sqlstate; end;
    begin delete from public.zell_order_shipments_log; e4 := 'none'; exception when others then e4 := sqlstate; end;
    begin truncate public.zell_order_shipments_log; e5 := 'none'; exception when others then e5 := sqlstate; end;
    perform pg_temp.zt('F18 shipments: no DELETE / TRUNCATE · log: no UPDATE / DELETE / TRUNCATE (45413)',
      e1 = '45413' and e2 = '45413' and e3 = '45413' and e4 = '45413' and e5 = '45413',
      e1 || ',' || e2 || ',' || e3 || ',' || e4 || ',' || e5);
  end;
exception when others then
  perform pg_temp.zt('ABORT_B block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zB$;

-- C) رسايل العميل
do $zC$
declare
  v_r text;
  v_r2 text;
  v_id bigint;
  v_id2 bigint;
  v_bad text := '';
  v_n bigint;
  r record;
begin
  v_n := pg_temp.ulog();
  v_r := pg_temp.uadd('admin', 'A', E'  أهلًا\r\nطلبك في المراجعة  ');
  v_id := (pg_temp.js(v_r) ->> 'id')::bigint;
  perform pg_temp.zt('F20 add (admin): NFC + CRLF -> LF + trim, visible, not edited, one log row "add" (actor admin) in the same call',
    pg_temp.js(v_r) ->> 'changed' = 'true'
    and (select u.text = E'أهلًا\nطلبك في المراجعة' and not u.hidden and not u.edited and u.created_by = pg_temp.admin_id()::uuid
           from public.zell_order_customer_updates u where u.id = v_id)
    and pg_temp.ulog() = v_n + 1
    and (select l.action = 'add' and l.old_value is null and l.actor = pg_temp.admin_id()::uuid
           from public.zell_order_customer_updates_log l where l.update_id = v_id)
    and pg_catalog.jsonb_array_length(pg_temp.js(v_r) -> 'updates') = 1, v_r);
  for r in select * from (values (null::text), (''), ('   '), (repeat('ر', 301)), ('رسالة' || chr(1)), ('رسالة' || chr(9) || 'تاب')) t(x) loop
    v_r := pg_temp.uadd('admin', 'A', r.x);
    if v_r is distinct from 'ERR 45434 text' then v_bad := v_bad || coalesce(left(r.x, 10), 'null') || ' -> ' || v_r || ' ; '; end if;
  end loop;
  v_r := pg_temp.uadd('owner', 'A', repeat('ر', 300));
  v_id2 := (pg_temp.js(v_r) ->> 'id')::bigint;
  perform pg_temp.zt('F21 text validation -> 45434 text (null · empty · spaces · 301 · control characters), nothing written · 300 accepted (owner)',
    v_bad = '' and v_id2 is not null and pg_temp.ulog() = v_n + 2, v_bad || ' ' || left(v_r, 80));
  v_r := pg_temp.uedit('admin', 'A', v_id, quote_literal('2000-01-01') || '::timestamptz', 'نص جديد');
  v_r2 := pg_temp.uedit('admin', 'A', v_id, 'null', 'نص جديد');
  perform pg_temp.zt('F22 edit with a stale / null version -> 45404, nothing written',
    v_r = 'ERR 45404' and v_r2 = 'ERR 45404' and pg_temp.ulog() = v_n + 2, v_r || ' | ' || v_r2);
  v_r := pg_temp.uedit('admin', 'A', v_id, pg_temp.uver(v_id), '  طلبك اتراجع وجاهز للتأكيد  ');
  v_r2 := pg_temp.uedit('owner', 'A', v_id, pg_temp.uver(v_id), 'طلبك اتراجع وجاهز للتأكيد');
  perform pg_temp.zt('F23 edit: new text -> edited, log "edit" with old / new text · same text -> changed false, no log row',
    pg_temp.js(v_r) ->> 'changed' = 'true' and pg_temp.js(v_r2) ->> 'changed' = 'false'
    and (select u.text = 'طلبك اتراجع وجاهز للتأكيد' and u.edited from public.zell_order_customer_updates u where u.id = v_id)
    and (select l.old_value ->> 'text' = E'أهلًا\nطلبك في المراجعة' and l.new_value ->> 'text' = 'طلبك اتراجع وجاهز للتأكيد'
           from public.zell_order_customer_updates_log l where l.update_id = v_id and l.action = 'edit')
    and pg_temp.ulog() = v_n + 3, v_r || ' | ' || v_r2);
  v_r := pg_temp.uedit('admin', 'B', v_id, pg_temp.uver(v_id), 'نص');
  v_r2 := pg_temp.uhide('admin', 'A', 999999999, 'now()', true);
  perform pg_temp.zt('F24 update of another order / unknown id -> 45403', v_r = 'ERR 45403' and v_r2 = 'ERR 45403', v_r || ' | ' || v_r2);
  v_r := pg_temp.uhide('admin', 'A', v_id2, pg_temp.uver(v_id2), null);
  perform pg_temp.zt('F25 hide: null -> 45434 hidden', v_r = 'ERR 45434 hidden' and pg_temp.ulog() = v_n + 3, v_r);
  v_r := pg_temp.uhide('admin', 'A', v_id2, pg_temp.uver(v_id2), true);
  v_r2 := pg_temp.uhide('admin', 'A', v_id2, pg_temp.uver(v_id2), true);
  perform pg_temp.zt('F26 hide -> hidden + log "hide" · hide again -> changed false, no log row · the track response drops it',
    pg_temp.js(v_r) ->> 'changed' = 'true' and pg_temp.js(v_r2) ->> 'changed' = 'false'
    and (select u.hidden from public.zell_order_customer_updates u where u.id = v_id2)
    and pg_temp.ulog() = v_n + 4
    and pg_catalog.jsonb_array_length(pg_temp.track('A') -> 'updates') = 1
    and pg_catalog.strpos(pg_temp.track('A')::text, repeat('ر', 300)) = 0, v_r || ' | ' || v_r2);
  v_r := pg_temp.uhide('owner', 'A', v_id2, pg_temp.uver(v_id2), false);
  perform pg_temp.zt('F27 show (owner) -> visible + log "show"; log actions = add,add,edit,hide,show',
    pg_temp.js(v_r) ->> 'changed' = 'true'
    and not (select u.hidden from public.zell_order_customer_updates u where u.id = v_id2)
    and (select pg_catalog.string_agg(l.action, ',' order by l.id) from public.zell_order_customer_updates_log l
          where l.order_id = pg_temp.oid_of('A')) = 'add,add,edit,hide,show', v_r);
  v_r := pg_temp.uadd('admin', 'C', 'تم إلغاء طلبك') || '|' || pg_temp.uadd('admin', 'F', 'تم رفض الاستلام') || '|'
         || pg_temp.uadd('owner', 'E', 'وصل طلبك');
  perform pg_temp.zt('F28 add allowed in cancelled / refused / delivered', v_r !~ 'ERR', left(v_r, 200));
  for i in 1 .. 48 loop
    perform pg_temp.must(pg_temp.uadd('admin', 'G', 'رسالة رقم ' || i));
  end loop;
  v_r := pg_temp.uadd('admin', 'G', 'رسالة 49');
  v_r2 := pg_temp.uadd('admin', 'G', 'رسالة 50');
  v_n := pg_temp.ulog();
  perform pg_temp.zt('F29 50 updates per order: the 50th accepted, the 51st -> 45434 count, nothing written',
    v_r like '{%' and v_r2 like '{%' and pg_temp.uadd('admin', 'G', 'رسالة 51') = 'ERR 45434 count'
    and (select count(*) from public.zell_order_customer_updates u where u.order_id = pg_temp.oid_of('G')) = 50
    and pg_temp.ulog() = v_n, left(v_r2, 80));
  declare
    e1 text; e2 text; e3 text; e4 text; e5 text;
  begin
    begin delete from public.zell_order_customer_updates; e1 := 'none'; exception when others then e1 := sqlstate; end;
    begin truncate public.zell_order_customer_updates; e2 := 'none'; exception when others then e2 := sqlstate; end;
    begin update public.zell_order_customer_updates_log set actor = actor; e3 := 'none'; exception when others then e3 := sqlstate; end;
    begin delete from public.zell_order_customer_updates_log; e4 := 'none'; exception when others then e4 := sqlstate; end;
    begin truncate public.zell_order_customer_updates_log; e5 := 'none'; exception when others then e5 := sqlstate; end;
    perform pg_temp.zt('F30 updates: no DELETE / TRUNCATE · log: no UPDATE / DELETE / TRUNCATE (45413)',
      e1 = '45413' and e2 = '45413' and e3 = '45413' and e4 = '45413' and e5 = '45413',
      e1 || ',' || e2 || ',' || e3 || ',' || e4 || ',' || e5);
  end;
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

-- D) رد التتبّع v2
do $zD$
declare
  v_bad text := '';
  v_r jsonb;
  r record;
begin
  for r in select z.tag, z.num from pg_temp.zt_orders z order by z.tag loop
    v_r := pg_temp.track(r.tag);
    if v_r is null
       or (v_r - array['customer', 'history', 'money', 'shipping', 'confirmed_delivery', 'shipment', 'updates']) is distinct from pg_temp.track_v1(r.num)
       or (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_r) k)
          is distinct from array['confirmed_delivery', 'created_at', 'customer', 'delivery', 'history', 'items', 'money', 'order_number',
                                 'shipment', 'shipping', 'status', 'total_piastres', 'updates'] then
      v_bad := v_bad || r.tag || ' ';
    end if;
  end loop;
  perform pg_temp.zt('F40 every order: the v1 keys of the v2 response = the v1 function (TR W1 body) exactly · 13 keys', v_bad = '', v_bad);
  v_bad := '';
  for r in select * from (values ('A', 'new'), ('B', 'new,confirmed'), ('C', 'new,cancelled'), ('D', 'new,confirmed,shipped'),
                                 ('E', 'new,confirmed,preparing,shipped,delivered'), ('F', 'new,confirmed,preparing,shipped,refused'),
                                 ('I', 'new,confirmed,preparing,shipped'), ('H', 'new')) t(tag, h) loop
    v_r := pg_temp.track(r.tag);
    if pg_temp.statuses(v_r) is distinct from r.h
       or exists (select 1 from pg_catalog.jsonb_array_elements(v_r -> 'history') e(v)
                   where (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(e.v) k) is distinct from array['at', 'status']
                      or pg_catalog.jsonb_typeof(e.v -> 'at') <> 'string') then
      v_bad := v_bad || r.tag || '=' || pg_temp.statuses(v_r) || ' ';
    end if;
  end loop;
  perform pg_temp.zt('F41 history = created + every status change, in order, {status, at} only (no reason, no actor)', v_bad = '', v_bad);
  v_bad := '';
  for r in select z.tag, o.* from pg_temp.zt_orders z join public.orders o on o.order_number = z.num loop
    v_r := pg_temp.track(r.tag) -> 'money';
    if v_r is distinct from pg_catalog.jsonb_build_object(
         'items_piastres', r.subtotal_piastres, 'discount_piastres', r.discount_piastres, 'shipping_piastres', r.shipping_piastres,
         'installation_piastres', r.installation_piastres, 'travel_piastres', r.installation_travel_piastres,
         'total_piastres', r.total_piastres, 'confirmation_fee_piastres', r.confirmation_fee_piastres,
         'paid_piastres', coalesce((select sum(p.amount_piastres) from public.order_payments p where p.order_id = r.id and p.kind = 'payment'), 0),
         'refunded_piastres', coalesce((select sum(p.amount_piastres) from public.order_payments p where p.order_id = r.id and p.kind = 'refund'), 0),
         'net_paid_piastres', r.paid_piastres, 'remaining_piastres', greatest(r.total_piastres - r.paid_piastres, 0))
       or (v_r ->> 'net_paid_piastres')::bigint <> (v_r ->> 'paid_piastres')::bigint - (v_r ->> 'refunded_piastres')::bigint then
      v_bad := v_bad || r.tag || ' ';
    end if;
  end loop;
  perform pg_temp.zt('F42 money = the order columns + payment sums for every order; net = paid - refunded = orders.paid_piastres',
    v_bad = ''
    and pg_temp.track('D') -> 'money' ->> 'paid_piastres' = '10000' and pg_temp.track('D') -> 'money' ->> 'refunded_piastres' = '3000'
    and pg_temp.track('D') -> 'money' ->> 'net_paid_piastres' = '7000'
    and pg_temp.track('E') -> 'money' ->> 'remaining_piastres' = '0'
    and pg_temp.track('F') -> 'money' ->> 'net_paid_piastres' = '15000'
    and (pg_temp.track('A') -> 'money' ->> 'discount_piastres')::integer > 0, v_bad);
  perform pg_temp.zt('F43 shipping snapshot: express {express, 1, 1} · standard with the Cairo days {standard, 2, 4} · old order null',
    pg_temp.track('G') -> 'shipping' = '{"method": "express", "days_min": 1, "days_max": 1}'::jsonb
    and pg_temp.track('A') -> 'shipping' = '{"method": "standard", "days_min": 2, "days_max": 4}'::jsonb
    and pg_temp.track('H') -> 'shipping' = 'null'::jsonb, (pg_temp.track('G') -> 'shipping')::text);
  perform pg_temp.zt('F44 confirmed_delivery {date, period} for B (v1 delivery = confirmed too) · null for A',
    pg_temp.track('B') -> 'confirmed_delivery'
      = pg_catalog.jsonb_build_object('date', pg_catalog.to_char(pg_temp.today() + 2, 'YYYY-MM-DD'), 'period', 'noon')
    and pg_temp.track('B') -> 'delivery' ->> 'kind' = 'confirmed'
    and pg_temp.track('A') -> 'confirmed_delivery' = 'null'::jsonb, (pg_temp.track('B') -> 'confirmed_delivery')::text);
  perform pg_temp.zt('F45 shipment: the 5 customer keys only (no updated_at / actor) · values = the row · null without one',
    pg_temp.track('B') -> 'shipment'
      = pg_catalog.jsonb_build_object('carrier', 'بوسطة', 'tracking_number', null, 'tracking_url', null, 'shipped_on', null,
                                      'expected_on', pg_catalog.to_char(pg_temp.today() + 5, 'YYYY-MM-DD'))
    and pg_temp.track('I') -> 'shipment' ->> 'tracking_url' = 'https://a.example.com'
    and pg_temp.track('A') -> 'shipment' = 'null'::jsonb, (pg_temp.track('B') -> 'shipment')::text);
  v_r := pg_temp.track('A') -> 'updates';
  perform pg_temp.zt('F46 updates: visible only, newest first, {at, edited, id, text}, edited flag (no old text, no hidden ones)',
    pg_catalog.jsonb_array_length(v_r) = 2
    and (v_r -> 0 ->> 'text') = repeat('ر', 300) and (v_r -> 0 -> 'edited') = 'false'::jsonb
    and (v_r -> 1 ->> 'text') = 'طلبك اتراجع وجاهز للتأكيد' and (v_r -> 1 -> 'edited') = 'true'::jsonb
    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_r) e(v)
                     where (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(e.v) k)
                           is distinct from array['at', 'edited', 'id', 'text'])
    and pg_catalog.strpos(pg_temp.track('A')::text, 'أهلًا') = 0
    and pg_catalog.jsonb_array_length(pg_temp.track('G') -> 'updates') = 50, left(v_r::text, 200));
  v_bad := '';
  for r in select z.tag from pg_temp.zt_orders z loop
    v_r := pg_temp.track(r.tag);
    if v_r::text ~ '"(reason|actor|internal_notes|notes|note|reference|coupon_code|coupon_id|method_name|method_id|idempotency_key|request_hash|receipt_token_hash|checkout_session_hash|updated_by|created_by|hidden|paid_after_piastres)":'
       or v_r::text ~ '(سرية|سبب|REF-SECRET|PCT10|كاش|00000000-0000-0000-0000-00000000000)' then
      v_bad := v_bad || r.tag || ' ';
    end if;
  end loop;
  perform pg_temp.zt('F47 no leaks in any response: internal / customer / appointment notes · reasons · payment references, notes and method · coupon code · actors · hashes',
    v_bad = '', v_bad);
  perform pg_temp.zt('F48 wrong shape -> null (lower case · no FLM- · leading space · bad letter) · v1 behaviour kept',
    pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', lower(pg_temp.num('A')))) = 'null'
    and pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', substr(pg_temp.num('A'), 5))) = 'null'
    and pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', ' ' || pg_temp.num('A'))) = 'null'
    and pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order(''FLM-ABCDE0'')::text') = 'null', null);
exception when others then
  perform pg_temp.zt('ABORT_D block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zD$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 34 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
