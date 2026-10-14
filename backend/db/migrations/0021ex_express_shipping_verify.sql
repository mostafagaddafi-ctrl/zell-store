-- EXPRESS-SHIPPING W1 — التحقق بعد التطبيق (قراءة بس) لـ 0021ex_express_shipping.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • بيشتغل في أي وقت بعد التطبيق: V07 بيقارن صف الإعداد بقيم التطبيق لو السجل فاضي، وإلا بآخر سطر في السجل.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict · 8 orders_total
--   · 9 express_orders · 10 create_order_owner
-- • المتوقع: PASS (10 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_shipping_options_get()'),
                   pg_catalog.to_regprocedure('public.zell_shipping_options_save(timestamptz, boolean, jsonb)'),
                   pg_catalog.to_regprocedure('public.zell_shipping_options_checkout()'))
), tbl as (
  select c.oid, c.relname, c.relrowsecurity, pg_catalog.pg_get_userbyid(c.relowner) as owner
    from pg_catalog.pg_class c
   where c.oid in (pg_catalog.to_regclass('public.zell_shipping_options'), pg_catalog.to_regclass('public.zell_shipping_options_log'))
), co as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)')
), checks(id, name, ok, detail) as (
  select 'V01', 'tables: options + log, owner postgres, RLS on; options has exactly one row',
         (select count(*) from tbl where tbl.owner = 'postgres' and tbl.relrowsecurity) = 2
         and (select count(*) from public.zell_shipping_options) = 1,
         (select pg_catalog.string_agg(tbl.relname || ':' || tbl.owner, ',' order by tbl.relname) from tbl)
  union all
  select 'V02', 'policies: one per table, for zell_order_definer only',
         (select count(*) from pg_catalog.pg_policies p
           where p.schemaname = 'public' and p.tablename in ('zell_shipping_options', 'zell_shipping_options_log')
             and p.roles = array['zell_order_definer']::name[]) = 2
         and (select count(*) from pg_catalog.pg_policies p
               where p.schemaname = 'public' and p.tablename in ('zell_shipping_options', 'zell_shipping_options_log')) = 2,
         null
  union all
  select 'V03', 'no table / sequence privileges for anon, authenticated, service_role',
         not exists (select 1
                       from (values ('anon'), ('authenticated'), ('service_role')) r(n), tbl
                      where pg_catalog.has_table_privilege(r.n, tbl.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
         and not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n)
                          where pg_catalog.has_sequence_privilege(r.n, 'public.zell_shipping_options_log_id_seq', 'USAGE,SELECT,UPDATE')),
         null
  union all
  select 'V04', 'functions: 3, owner zell_order_definer, security definer, search_path empty',
         (select count(*) from fn where fn.owner = 'zell_order_definer' and fn.prosecdef and fn.proconfig = array['search_path=""']) = 3,
         (select pg_catalog.string_agg(fn.proname || ':' || fn.owner, ',' order by fn.proname) from fn)
  union all
  select 'V05', 'EXECUTE: get/save authenticated only · checkout service_role only · anon nothing',
         coalesce((select bool_and(case fn.proname
                     when 'zell_shipping_options_checkout' then
                       pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE')
                       and not pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE')
                     else
                       pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE')
                       and not pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE') end
                     and not pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')) from fn), false)
         and (select count(*) from fn) = 3,
         null
  union all
  select 'V06', 'guards: log immutable + no truncate, options no delete + no truncate (enabled; trigger function owned by postgres)',
         (select count(*) from pg_catalog.pg_trigger g join tbl on tbl.oid = g.tgrelid
           where not g.tgisinternal and g.tgenabled = 'O'
             and g.tgname in ('zell_shipping_options_log_immutable', 'zell_shipping_options_log_no_truncate',
                              'zell_shipping_options_no_delete', 'zell_shipping_options_no_truncate')) = 4
         and coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' from pg_catalog.pg_proc p
                        where p.oid = pg_catalog.to_regprocedure('public.zell_shipping_options_trg_append_only()')), false),
         null
  union all
  select 'V07', 'options row = apply values (express off, {}) before any save, else = the last log entry',
         coalesce((select case when not exists (select 1 from public.zell_shipping_options_log)
                               then not o.express_enabled and o.governorates = '{}'::jsonb
                               else pg_catalog.jsonb_build_object('express_enabled', o.express_enabled, 'governorates', o.governorates)
                                    = (select l.new_value from public.zell_shipping_options_log l order by l.id desc limit 1) end
                     from public.zell_shipping_options o where o.id), false),
         (select 'log=' || pg_catalog.count(*) from public.zell_shipping_options_log)
  union all
  select 'V08', 'orders: 3 snapshot columns (nullable, no default) + validated shape check',
         (select count(*) from pg_catalog.pg_attribute a
           where a.attrelid = 'public.orders'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
             and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max')) = 3
         and exists (select 1 from pg_catalog.pg_constraint c
                      where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_shipping_snapshot_shape' and c.convalidated),
         null
  union all
  select 'V09', 'zell_create_order: one (15 args), EXPRESS body (md5), owner postgres, security definer, search_path empty, service_role only (no PUBLIC), owner can compute the fee and read the options',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') = 1
         and coalesce((select pg_catalog.md5(co.prosrc) = '62924d0fe9b1563e76c54bbddfb628b4' and co.owner = 'postgres' and co.prosecdef
                              and co.proconfig = array['search_path=""']
                              and pg_catalog.has_function_privilege('service_role', co.oid, 'EXECUTE')
                              and not pg_catalog.has_function_privilege('anon', co.oid, 'EXECUTE')
                              and not pg_catalog.has_function_privilege('authenticated', co.oid, 'EXECUTE')
                              and not exists (select 1 from pg_catalog.aclexplode(co.proacl) a where a.grantee = 0)
                              and pg_catalog.has_function_privilege(co.owner, 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')
                              and pg_catalog.has_table_privilege(co.owner, 'public.zell_shipping_options', 'SELECT')
                         from co), false),
         (select pg_catalog.md5(co.prosrc) from co)
  union all
  select 'V10', 'others intact: 24 zell_order_*, 24 zell_payment_*, 4 zell_checkout_*; 45431 only in zell_create_order, 45432 only there + zell_shipping_options_save; no CREATE for the definer',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4
         and coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                        where p.prosrc like '%45431%'), '') = 'zell_create_order'
         and coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                        where p.prosrc like '%45432%'), '') = 'zell_create_order,zell_shipping_options_save'
         and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 10 then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from public.orders) as orders_total,
       (select count(*) from public.orders o where o.shipping_method = 'express') as express_orders,
       (select co.owner from co) as create_order_owner
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null, null, null, null
  from checks c
order by 1;

rollback;
