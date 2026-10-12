-- 0021-D2 W1 — التحقق بعد التطبيق (قراءة بس) لـ 0021d2_delivery_settings.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • بيشتغل في أي وقت بعد التطبيق: V07 بيقارن الصف بالسلوك الحالي لو السجل فاضي، وإلا بآخر سطر في السجل.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (8 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_delivery_settings_get()'),
                   pg_catalog.to_regprocedure('public.zell_delivery_settings_save(timestamptz, boolean, boolean, text)'),
                   pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()'))
), tbl as (
  select c.oid, c.relname, c.relrowsecurity, pg_catalog.pg_get_userbyid(c.relowner) as owner
    from pg_catalog.pg_class c
   where c.oid in (pg_catalog.to_regclass('public.zell_delivery_settings'), pg_catalog.to_regclass('public.zell_delivery_settings_log'))
), checks(id, name, ok, detail) as (
  select 'V01', 'tables: settings + log, owner postgres, RLS on; settings has exactly one row',
         (select count(*) from tbl where tbl.owner = 'postgres' and tbl.relrowsecurity) = 2
         and (select count(*) from public.zell_delivery_settings) = 1,
         (select pg_catalog.string_agg(tbl.relname || ':' || tbl.owner, ',' order by tbl.relname) from tbl)
  union all
  select 'V02', 'policies: one per table, for zell_order_definer only',
         (select count(*) from pg_catalog.pg_policies p
           where p.schemaname = 'public' and p.tablename in ('zell_delivery_settings', 'zell_delivery_settings_log')
             and p.roles = array['zell_order_definer']::name[]) = 2
         and (select count(*) from pg_catalog.pg_policies p
               where p.schemaname = 'public' and p.tablename in ('zell_delivery_settings', 'zell_delivery_settings_log')) = 2,
         null
  union all
  select 'V03', 'no table / sequence privileges for anon, authenticated, service_role',
         not exists (select 1
                       from (values ('anon'), ('authenticated'), ('service_role')) r(n), tbl
                      where pg_catalog.has_table_privilege(r.n, tbl.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
         and not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n)
                          where pg_catalog.has_sequence_privilege(r.n, 'public.zell_delivery_settings_log_id_seq', 'USAGE,SELECT,UPDATE')),
         null
  union all
  select 'V04', 'functions: 3, owner zell_order_definer, security definer, search_path empty',
         (select count(*) from fn where fn.owner = 'zell_order_definer' and fn.prosecdef and fn.proconfig = array['search_path=""']) = 3,
         (select pg_catalog.string_agg(fn.proname || ':' || fn.owner, ',' order by fn.proname) from fn)
  union all
  select 'V05', 'EXECUTE: get/save authenticated only · checkout service_role only · anon nothing',
         coalesce((select bool_and(case fn.proname
                     when 'zell_checkout_delivery_settings' then
                       pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE')
                       and not pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE')
                     else
                       pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE')
                       and not pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE') end
                     and not pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')) from fn), false)
         and (select count(*) from fn) = 3,
         null
  union all
  select 'V06', 'guards: log immutable + no truncate, settings no delete + no truncate (enabled; trigger function owned by postgres)',
         (select count(*) from pg_catalog.pg_trigger g join tbl on tbl.oid = g.tgrelid
           where not g.tgisinternal and g.tgenabled = 'O'
             and g.tgname in ('zell_delivery_settings_log_immutable', 'zell_delivery_settings_log_no_truncate',
                              'zell_delivery_settings_no_delete', 'zell_delivery_settings_no_truncate')) = 4
         and coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' from pg_catalog.pg_proc p
                        where p.oid = pg_catalog.to_regprocedure('public.zell_delivery_settings_trg_append_only()')), false),
         null
  union all
  select 'V07', 'settings row = current behaviour before any save, else = the last log entry',
         coalesce((select case when not exists (select 1 from public.zell_delivery_settings_log)
                               then s.customer_choice_enabled and not s.note_enabled and s.note_text is null
                               else pg_catalog.jsonb_build_object('customer_choice_enabled', s.customer_choice_enabled,
                                      'note_enabled', s.note_enabled, 'note_text', s.note_text)
                                    = (select l.new_value from public.zell_delivery_settings_log l order by l.id desc limit 1) end
                     from public.zell_delivery_settings s where s.id), false),
         (select 'log=' || pg_catalog.count(*) from public.zell_delivery_settings_log)
  union all
  select 'V08', 'others intact: 24 zell_order_*, 24 zell_payment_*, 45430 only in zell_delivery_settings_save, no CREATE for the definer',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
         and coalesce((select pg_catalog.string_agg(p.proname, ',' order by p.proname) from pg_catalog.pg_proc p where p.prosrc like '%45430%'), '')
             = 'zell_delivery_settings_save'
         and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 8 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
