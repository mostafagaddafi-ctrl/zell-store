-- 0021-A P2 — اختبار قبل التطبيق لـ 0021a_p2_checkout_fee.sql
--
-- • بعد P1 وقبل P2 بس، وإلا ZELL_0021A_P2_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. مفيش جداول ولا تسلسلات بتتلمس.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0021a-p2';

do $zguard$
begin
  if pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is not null then
    raise exception 'ZELL_0021A_P2_PTEST_PRE_APPLY_ONLY';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.call_as(p_role text) returns text language plpgsql as $f$
declare
  r jsonb;
begin
  begin
    execute 'set local role ' || quote_ident(p_role);
    execute 'select public.zell_checkout_confirmation_fee()' into r;
    execute 'reset role';
  exception when others then
    return 'ERR ' || sqlstate;
  end;
  return coalesce(r::text, 'null');
end
$f$;

-- >>> 0021A_P2 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: P1 متطبّق، و P2 لأ.
do $p2pre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A_P2_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021A_P2_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regclass('public.zell_payment_settings') is null
     or pg_catalog.to_regrole('zell_order_definer') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24 then
    raise exception 'ZELL_0021A_P2_P1_MISSING';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is not null then
    raise exception 'ZELL_0021A_P2_ALREADY_APPLIED';
  end if;
end
$p2pre$;

-- (1) إعداد رسوم التأكيد للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_role بس — زي
--     zell_checkout_delivery_periods في D. بترجّع الإعداد والسياسة بس (مش أرقام الدفع ولا قالب واتساب).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create function public.zell_checkout_confirmation_fee()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object('confirmation_fee', s.confirmation_fee, 'fee_policy', s.fee_policy)
    from public.zell_payment_settings s where s.id
$fn$;

revoke all on function public.zell_checkout_confirmation_fee() from public, anon, authenticated, service_role;
grant execute on function public.zell_checkout_confirmation_fee() to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (2) postflight
do $p2post$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()');
begin
  if v_oid is null
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_oid) <> 'zell_order_definer'
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid)
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0021A_P2_POST_SHAPE';
  end if;
end
$p2post$;
-- <<< 0021A_P2 BODY

do $zT$
declare
  v_settings jsonb;
  v_res text;
begin
  select pg_catalog.jsonb_build_object('confirmation_fee', s.confirmation_fee, 'fee_policy', s.fee_policy) into v_settings
    from public.zell_payment_settings s where s.id;
  v_res := pg_temp.call_as('service_role');
  perform pg_temp.zt('T01 service_role reads the fee config + policy (same as the settings row)', v_res = v_settings::text, v_res);
  perform pg_temp.zt('T02 anon / authenticated -> 42501',
    pg_temp.call_as('anon') = 'ERR 42501' and pg_temp.call_as('authenticated') = 'ERR 42501', null);
  perform pg_temp.zt('T03 P1 intact: 24 zell_payment_*, none for service_role',
    (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
    and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%'
                      and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')), null);
  perform pg_temp.zt('T04 payment numbers / WhatsApp template not exposed', v_res not like '%payment_numbers%' and v_res not like '%whatsapp%', null);
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 4 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
