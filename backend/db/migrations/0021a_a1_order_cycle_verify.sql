-- 0021-A A1 — التحقق بعد التطبيق (قراءة بس) لـ 0021a_a1_order_cycle.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (ord = 0 ملخص، والباقي فحص فحص).
-- • صالح في أي وقت بعد التطبيق، والبوابة مقفولة أو مفتوحة (حالتها في عمود gate_open). قبل التطبيق: verdict = FAIL.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict · 8 gate_open · 9 statuses
--   · 10 events · 11 missing_created_events

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn(name, owner) as (
  values ('zell_order_trg_append_only', 'postgres'), ('zell_order_trg_events_immutable', 'postgres'),
         ('zell_order_trg_gate_guard', 'postgres'), ('zell_order_admin_role', 'postgres'),
         ('zell_order_trg_status_guard', 'postgres'),
         ('zell_order_claims_actor', 'zell_order_definer'), ('zell_order_actor', 'zell_order_definer'),
         ('zell_order_gate_is_open', 'zell_order_definer'), ('zell_order_lock', 'zell_order_definer'),
         ('zell_order_text', 'zell_order_definer'), ('zell_order_apply_transition', 'zell_order_definer'),
         ('zell_order_result', 'zell_order_definer'), ('zell_order_transition', 'zell_order_definer'),
         ('zell_order_record_call', 'zell_order_definer'), ('zell_order_set_follow_up', 'zell_order_definer'),
         ('zell_order_set_confirmed_delivery', 'zell_order_definer'), ('zell_order_edit_details', 'zell_order_definer'),
         ('zell_order_set_internal_note', 'zell_order_definer'), ('zell_order_events', 'zell_order_definer'),
         ('zell_order_delivery_periods', 'zell_order_definer'), ('zell_order_save_delivery_periods', 'zell_order_definer'),
         ('zell_order_gate_state', 'zell_order_definer'), ('zell_order_set_gate', 'zell_order_definer'),
         ('zell_order_trg_created_event', 'zell_order_definer')
), pub(name) as (
  values ('zell_order_transition'), ('zell_order_record_call'), ('zell_order_set_follow_up'),
         ('zell_order_set_confirmed_delivery'), ('zell_order_edit_details'), ('zell_order_set_internal_note'),
         ('zell_order_events'), ('zell_order_delivery_periods'), ('zell_order_save_delivery_periods'),
         ('zell_order_gate_state'), ('zell_order_set_gate')
), tbl(name) as (
  values ('order_status_transitions'), ('order_events'), ('order_delivery_periods'), ('zell_order_gate'), ('zell_order_config_log')
), procs as (
  select p.oid, p.proname, pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%'
), checks(id, name, ok, detail) as (
  select 'V01', 'role zell_order_definer: nologin nobypassrls noinherit, postgres member (admin, set, no inherit)',
         exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_order_definer' and not r.rolcanlogin
                   and not r.rolbypassrls and not r.rolinherit and not r.rolsuper and not r.rolcreaterole)
         and exists (select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.roleid
                      where r.rolname = 'zell_order_definer' and m.member = 'postgres'::regrole
                        and m.admin_option and m.set_option and not m.inherit_option),
         null::text
  union all
  select 'V02', 'new tables: 5, owner postgres, RLS on, zero privileges for anon/authenticated/service_role',
         (select count(*) from pg_catalog.pg_class c join tbl on tbl.name = c.relname
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
             and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
             and not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
             and not pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
             and not pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) = 5,
         null
  union all
  select 'V03', 'orders: 4 new columns + delivery shape check + status check with 7 statuses (previous kept in comment)',
         (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped
            and a.attname in ('next_follow_up_at', 'delivery_confirmed_date', 'delivery_confirmed_period', 'delivery_confirmed_note')) = 4
         and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass
                      and c.conname = 'orders_delivery_confirmed_shape' and c.convalidated)
         and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass
                      and c.conname = 'orders_status_check' and c.convalidated
                      and pg_catalog.pg_get_constraintdef(c.oid) like '%''preparing''%'
                      and pg_catalog.pg_get_constraintdef(c.oid) like '%''refused''%'
                      and pg_catalog.obj_description(c.oid, 'pg_constraint') like 'zell-0021a1-previous: CHECK %'),
         null
  union all
  select 'V04', 'transitions table: 9 rows with gates',
         coalesce((select string_agg(t.from_status || '>' || t.to_status || ':' || t.gate, ',' order by t.from_status collate "C", t.to_status collate "C")
                     from public.order_status_transitions t), '')
           = 'confirmed>cancelled:any,confirmed>preparing:open,confirmed>shipped:closed,new>cancelled:any,new>confirmed:any,'
             || 'preparing>cancelled:open,preparing>shipped:open,shipped>delivered:any,shipped>refused:open',
         null
  union all
  select 'V05', 'delivery periods: 3, ordered morning < noon < evening, no overlap',
         (select count(*) from public.order_delivery_periods) = 3
         and (select string_agg(p.period, ',' order by p.starts_at) from public.order_delivery_periods p) = 'morning,noon,evening'
         and not exists (select 1 from public.order_delivery_periods a join public.order_delivery_periods b
                           on a.period < b.period and a.starts_at < b.ends_at and b.starts_at < a.ends_at),
         (select string_agg(p.period || '=' || pg_catalog.to_char(p.starts_at, 'HH24:MI') || '-' || pg_catalog.to_char(p.ends_at, 'HH24:MI'), ',' order by p.starts_at)
            from public.order_delivery_periods p)
  union all
  select 'V06', 'gate: exactly one row', (select count(*) from public.zell_order_gate) = 1, null
  union all
  select 'V07', 'functions: 24 with expected owners, all search_path = empty',
         (select count(*) from procs) = 24
         and (select count(*) from procs join fn on fn.name = procs.proname and fn.owner = procs.owner
               where procs.proconfig @> array['search_path=""']) = 24,
         (select count(*) from procs)::text
  union all
  select 'V08', 'EXECUTE: the 11 public for authenticated, none for anon, service_role only gate_is_open',
         (select count(*) from procs where pg_catalog.has_function_privilege('authenticated', procs.oid, 'EXECUTE')) = 11
         and (select count(*) from procs join pub on pub.name = procs.proname
               where pg_catalog.has_function_privilege('authenticated', procs.oid, 'EXECUTE') and procs.prosecdef) = 11
         and not exists (select 1 from procs where pg_catalog.has_function_privilege('anon', procs.oid, 'EXECUTE'))
         and coalesce((select string_agg(procs.proname, ',') from procs
                        where pg_catalog.has_function_privilege('service_role', procs.oid, 'EXECUTE')), '') = 'zell_order_gate_is_open',
         null
  union all
  select 'V09', 'orders triggers: cancelled_final + status_guard + created_event, enabled',
         (select count(*) from pg_catalog.pg_trigger g where g.tgrelid = 'public.orders'::regclass and not g.tgisinternal
            and g.tgenabled = 'O' and g.tgname in ('orders_cancelled_final', 'orders_status_guard', 'orders_created_event')) = 3,
         (select string_agg(g.tgname, ',' order by g.tgname) from pg_catalog.pg_trigger g
           where g.tgrelid = 'public.orders'::regclass and not g.tgisinternal)
  union all
  select 'V10', 'log / gate guards: 2 triggers each on order_events, zell_order_config_log, zell_order_gate',
         (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
           where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled = 'O'
             and c.relname in ('order_events', 'zell_order_config_log', 'zell_order_gate')) = 6,
         null
  union all
  select 'V11', 'policies: 2 on orders + 1 on each new table, all for zell_order_definer only',
         (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public'
            and ((p.tablename = 'orders' and p.policyname like 'zell\_order\_definer\_%') or p.tablename in (select tbl.name from tbl))
            and p.roles = array['zell_order_definer']::name[]) = 7
         and not exists (select 1 from pg_catalog.pg_policies p where p.schemaname = 'public'
                          and p.tablename in (select tbl.name from tbl) and p.roles <> array['zell_order_definer']::name[]),
         null
  union all
  select 'V12', 'every order since the first created event has its created event',
         not exists (select 1 from public.orders o
                      where o.id >= (select min(e.order_id) from public.order_events e where e.kind = 'created')
                        and not exists (select 1 from public.order_events e where e.order_id = o.id and e.kind = 'created')),
         null
)
select 0::integer as ord,
       'summary'::text as kind,
       null::text as check_id,
       null::text as check_name,
       null::boolean as ok,
       null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) then 'PASS' else 'FAIL' end as verdict,
       (select g.is_open from public.zell_order_gate g limit 1) as gate_open,
       (select string_agg(s.status || '=' || s.n, ',' order by s.status) from (select o.status, count(*) as n from public.orders o group by o.status) s) as statuses,
       (select count(*) from public.order_events) as events,
       (select count(*) from public.orders o
         where o.id >= (select min(e.order_id) from public.order_events e where e.kind = 'created')
           and not exists (select 1 from public.order_events e where e.order_id = o.id and e.kind = 'created')) as missing_created_events
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail,
       null, null, null, null, null
  from checks c
order by 1;

rollback;
