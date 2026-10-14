-- 0021-TR W1 — اختبار قبل التطبيق (smoke) لـ 0021tr_track_order.sql
--
-- • قبل التطبيق بس، وإلا ZELL_0021TR_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع (الدالة · صلاحية القراية · الـ policy). مفيش أي طلب بيتكتب ولا بيتقري:
--   النداءات بأكواد شكلها غلط أو مش موجودة بس، فمفيش أي بيانات عميل في النتيجة. order_items بيتقفل (grant + policy) لحد الـ rollback.
-- • المتوقع: PASS (6 نجاح، 0 فشل).

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0021tr';

do $zguard$
begin
  if pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)') is not null then
    raise exception 'ZELL_0021TR_PTEST_PRE_APPLY_ONLY';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

-- نداء الدالة بدور معيّن: النتيجة نص، أو SQLNULL، أو ERR <sqlstate>.
create function pg_temp.call_as(p_role text, p_code text) returns text language plpgsql as $f$
declare
  r jsonb;
begin
  begin
    execute 'set local role ' || quote_ident(p_role);
    execute 'select public.zell_checkout_track_order($1)' into r using p_code;
    execute 'reset role';
  exception when others then
    return 'ERR ' || sqlstate;
  end;
  return coalesce(r::text, 'SQLNULL');
end
$f$;

-- >>> 0021TR BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · مش متطبّق قبل كده · المتطلبات (A1 · D · P1 · P2 · D2).
do $trpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021TR_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021TR_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null then
    raise exception 'ZELL_0021TR_PREREQ_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order')
     or exists (select 1 from pg_catalog.pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select')
     or pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'SELECT,INSERT,UPDATE,REFERENCES')
     or pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'ZELL_0021TR_ALREADY_APPLIED';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 3
     or not pg_catalog.has_table_privilege('zell_order_definer', 'public.orders', 'SELECT')
     or (select count(*) from pg_catalog.pg_attribute a
          where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
            and a.attname in ('delivery_confirmed_date', 'delivery_confirmed_period',
                              'preferred_delivery_date', 'preferred_delivery_period')) <> 4 then
    raise exception 'ZELL_0021TR_PREREQ_MISSING';
  end if;
end
$trpre$;

-- (1) قراية order_items للدالة: الأعمدة التمانية اللي في الإسقاط بس + policy قراية لـ zell_order_definer.
--     RLS على order_items وصلاحيات باقي الأدوار زي ما هي.
grant select (id, order_id, product_name_ar, length_cm, width_cm, quantity, sale_unit, line_total_piastres)
  on table public.order_items to zell_order_definer;
create policy zell_order_definer_select on public.order_items for select to zell_order_definer using (true);

-- (2) الدالة: مالكها zell_order_definer، EXECUTE لـ service_role بس — زي zell_checkout_delivery_periods و
--     zell_checkout_confirmation_fee و zell_checkout_delivery_settings.
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create function public.zell_checkout_track_order(p_order_number text)
returns jsonb language sql stable security definer set search_path = '' as $fn$
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

revoke all on function public.zell_checkout_track_order(text) from public, anon, authenticated, service_role;
grant execute on function public.zell_checkout_track_order(text) to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (3) postflight
do $trpost$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
begin
  if v_oid is null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_oid
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
                        or p.proconfig is distinct from array['search_path=""']))
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 where p.oid = v_oid and a.grantee = 0)
     or exists (select 1
                  from (values ('id'), ('order_id'), ('product_name_ar'), ('length_cm'), ('width_cm'),
                               ('quantity'), ('sale_unit'), ('line_total_piastres')) c(n)
                 where not pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', c.n, 'SELECT'))
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped
                   and a.attname::text not in ('id', 'order_id', 'product_name_ar', 'length_cm', 'width_cm',
                                               'quantity', 'sale_unit', 'line_total_piastres')
                   and pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', a.attname::text, 'SELECT'))
     or pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'INSERT,UPDATE,REFERENCES')
     or (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select'
            and p.cmd = 'SELECT' and p.roles = array['zell_order_definer']::name[]) <> 1
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE')
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4 then
    raise exception 'ZELL_0021TR_POST_SHAPE';
  end if;
end
$trpost$;
-- <<< 0021TR BODY

do $zT$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
  v_missing text;
begin
  perform pg_temp.zt('T01 function created: owner zell_order_definer, security definer, stable, returns jsonb, search_path empty',
    exists (select 1 from pg_catalog.pg_proc p
             where p.oid = v_oid and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer' and p.prosecdef
               and p.provolatile = 's' and p.prorettype = 'jsonb'::regtype and p.proconfig = array['search_path=""']), null);

  -- كود بشكل صحيح ومش موجود (من غير ما نقرا أي طلب حقيقي).
  select c.code into v_missing
    from (values ('FLM-ZZZZZZ'), ('FLM-YYYYYY'), ('FLM-XXXXXX'), ('FLM-WWWWWW')) c(code)
   where not exists (select 1 from public.orders o where o.order_number = c.code)
   limit 1;

  perform pg_temp.zt('T02 EXECUTE: service_role yes; anon / authenticated -> 42501',
    pg_temp.call_as('service_role', v_missing) = 'SQLNULL'
    and pg_temp.call_as('anon', v_missing) = 'ERR 42501'
    and pg_temp.call_as('authenticated', v_missing) = 'ERR 42501',
    pg_temp.call_as('anon', v_missing) || ' / ' || pg_temp.call_as('authenticated', v_missing));

  perform pg_temp.zt('T03 order_items: zell_order_definer SELECT on the 8 projected columns only + one SELECT policy for it',
    not exists (select 1
                  from (values ('id'), ('order_id'), ('product_name_ar'), ('length_cm'), ('width_cm'),
                               ('quantity'), ('sale_unit'), ('line_total_piastres')) c(n)
                 where not pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', c.n, 'SELECT'))
    and not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped
                       and a.attname::text not in ('id', 'order_id', 'product_name_ar', 'length_cm', 'width_cm',
                                                   'quantity', 'sale_unit', 'line_total_piastres')
                       and pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', a.attname::text, 'SELECT'))
    and not pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select'
            and p.cmd = 'SELECT' and p.roles = array['zell_order_definer']::name[]) = 1, null);

  perform pg_temp.zt('T04 wrong shape -> null (empty · NULL · lower case · no FLM- · no dash · leading space · bad letter · length)',
    pg_temp.call_as('service_role', '') = 'SQLNULL'
    and pg_temp.call_as('service_role', null) = 'SQLNULL'
    and pg_temp.call_as('service_role', 'flm-abcdef') = 'SQLNULL'
    and pg_temp.call_as('service_role', 'ABCDEF') = 'SQLNULL'
    and pg_temp.call_as('service_role', 'FLMABCDEF') = 'SQLNULL'
    and pg_temp.call_as('service_role', ' FLM-ABCDEF') = 'SQLNULL'
    and pg_temp.call_as('service_role', 'FLM-ABCDE0') = 'SQLNULL'
    and pg_temp.call_as('service_role', 'FLM-ABCDEFG') = 'SQLNULL', null);

  perform pg_temp.zt('T05 valid shape, not found -> null',
    v_missing is not null and pg_temp.call_as('service_role', v_missing) = 'SQLNULL', v_missing);

  perform pg_temp.zt('T06 counters: 24 zell_order_* · 24 zell_payment_* · 4 zell_checkout_*',
    (select count(*) from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4, null);
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 6 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
