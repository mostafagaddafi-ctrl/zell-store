-- INSTALLER-SHIPPING B — التحقق بعد التطبيق (قراية بس) لـ 0025_installer_shipping.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (6 فحوص).
-- • V04: الصلاحيات زي ما هي بالظبط (EXECUTE لـ postgres المالك و service_role و zell_order_writer)، ومفيش PUBLIC ولا anon ولا
--   authenticated. أي منحة زيادة أو ناقصة = FAIL.
-- • V06: شرط 0024 V04 للحراس بالحرف: الحراس التلاتة (payment · shipment · customer_update) بالبصمة والمالك postgres و invoker،
--   والحارس الرابع (zell_order_trg_events_immutable) بالبصمة بس — زي 0024 V04 بالظبط، ومن غير بصمة zell_create_order (V02 هنا).

begin;
set transaction read only;
set local statement_timeout = '30s';

with co as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl, pg_catalog.pg_get_userbyid(p.proowner)::text as owner,
         pg_catalog.pg_get_function_identity_arguments(p.oid) as args
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'
), grantees as (
  select pg_catalog.string_agg(g.name, ',' order by g.name) as v
    from (select distinct case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as name
            from co, pg_catalog.aclexplode(co.proacl) a
           where a.privilege_type = 'EXECUTE') g
), checks(id, name, ok, detail) as (
  select 'V01'::text, 'zell_create_order: one function, same 15-argument signature'::text,
         (select pg_catalog.count(*) from co) = 1
         and coalesce((select co.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)') from co), false),
         (select pg_catalog.string_agg(co.args, ' | ') from co)
  union all
  select 'V02', 'body = INSTALLER-SHIPPING (md5 03e839e30fe7d0c9354d1df4f21b71b3)',
         coalesce((select pg_catalog.md5(co.prosrc) = '03e839e30fe7d0c9354d1df4f21b71b3' from co), false),
         (select pg_catalog.string_agg(pg_catalog.md5(co.prosrc), ',') from co)
  union all
  select 'V03', 'owner postgres, security definer, search_path empty',
         coalesce((select co.owner = 'postgres' and co.prosecdef and co.proconfig = array['search_path=""'] from co), false),
         (select pg_catalog.string_agg(co.owner || ' secdef=' || co.prosecdef::text || ' ' || coalesce(co.proconfig::text, '-'), ',') from co)
  union all
  select 'V04', 'ACL unchanged: EXECUTE = postgres (owner) + service_role + zell_order_writer exactly; no PUBLIC, anon, authenticated',
         coalesce((select g.v from grantees g), '') = 'postgres,service_role,zell_order_writer'
         and coalesce((select not pg_catalog.has_function_privilege('anon', co.oid, 'EXECUTE')
                              and not pg_catalog.has_function_privilege('authenticated', co.oid, 'EXECUTE')
                              and pg_catalog.has_function_privilege('service_role', co.oid, 'EXECUTE') from co), false),
         (select pg_catalog.string_agg(coalesce(co.proacl::text, 'NULL'), ',') from co)
  union all
  select 'V05', 'owner postgres can compute the confirmation fee and read the shipping options and settings',
         pg_catalog.has_function_privilege('postgres', 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')
         and pg_catalog.has_function_privilege('postgres', 'public.zell_payment_fee_calc(jsonb, integer, integer, boolean, boolean)', 'EXECUTE')
         and pg_catalog.has_table_privilege('postgres', 'public.zell_shipping_options', 'SELECT')
         and pg_catalog.has_table_privilege('postgres', 'public.settings', 'SELECT'),
         null
  union all
  select 'V06', 'guards as 0024 V04: payment/shipment/customer_update (md5, owner postgres, invoker) + events guard (md5)',
         coalesce((select pg_catalog.md5(p.prosrc) = '002afae51685f2ac8e4e718d33035997' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = 'b3d68e747a49556e01fa2918b0206415' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = '0668e7dacc77a9c9a138d3647521dc8e' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = 'd629f8b5c3a0fe1573ad87dd6727cccd' from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_trg_events_immutable()')), false),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select pg_catalog.count(*) from checks) = 6 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), left(c.detail, 400), null
  from checks c
order by 1;

rollback;
