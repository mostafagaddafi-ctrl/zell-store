-- 0021-A P1 — سيناريوهات الدفعات بعد التطبيق (CI بس — الحاوية المؤقتة). معاملة واحدة بترجع في الآخر.
--
-- • بعد 0021a_p1_payments.sql على shim الـ CI: مالك ...0a وأدمن ...0b شغالين. البوابة مقفولة في الأول (A1 الافتراضي)،
--   وبتتفتح بدالة المالك قبل سيناريو التجهيز.
-- • النتيجة صفوف في SELECT واحد: 1 ord · 2 kind · 3 test_id · 4 test_name · 5 outcome · 6 detail · 7 pass · 8 fail · 9 verdict.
-- • F5 (مراجعة 7abbbd4): البصمة بعد التطبيع لـ zell_payment_record و zell_payment_deliver_order.
-- • F6 (مراجعة #122): جدول الأوامر — التسليمات التلاتة · الإعادة باللقطة الأصلية حتى لو الطلب اتغيّر · أي اختلاف 45425 ·
--   الفشل مابيسيبش أمر · مفيش وصول مباشر. F42 في الآخر: كل دفعة ليها أمرها.

begin;
set local idle_in_transaction_session_timeout = '60s';

do $zguard$
begin
  if pg_catalog.current_database() <> 'zell_ci' then
    raise exception 'ZELL_0021A_P1_FLOWS_CI_ONLY';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zt_seq (n integer) on commit drop;
insert into zt_seq values (0);

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values ('ABORT_' || p_block, 'ABORT_' || p_block || ' block raised an unexpected error', 'fail',
          left(coalesce(p_state, '') || ' ' || coalesce(p_message, ''), 400));
$f$;

create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated')
returns jsonb language plpgsql as $f$
declare
  r jsonb;
  v_detail text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    execute 'set local role ' || quote_ident(p_db_role);
    execute p_sql into r;
    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claims', '', true);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('_error', sqlstate, '_message', left(sqlerrm, 200), '_detail', v_detail);
  end;
  return coalesce(r, 'null'::jsonb);
end
$f$;

create function pg_temp.try_exec(p_sql text, p_db_role text default 'postgres')
returns text language plpgsql as $f$
begin
  begin
    execute 'set local role ' || quote_ident(p_db_role);
    execute p_sql;
    execute 'reset role';
  exception when others then
    return sqlstate;
  end;
  return 'ok';
end
$f$;

create function pg_temp.owner_c() returns text language sql as $f$
  select jsonb_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text;
$f$;
create function pg_temp.admin_c() returns text language sql as $f$
  select jsonb_build_object('sub', '00000000-0000-0000-0000-00000000000b', 'role', 'authenticated')::text;
$f$;
create function pg_temp.ver(p_order integer) returns text language sql as $f$
  select quote_literal(o.updated_at::text) || '::timestamptz' from public.orders o where o.id = p_order;
$f$;
create function pg_temp.sver() returns text language sql as $f$
  select quote_literal(s.updated_at::text) || '::timestamptz' from public.zell_payment_settings s where s.id;
$f$;
create function pg_temp.mid(p_name text) returns integer language sql as $f$
  select m.id from public.zell_payment_methods m where m.name = p_name;
$f$;
create function pg_temp.mver(p_id integer) returns text language sql as $f$
  select quote_literal(m.updated_at::text) || '::timestamptz' from public.zell_payment_methods m where m.id = p_id;
$f$;
create function pg_temp.cmd(p_n integer) returns text language sql as $f$
  select quote_literal('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0')) || '::uuid';
$f$;
create function pg_temp.cid(p_n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$f$;
-- إعادة تسليم بنسخة قديمة (الإعادة لازم تتفحص قبل النسخة).
create function pg_temp.redeliver(p_who text, p_cmd integer, p_order integer, p_amount integer, p_method text, p_credit boolean)
returns jsonb language sql as $f$
  select pg_temp.as_user(case p_who when 'owner' then pg_temp.owner_c() else pg_temp.admin_c() end,
    format('select public.zell_payment_deliver_order(p_command_id => %s, p_order_id => %s, p_expected_updated_at => %L::timestamptz, '
           || 'p_amount_piastres => %s, p_method_id => %s, p_on_credit => %L::boolean)',
           pg_temp.cmd(p_cmd), p_order, '2000-01-01', coalesce(p_amount::text, 'null'),
           coalesce(pg_temp.mid(p_method)::text, 'null'), p_credit));
$f$;
-- إعادة دفعة بنسخة قديمة.
create function pg_temp.repay(p_cmd integer, p_order integer, p_amount integer, p_purpose text, p_method text)
returns jsonb language sql as $f$
  select pg_temp.as_user(pg_temp.admin_c(),
    format('select public.zell_payment_record(%s, %s, %L::timestamptz, %s, %L, %s)',
           pg_temp.cmd(p_cmd), p_order, '2000-01-01', p_amount, p_purpose, pg_temp.mid(p_method)));
$f$;
-- طلب تجربة مباشر (postgres) بإجمالي ورسوم معينين.
create function pg_temp.mk(p_total integer, p_fee integer) returns integer language plpgsql as $f$
declare
  v_n integer;
  v_id integer;
begin
  update pg_temp.zt_seq set n = n + 1 returning n into v_n;
  insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres,
                             total_piastres, confirmation_fee_piastres)
  values ('FLW-' || lpad(v_n::text, 6, '0'), 'زبون سيناريو', '0105' || lpad(v_n::text, 7, '0'), 'القاهرة', 'عنوان سيناريو طويل كفاية',
          p_total, 0, p_total, p_fee)
  returning id into v_id;
  return v_id;
end
$f$;
create function pg_temp.pay(p_who text, p_fn text, p_cmd integer, p_order integer, p_amount integer, p_purpose text,
                            p_method text, p_other text default null, p_ref text default null)
returns jsonb language sql as $f$
  select pg_temp.as_user(case p_who when 'owner' then pg_temp.owner_c() when 'admin' then pg_temp.admin_c() else '' end,
    format('select public.%s(%s, %s, %s, %s, %L, %s, %L, %L)', p_fn, pg_temp.cmd(p_cmd), p_order, pg_temp.ver(p_order),
           coalesce(p_amount::text, 'null'), p_purpose, coalesce(pg_temp.mid(p_method)::text, 'null'), p_other, p_ref));
$f$;
create function pg_temp.tr(p_who text, p_order integer, p_to text) returns jsonb language sql as $f$
  select pg_temp.as_user(case p_who when 'owner' then pg_temp.owner_c() else pg_temp.admin_c() end,
    format('select public.zell_order_transition(%s, %s, %L)', p_order, pg_temp.ver(p_order), p_to));
$f$;
create function pg_temp.deliver(p_cmd integer, p_order integer, p_amount integer, p_method text, p_credit boolean)
returns jsonb language sql as $f$
  select pg_temp.as_user(pg_temp.admin_c(),
    format('select public.zell_payment_deliver_order(p_command_id => %s, p_order_id => %s, p_expected_updated_at => %s, '
           || 'p_amount_piastres => %s, p_method_id => %s, p_on_credit => %L::boolean)',
           pg_temp.cmd(p_cmd), p_order, pg_temp.ver(p_order), coalesce(p_amount::text, 'null'),
           coalesce(pg_temp.mid(p_method)::text, 'null'), p_credit));
$f$;
create function pg_temp.paid(p_order integer) returns integer language sql as $f$
  select o.paid_piastres from public.orders o where o.id = p_order;
$f$;
create function pg_temp.st(p_order integer) returns text language sql as $f$
  select o.status from public.orders o where o.id = p_order;
$f$;

-- ── F1: تسجيل الدفعات والرد و idempotency ──
do $zF1$
declare
  a integer := pg_temp.mk(35000, 5000);
  r jsonb;
  r2 jsonb;
  v_bad text := '';
begin
  r := pg_temp.pay('', 'zell_payment_record', 1, a, 5000, 'confirmation_fee', 'كاش');
  perform pg_temp.zt('F01 no session -> 45400; anon / service_role -> 42501',
    r ->> '_error' = '45400'
    and pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, now(), 1, %L, 1)', pg_temp.cmd(1), a, 'balance'), 'anon') ->> '_error' = '42501'
    and pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, now(), 1, %L, 1)', pg_temp.cmd(1), a, 'balance'), 'service_role') ->> '_error' = '42501',
    r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 2, a, 5000, 'confirmation_fee', 'كاش', null, 'TX-1');
  perform pg_temp.zt('F02 admin records the confirmation fee: paid 5000, partial, fee_due 0, event payment_recorded',
    (r ->> 'paid_piastres')::integer = 5000 and r ->> 'payment_status' = 'partial' and (r ->> 'fee_due_piastres')::integer = 0
    and (r ->> 'remaining_piastres')::integer = 30000 and not (r ->> 'replay')::boolean
    and (select count(*) from public.order_events e where e.order_id = a and e.kind = 'payment_recorded') = 1, r::text);
  r2 := pg_temp.pay('admin', 'zell_payment_record', 2, a, 5000, 'confirmation_fee', 'كاش', null, 'TX-1');
  perform pg_temp.zt('F03 same command + same meaning -> replay, nothing new',
    (r2 ->> 'replay')::boolean and r2 ->> 'payment_id' = r ->> 'payment_id' and pg_temp.paid(a) = 5000
    and (select count(*) from public.order_payments p where p.order_id = a) = 1, r2::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 2, a, 6000, 'confirmation_fee', 'كاش', null, 'TX-1');
  perform pg_temp.zt('F04 same command + different meaning -> 45425', r ->> '_error' = '45425', r::text);
  r := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, %L::timestamptz, 100, %L, %s)',
         pg_temp.cmd(3), a, '2000-01-01', 'balance', pg_temp.mid('كاش')));
  perform pg_temp.zt('F05 stale version (new command) -> 45404', r ->> '_error' = '45404', r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 4, a, 30001, 'balance', 'كاش');
  perform pg_temp.zt('F06 net paid above total -> 45423', r ->> '_error' = '45423', r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 5, a, 0, 'balance', 'كاش');
  if r ->> '_detail' is distinct from 'amount_piastres' then v_bad := v_bad || 'amount '; end if;
  r := pg_temp.pay('admin', 'zell_payment_record', 5, a, 100, 'tip', 'كاش');
  if r ->> '_detail' is distinct from 'purpose' then v_bad := v_bad || 'purpose '; end if;
  r := pg_temp.pay('admin', 'zell_payment_record', 5, a, 100, 'balance', 'كاش', 'برضه نقدي');
  if r ->> '_detail' is distinct from 'method' then v_bad := v_bad || 'both '; end if;
  r := pg_temp.pay('admin', 'zell_payment_record', 5, a, 100, 'balance', null, '   ');
  if r ->> '_detail' is distinct from 'method' then v_bad := v_bad || 'neither '; end if;
  r := pg_temp.pay('admin', 'zell_payment_record', 5, a, 100, 'balance', 'كاش', null, repeat('r', 101));
  if r ->> '_detail' is distinct from 'reference' then v_bad := v_bad || 'reference '; end if;
  perform pg_temp.zt('F07 input checks -> 45416 with the field (amount, purpose, method both/neither, reference > 100)',
    v_bad = '' and pg_temp.paid(a) = 5000, v_bad);
  r := pg_temp.pay('admin', 'zell_payment_record', 6, a, 1000, 'balance', null, '  محفظة تانية  ');
  perform pg_temp.zt('F08 «other» method: free text snapshot, method_is_other',
    (r ->> 'paid_piastres')::integer = 6000
    and exists (select 1 from public.order_payments p where p.order_id = a and p.method_is_other and p.method_id is null
                  and p.method_name = 'محفظة تانية'), r::text);
  r := pg_temp.pay('admin', 'zell_payment_refund', 7, a, 2000, 'balance', 'كاش');
  r2 := pg_temp.pay('owner', 'zell_payment_refund', 8, a, 2000, 'balance', 'كاش');
  perform pg_temp.zt('F09 refund: admin -> 45402, owner ok (paid 4000, has_refund, event payment_refunded)',
    r ->> '_error' = '45402' and (r2 ->> 'paid_piastres')::integer = 4000 and (r2 ->> 'has_refund')::boolean
    and (r2 ->> 'refunded_piastres')::integer = 2000
    and (select count(*) from public.order_events e where e.order_id = a and e.kind = 'payment_refunded') = 1, r::text || r2::text);
  r := pg_temp.pay('owner', 'zell_payment_refund', 9, a, 4001, 'balance', 'كاش');
  perform pg_temp.zt('F10 refund above paid -> 45424', r ->> '_error' = '45424' and pg_temp.paid(a) = 4000, r::text);
exception when others then
  perform pg_temp.zt_block_fail('F1', sqlstate, sqlerrm);
end
$zF1$;

-- ── F2: المقدم قبل التأكيد (قرار ٢) والتسليم بالباقي (قرار ٤) — البوابة مقفولة ──
do $zF2$
declare
  b integer := pg_temp.mk(40000, 5000);
  c integer := pg_temp.mk(30000, 0);
  r jsonb;
  r2 jsonb;
  v_paid integer;
begin
  r := pg_temp.tr('admin', b, 'confirmed');
  r2 := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_order_record_call(%s, %s, %L)', b, pg_temp.ver(b), 'confirmed'));
  perform pg_temp.zt('F11 fee required and unpaid: transition / call result «confirmed» -> 45419',
    r ->> '_error' = '45419' and r2 ->> '_error' = '45419' and pg_temp.st(b) = 'new', r::text || r2::text);
  r := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_order_record_call(%s, %s, %L)', b, pg_temp.ver(b), 'agreed_awaiting_deposit'));
  perform pg_temp.zt('F12 «agreed — awaiting deposit» allowed, status stays new', r ->> 'status' = 'new', r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 20, b, 4999, 'confirmation_fee', 'فودافون كاش');
  r := pg_temp.tr('admin', b, 'confirmed');
  r2 := pg_temp.pay('admin', 'zell_payment_record', 21, b, 1, 'confirmation_fee', 'فودافون كاش');
  r2 := pg_temp.tr('admin', b, 'confirmed');
  perform pg_temp.zt('F13 4999 of 5000 -> still 45419; full fee -> confirmed',
    r ->> '_error' = '45419' and r2 ->> 'status' = 'confirmed', r::text || r2::text);
  r := pg_temp.tr('admin', c, 'confirmed');
  perform pg_temp.zt('F14 no fee on the order -> confirmed without any payment', r ->> 'status' = 'confirmed', r::text);
  r := pg_temp.tr('admin', b, 'shipped');
  r := pg_temp.tr('admin', b, 'delivered');
  r2 := pg_temp.deliver(30, b, null, null, false);
  perform pg_temp.zt('F15 shipped with 35000 left: transition delivered -> 45420; deliver without collection -> 45420',
    r ->> '_error' = '45420' and r2 ->> '_error' = '45420' and pg_temp.st(b) = 'shipped', r::text || r2::text);
  r := pg_temp.deliver(31, b, null, null, true);
  perform pg_temp.zt('F16 on credit while credit is disabled -> 45421', r ->> '_error' = '45421', r::text);
  v_paid := pg_temp.paid(b);
  r := pg_temp.deliver(32, b, 1000, 'كاش', false);
  perform pg_temp.zt('F17 partial collection at delivery -> 45420, and the payment is rolled back too',
    r ->> '_error' = '45420' and pg_temp.paid(b) = v_paid and pg_temp.st(b) = 'shipped'
    and not exists (select 1 from public.order_payments p where p.command_id = '00000000-0000-4000-8000-000000000032'), r::text);
  r := pg_temp.deliver(33, b, 35000, 'كاش', false);
  perform pg_temp.zt('F18 full collection in the same call -> delivered, paid = total, «paid»',
    r ->> 'status' = 'delivered' and (r ->> 'remaining_piastres')::integer = 0 and r ->> 'payment_status' = 'paid'
    and (select string_agg(e.kind, ',' order by e.id) from (select * from public.order_events e2 where e2.order_id = b order by e2.id desc limit 2) e)
        = 'payment_recorded,status_changed', r::text);
  r2 := pg_temp.as_user(pg_temp.admin_c(),
          format('select public.zell_payment_deliver_order(p_command_id => %s, p_order_id => %s, p_expected_updated_at => %L::timestamptz, '
                 || 'p_amount_piastres => 35000, p_method_id => %s, p_on_credit => false)', pg_temp.cmd(33), b, '2000-01-01', pg_temp.mid('كاش')));
  perform pg_temp.zt('F19 delivery replay (same command) -> same result, nothing new',
    (r2 ->> 'replay')::boolean and (select count(*) from public.order_payments p where p.order_id = b) = 3, r2::text);
exception when others then
  perform pg_temp.zt_block_fail('F2', sqlstate, sqlerrm);
end
$zF2$;

-- ── F3: الآجل الصريح، والطلب الملغي، والحراس ──
do $zF3$
declare
  d integer := pg_temp.mk(20000, 0);
  e integer := pg_temp.mk(10000, 0);
  r jsonb;
  r2 jsonb;
begin
  perform pg_temp.tr('admin', d, 'confirmed');
  perform pg_temp.tr('admin', d, 'shipped');
  r := pg_temp.as_user(pg_temp.owner_c(), format('select public.zell_payment_save_settings(%s, %L::jsonb, true)', pg_temp.sver(), '{"enabled": false}'));
  r2 := pg_temp.tr('admin', d, 'delivered');
  perform pg_temp.zt('F20 credit enabled: plain transition to delivered still -> 45420 (needs the explicit choice)',
    (r ->> 'customer_credit_enabled')::boolean and r2 ->> '_error' = '45420', r::text || r2::text);
  r := pg_temp.deliver(40, d, null, null, true);
  perform pg_temp.zt('F21 explicit on-credit delivery -> delivered with 20000 still shown, event reason «تسليم آجل»',
    r ->> 'status' = 'delivered' and (r ->> 'remaining_piastres')::integer = 20000 and (r ->> 'on_credit')::boolean
    and exists (select 1 from public.order_events x where x.order_id = d and x.kind = 'status_changed' and x.payload ->> 'reason' = 'تسليم آجل'), r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 41, d, 20000, 'balance', 'إنستاباي');
  perform pg_temp.zt('F22 collecting later on a delivered order -> paid', r ->> 'payment_status' = 'paid', r::text);
  r := pg_temp.pay('admin', 'zell_payment_record', 42, e, 1000, 'confirmation_fee', 'كاش');
  perform pg_temp.tr('admin', e, 'cancelled');
  r := pg_temp.pay('admin', 'zell_payment_record', 43, e, 1000, 'balance', 'كاش');
  r2 := pg_temp.pay('owner', 'zell_payment_refund', 44, e, 1000, 'confirmation_fee', 'كاش');
  perform pg_temp.zt('F23 cancelled: new payment -> 45422; owner refund of the paid amount -> paid 0',
    pg_temp.st(e) = 'cancelled' and r ->> '_error' = '45422' and (r2 ->> 'paid_piastres')::integer = 0
    and r2 ->> 'payment_status' = 'unpaid' and (r2 ->> 'has_refund')::boolean, r::text || r2::text);
  perform pg_temp.zt('F24 direct writes: paid / fee UPDATE -> 45418 (postgres, service_role); INSERT with paid -> 45418',
    pg_temp.try_exec(format('update public.orders set paid_piastres = paid_piastres where id = %s', d)) = 'ok'
    and pg_temp.try_exec(format('update public.orders set paid_piastres = 1 where id = %s', d)) = '45418'
    and pg_temp.try_exec(format('update public.orders set paid_piastres = 1 where id = %s', d), 'service_role') = '45418'
    and pg_temp.try_exec(format('update public.orders set confirmation_fee_piastres = 1 where id = %s', d), 'service_role') = '45418'
    and pg_temp.try_exec('insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, '
                         || 'total_piastres, paid_piastres) values (''FLW-BAD001'', ''x'', ''01000000000'', ''القاهرة'', ''عنوان'', 100, 100, 5)') = '45418',
    null);
  perform pg_temp.zt('F25 payments append-only: UPDATE / DELETE -> 45427 (even postgres); authenticated has no table access',
    pg_temp.try_exec('update public.order_payments set note = ''x''') = '45427'
    and pg_temp.try_exec('delete from public.order_payments') = '45427'
    and pg_temp.try_exec('select 1 from public.order_payments', 'authenticated') = '42501', null);
exception when others then
  perform pg_temp.zt_block_fail('F3', sqlstate, sqlerrm);
end
$zF3$;

-- ── F6: أوامر الدفع ولقطة النتيجة (مراجعة #122، Blocking 2). البوابة لسه مقفولة، والآجل متفعّل ──
do $zF6$
declare
  p integer := pg_temp.mk(20000, 0);   -- تسليم مع تحصيل
  q integer := pg_temp.mk(15000, 0);   -- مدفوع كامل قبل التسليم: تسليم من غير دفعة
  s integer := pg_temp.mk(18000, 0);   -- تسليم آجل صريح من غير دفعة
  t integer := pg_temp.mk(10000, 0);   -- دفعة وبعدها إلغاء
  u integer := pg_temp.mk(9000, 0);    -- محاولات فاشلة ماتسيبش أمر
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  x1 jsonb; x2 jsonb; x3 jsonb; x4 jsonb; x5 jsonb;
  v_cmds integer;
  v_pays integer;
begin
  update public.zell_payment_settings set customer_credit_enabled = true where id;
  perform pg_temp.tr('admin', p, 'confirmed');
  perform pg_temp.tr('admin', p, 'shipped');
  perform pg_temp.pay('admin', 'zell_payment_record', 601, q, 15000, 'balance', 'كاش');
  perform pg_temp.tr('admin', q, 'confirmed');
  perform pg_temp.tr('admin', q, 'shipped');
  perform pg_temp.tr('admin', s, 'confirmed');
  perform pg_temp.tr('admin', s, 'shipped');
  r1 := pg_temp.deliver(604, p, 20000, 'كاش', false);
  r2 := pg_temp.deliver(602, q, null, null, false);
  r3 := pg_temp.deliver(603, s, null, null, true);
  perform pg_temp.zt('F36 three deliveries (collection / already paid / explicit credit): delivered, one deliver command each, a payment row only with collection',
    r1 ->> 'status' = 'delivered' and (r1 ->> 'remaining_piastres')::integer = 0 and r1 ->> 'payment_id' is not null
    and r2 ->> 'status' = 'delivered' and r2 ->> 'payment_id' is null and not (r2 ->> 'on_credit')::boolean
    and r3 ->> 'status' = 'delivered' and (r3 ->> 'on_credit')::boolean and (r3 ->> 'remaining_piastres')::integer = 18000
    and r3 ->> 'payment_id' is null
    and (select count(*) from public.zell_payment_commands c
          where c.operation = 'deliver' and c.actor = '00000000-0000-0000-0000-00000000000b'
            and (c.command_id, c.order_id) in ((pg_temp.cid(604), p), (pg_temp.cid(602), q), (pg_temp.cid(603), s))) = 3
    and (select count(*) from public.zell_payment_commands c where c.command_id = pg_temp.cid(601) and c.operation = 'payment' and c.order_id = q) = 1
    and (select count(*) from public.order_payments x where x.order_id = q) = 1
    and (select count(*) from public.order_payments x where x.order_id = s) = 0
    and (select count(*) from public.order_payments x where x.order_id = p and x.command_id = pg_temp.cid(604)) = 1,
    r1::text || r2::text || r3::text);

  select count(*) into v_cmds from public.zell_payment_commands;
  select count(*) into v_pays from public.order_payments;
  x1 := pg_temp.redeliver('admin', 604, p, 20000, 'كاش', false);
  x2 := pg_temp.redeliver('admin', 602, q, null, null, false);
  x3 := pg_temp.redeliver('admin', 603, s, null, null, true);
  perform pg_temp.zt('F37 replay of each delivery (stale version) -> replay, the original result exactly, nothing new',
    (x1 ->> 'replay')::boolean and (x2 ->> 'replay')::boolean and (x3 ->> 'replay')::boolean
    and (x1 - 'replay') = (r1 - 'replay') and (x2 - 'replay') = (r2 - 'replay') and (x3 - 'replay') = (r3 - 'replay')
    and (select count(*) from public.zell_payment_commands) = v_cmds and (select count(*) from public.order_payments) = v_pays,
    x1::text || x2::text || x3::text);

  -- الطلب بيتغيّر بعد النجاح: دفعة متأخرة على الآجل · الحالة اتحرّكت (تعديل مباشر، البوابة مقفولة) · دفعة وبعدها إلغاء.
  perform pg_temp.pay('admin', 'zell_payment_record', 605, s, 18000, 'balance', 'كاش');
  x3 := pg_temp.redeliver('admin', 603, s, null, null, true);
  x4 := to_jsonb(pg_temp.try_exec(format('update public.orders set status = %L, updated_at = now() where id = %s', 'shipped', p)));
  x1 := pg_temp.redeliver('admin', 604, p, 20000, 'كاش', false);
  r4 := pg_temp.pay('admin', 'zell_payment_record', 606, t, 5000, 'confirmation_fee', 'كاش');
  perform pg_temp.tr('admin', t, 'cancelled');
  x5 := pg_temp.repay(606, t, 5000, 'confirmation_fee', 'كاش');
  perform pg_temp.zt('F38 order changed after success (later payment / status moved / cancelled) -> replay still returns the original snapshot',
    (x3 ->> 'replay')::boolean and (x3 - 'replay') = (r3 - 'replay') and (x3 ->> 'remaining_piastres')::integer = 18000
    and pg_temp.paid(s) = 18000
    and x4 #>> '{}' = 'ok' and pg_temp.st(p) = 'shipped'
    and (x1 ->> 'replay')::boolean and x1 ->> 'status' = 'delivered' and (x1 - 'replay') = (r1 - 'replay')
    and pg_temp.st(t) = 'cancelled' and (x5 ->> 'replay')::boolean and x5 ->> 'status' = 'new'
    and (x5 - 'replay') = (r4 - 'replay'),
    x3::text || x4::text || x1::text || x5::text);

  select count(*) into v_cmds from public.zell_payment_commands;
  select count(*) into v_pays from public.order_payments;
  x1 := pg_temp.redeliver('owner', 604, p, 20000, 'كاش', false);
  x2 := pg_temp.redeliver('admin', 604, q, 20000, 'كاش', false);
  x3 := pg_temp.pay('admin', 'zell_payment_record', 604, p, 20000, 'balance', 'كاش');
  x4 := pg_temp.redeliver('admin', 601, q, 15000, 'كاش', false);
  x5 := pg_temp.redeliver('admin', 603, s, null, null, false);
  perform pg_temp.zt('F39 same command with another actor / order / operation / meaning -> 45425, nothing new',
    x1 ->> '_error' = '45425' and x2 ->> '_error' = '45425' and x3 ->> '_error' = '45425'
    and x4 ->> '_error' = '45425' and x5 ->> '_error' = '45425'
    and (select count(*) from public.zell_payment_commands) = v_cmds and (select count(*) from public.order_payments) = v_pays,
    x1::text || x2::text || x3::text || x4::text || x5::text);

  perform pg_temp.tr('admin', u, 'confirmed');
  perform pg_temp.tr('admin', u, 'shipped');
  x1 := pg_temp.deliver(607, u, null, null, false);
  x2 := pg_temp.deliver(608, u, 1000, 'كاش', false);
  x3 := pg_temp.pay('admin', 'zell_payment_record', 609, u, 9001, 'balance', 'كاش');
  x4 := pg_temp.deliver(607, u, 9000, 'كاش', false);
  perform pg_temp.zt('F40 failures leave no command (45420 / 45420 with a payment / 45423); the failed command id then works as new',
    x1 ->> '_error' = '45420' and x2 ->> '_error' = '45420' and x3 ->> '_error' = '45423'
    and not exists (select 1 from public.zell_payment_commands c where c.command_id in (pg_temp.cid(608), pg_temp.cid(609)))
    and not exists (select 1 from public.order_payments x where x.command_id in (pg_temp.cid(608), pg_temp.cid(609)))
    and x4 ->> 'status' = 'delivered' and not (x4 ->> 'replay')::boolean
    and (select count(*) from public.zell_payment_commands c where c.command_id = pg_temp.cid(607) and c.order_id = u) = 1,
    x1::text || x2::text || x3::text || x4::text);

  perform pg_temp.zt('F41 commands table: no direct access (anon / authenticated / service_role 42501); UPDATE / DELETE / TRUNCATE -> 45427 (even postgres)',
    pg_temp.try_exec('select 1 from public.zell_payment_commands', 'anon') = '42501'
    and pg_temp.try_exec('select 1 from public.zell_payment_commands', 'authenticated') = '42501'
    and pg_temp.try_exec('select 1 from public.zell_payment_commands', 'service_role') = '42501'
    and pg_temp.try_exec('update public.zell_payment_commands set actor = actor') = '45427'
    and pg_temp.try_exec('delete from public.zell_payment_commands') = '45427'
    and pg_temp.try_exec('truncate public.zell_payment_commands') = '45427', null);
exception when others then
  perform pg_temp.zt_block_fail('F6', sqlstate, sqlerrm);
end
$zF6$;

-- ── F4: طرق الدفع والملخص و zell_create_order والتجهيز (البوابة مفتوحة) ──
do $zF4$
declare
  f integer := pg_temp.mk(50000, 10000);
  r jsonb;
  r2 jsonb;
  v_cash integer := pg_temp.mid('كاش');
  v_num text;
  v_num2 text;
begin
  r := pg_temp.as_user(pg_temp.admin_c(), 'select public.zell_payment_list_methods()');
  r2 := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_add_method(%L)', 'جديدة'));
  perform pg_temp.zt('F26 admin lists methods (cash marked used), cannot add (45402)',
    jsonb_array_length(r) = 4 and (r -> 0 ->> 'used')::boolean and r2 ->> '_error' = '45402', r::text || r2::text);
  r := pg_temp.as_user(pg_temp.owner_c(), format('select public.zell_payment_delete_method(%s, %s)', v_cash, pg_temp.mver(v_cash)));
  perform pg_temp.zt('F27 used method cannot be deleted -> 45426', r ->> '_error' = '45426', r::text);
  r := pg_temp.as_user(pg_temp.owner_c(), format('select public.zell_payment_update_method(%s, %s, %L, 10, true)', v_cash, pg_temp.mver(v_cash), 'نقدي'));
  r2 := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, %s, 100, %L, %s)', pg_temp.cmd(50), f, pg_temp.ver(f), 'balance', v_cash));
  perform pg_temp.zt('F28 rename + archive: archived method rejected for new payments (45428), old rows keep their name snapshot',
    r2 ->> '_error' = '45428'
    and not exists (select 1 from public.order_payments p where p.method_id = v_cash and p.method_name <> 'كاش'), r2::text);
  perform pg_temp.as_user(pg_temp.owner_c(), format('select public.zell_payment_update_method(%s, %s, %L, 10, false)', v_cash, pg_temp.mver(v_cash), 'كاش'));
  r := pg_temp.as_user(pg_temp.owner_c(), format('select public.zell_order_set_gate(true, %L)', 'owner-approval-2026-10-10-ci-p1-flows'));
  perform pg_temp.pay('admin', 'zell_payment_record', 51, f, 10000, 'confirmation_fee', 'كاش');
  perform pg_temp.tr('admin', f, 'confirmed');
  perform pg_temp.pay('owner', 'zell_payment_refund', 52, f, 5000, 'confirmation_fee', 'كاش');
  r := pg_temp.tr('admin', f, 'preparing');
  perform pg_temp.pay('admin', 'zell_payment_record', 53, f, 5000, 'confirmation_fee', 'كاش');
  r2 := pg_temp.tr('admin', f, 'preparing');
  perform pg_temp.zt('F29 gate open: preparing with paid < fee -> 45419; after topping up -> preparing',
    r ->> '_error' = '45419' and r2 ->> 'status' = 'preparing', r::text || r2::text);
  r := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_order_summary(%s)', f));
  perform pg_temp.zt('F30 summary for admin: rows in order, totals, has_refund; missing order -> 45403',
    jsonb_array_length(r -> 'payments') = 3 and r -> 'payments' -> 1 ->> 'kind' = 'refund' and (r ->> 'paid_piastres')::integer = 10000
    and (r ->> 'has_refund')::boolean
    and pg_temp.as_user(pg_temp.admin_c(), 'select public.zell_payment_order_summary(999999)') ->> '_error' = '45403', r::text);
  -- zell_create_order بدور service_role والرسوم متفعّلة (المقاس بس، 10%): لقطة على الطلب، والرد زي ما هو.
  update public.zell_payment_settings
     set confirmation_fee = '{"enabled": true, "scope": "made_to_measure", "method": "percent", "percent_bp": 1000}'::jsonb where id;
  r := pg_temp.as_user('', 'select public.zell_create_order(p_items => ''[{"productId":1,"lengthCm":350}]'', p_customer_name => ''عميل'', '
         || 'p_customer_phone => ''01077770001'', p_governorate => ''القاهرة'', p_address => ''عنوان طويل كفاية'', p_notes => null, '
         || 'p_idempotency_key => ''ci-p1-flow-key-0001'', p_request_hash => repeat(''d'', 64), p_checkout_session_hash => repeat(''e'', 64), '
         || 'p_receipt_token_hash => repeat(''f'', 64))', 'service_role');
  r2 := pg_temp.as_user('', 'select public.zell_create_order(p_items => ''[{"productId":3,"quantity":2}]'', p_customer_name => ''عميل'', '
         || 'p_customer_phone => ''01077770002'', p_governorate => ''القاهرة'', p_address => ''عنوان طويل كفاية'', p_notes => null, '
         || 'p_idempotency_key => ''ci-p1-flow-key-0002'', p_request_hash => repeat(''d'', 64), p_checkout_session_hash => repeat(''e'', 64), '
         || 'p_receipt_token_hash => repeat(''f'', 64))', 'service_role');
  v_num := r ->> 'order_number';
  v_num2 := r2 ->> 'order_number';
  perform pg_temp.zt('F31 create_order (service_role): meter cart -> fee = ceil(10%) to the pound; piece cart -> 0; no new key in the reply',
    (select o.confirmation_fee_piastres = ((o.total_piastres::bigint * 1000 + 999999) / 1000000) * 100 and o.confirmation_fee_piastres > 0
       and o.paid_piastres = 0 from public.orders o where o.order_number = v_num)
    and (select o.confirmation_fee_piastres = 0 from public.orders o where o.order_number = v_num2)
    and not (r ? 'confirmation_fee_piastres') and r ? 'total_piastres', r::text || r2::text);
  perform pg_temp.zt('F32 every order: paid = payments - refunds = last paid_after; one event per payment row',
    not exists (select 1 from public.orders o
                 where o.paid_piastres <> coalesce((select sum(case when p.kind = 'payment' then p.amount_piastres else -p.amount_piastres end)
                                                      from public.order_payments p where p.order_id = o.id), 0)
                    or o.paid_piastres <> coalesce((select p.paid_after_piastres from public.order_payments p where p.order_id = o.id
                                                     order by p.id desc limit 1), o.paid_piastres))
    and (select count(*) from public.order_payments)
        = (select count(*) from public.order_events x where x.kind in ('payment_recorded', 'payment_refunded')), null);
exception when others then
  perform pg_temp.zt_block_fail('F4', sqlstate, sqlerrm);
end
$zF4$;

-- ── F5: البصمة بعد التطبيع (مراجعة 7abbbd4، Blocking 1): نفس المعنى بمسافات أو بنص فاضي = replay (البوابة مفتوحة من F4) ──
do $zF5$
declare
  g integer := pg_temp.mk(15000, 0);
  h integer := pg_temp.mk(12000, 0);
  r jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  r := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, %s, 5000, %L, %s, null, %L, %L)',
         pg_temp.cmd(501), g, pg_temp.ver(g), 'balance', pg_temp.mid('كاش'), 'TX-501', 'دفعة أولى'));
  r2 := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, %L::timestamptz, 5000, %L, %s, %L, %L, %L)',
          pg_temp.cmd(501), g, '2000-01-01', 'balance', pg_temp.mid('كاش'), '   ', '  TX-501 ', ' دفعة أولى  '));
  perform pg_temp.zt('F33 record: same command, same meaning with spaces / blank «other» -> replay, nothing new',
    not (r ->> 'replay')::boolean and (r2 ->> 'replay')::boolean and r2 ->> 'payment_id' = r ->> 'payment_id'
    and pg_temp.paid(g) = 5000 and (select count(*) from public.order_payments p where p.order_id = g) = 1, r::text || r2::text);
  r3 := pg_temp.as_user(pg_temp.admin_c(), format('select public.zell_payment_record(%s, %s, %L::timestamptz, 5000, %L, %s, null, %L, %L)',
          pg_temp.cmd(501), g, '2000-01-01', 'balance', pg_temp.mid('كاش'), ' TX-502 ', 'دفعة أولى'));
  perform pg_temp.zt('F34 same command, different meaning after normalization -> 45425, nothing new',
    r3 ->> '_error' = '45425' and (select count(*) from public.order_payments p where p.order_id = g) = 1, r3::text);
  perform pg_temp.tr('admin', h, 'confirmed');
  perform pg_temp.tr('admin', h, 'preparing');
  perform pg_temp.tr('admin', h, 'shipped');
  r := pg_temp.as_user(pg_temp.admin_c(),
         format('select public.zell_payment_deliver_order(p_command_id => %s, p_order_id => %s, p_expected_updated_at => %s, '
                || 'p_amount_piastres => 12000, p_method_id => %s, p_reference => %L, p_note => %L, p_on_credit => false)',
                pg_temp.cmd(502), h, pg_temp.ver(h), pg_temp.mid('كاش'), 'D-502', 'تحصيل عند التسليم'));
  r2 := pg_temp.as_user(pg_temp.admin_c(),
          format('select public.zell_payment_deliver_order(p_command_id => %s, p_order_id => %s, p_expected_updated_at => %L::timestamptz, '
                 || 'p_amount_piastres => 12000, p_method_id => %s, p_method_other => %L, p_reference => %L, p_note => %L, p_on_credit => false)',
                 pg_temp.cmd(502), h, '2000-01-01', pg_temp.mid('كاش'), '', ' D-502  ', '  تحصيل عند التسليم '));
  perform pg_temp.zt('F35 deliver: same command, same meaning with spaces / blank «other» -> replay, nothing new',
    r ->> 'status' = 'delivered' and (r2 ->> 'replay')::boolean and r2 ->> 'payment_id' = r ->> 'payment_id'
    and pg_temp.paid(h) = 12000 and (select count(*) from public.order_payments p where p.order_id = h) = 1, r::text || r2::text);
  perform pg_temp.zt('F42 every payment row has its command (same order); payment / refund commands own exactly one row; stored results are replay=false',
    not exists (select 1 from public.order_payments x
                 where not exists (select 1 from public.zell_payment_commands c
                                    where c.command_id = x.command_id and c.order_id = x.order_id
                                      and (c.operation = x.kind or (x.kind = 'payment' and c.operation = 'deliver'))))
    and not exists (select 1 from public.zell_payment_commands c
                     where c.operation in ('payment', 'refund')
                       and (select count(*) from public.order_payments x where x.command_id = c.command_id) <> 1)
    and not exists (select 1 from public.zell_payment_commands c where (c.result ->> 'replay')::boolean is distinct from false),
    null);
exception when others then
  perform pg_temp.zt_block_fail('F5', sqlstate, sqlerrm);
end
$zF5$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 42 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
