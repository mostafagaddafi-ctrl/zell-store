-- 0021-A P2 — التحقق بعد التطبيق (قراءة بس) لـ 0021a_p2_checkout_fee.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn as (
  select p.oid, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()')
), checks(id, name, ok, detail) as (
  select 'V01', 'zell_checkout_confirmation_fee: owner zell_order_definer, security definer, search_path empty',
         coalesce((select fn.owner = 'zell_order_definer' and fn.prosecdef and fn.proconfig = array['search_path=""'] from fn), false),
         (select fn.owner from fn)
  union all
  select 'V02', 'EXECUTE: service_role only',
         coalesce((select pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE') from fn), false),
         null
  union all
  select 'V03', 'P1 intact: 24 zell_payment_*, none for service_role',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
         and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%'
                           and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 3 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
