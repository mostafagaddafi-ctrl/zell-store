-- TRACK-ORDER v2 W1 — التحقق بعد التطبيق (قراءة بس) لـ 0021tr2_track_order_v2.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. أسماء وأعداد بس (من غير بيانات عميل).
-- • بيشتغل في أي وقت بعد التطبيق: V08 بيقارن كل شحنة ورسالة بسجلها (آخر سطر = الحالي)، و V09 بيتأكد إن الصافي في كل
--   طلب = المدفوع − المردود (العقد §٣).
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict · 8 shipments · 9 updates
--   · 10 visible_updates
-- • المتوقع: PASS (10 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with tbl as (
  select c.oid, c.relname, c.relrowsecurity, pg_catalog.pg_get_userbyid(c.relowner) as owner
    from pg_catalog.pg_class c
   where c.oid in (pg_catalog.to_regclass('public.zell_order_shipments'), pg_catalog.to_regclass('public.zell_order_shipments_log'),
                   pg_catalog.to_regclass('public.zell_order_customer_updates'),
                   pg_catalog.to_regclass('public.zell_order_customer_updates_log'))
), pub as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_shipment_get(text)'),
                   pg_catalog.to_regprocedure('public.zell_shipment_save(text, timestamptz, text, text, text, date, date)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_list(text)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_add(text, bigint, text)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_edit(text, bigint, timestamptz, text)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_set_hidden(text, bigint, timestamptz, boolean)'))
), inner_fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_shipment_result(integer)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_result(integer)'),
                   pg_catalog.to_regprocedure('public.zell_customer_update_text(text)'))
), tr as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.prorettype, p.proconfig, p.proacl, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')
), ulog as (
  select l.update_id, l.action, l.new_value,
         pg_catalog.row_number() over (partition by l.update_id order by l.id) as first_n,
         pg_catalog.row_number() over (partition by l.update_id, (l.action in ('add', 'edit')) order by l.id desc) as last_n
    from public.zell_order_customer_updates_log l
), checks(id, name, ok, detail) as (
  select 'V01', 'tables: shipments + log, customer updates + log — owner postgres, RLS on',
         (select count(*) from tbl where tbl.owner = 'postgres' and tbl.relrowsecurity) = 4,
         (select pg_catalog.string_agg(tbl.relname || ':' || tbl.owner, ',' order by tbl.relname) from tbl)
  union all
  select 'V02', 'policies: one per table, for zell_order_definer only',
         (select count(*) from pg_catalog.pg_policies p join tbl on tbl.relname = p.tablename
           where p.schemaname = 'public' and p.roles = array['zell_order_definer']::name[]) = 4
         and (select count(*) from pg_catalog.pg_policies p join tbl on tbl.relname = p.tablename where p.schemaname = 'public') = 4,
         null
  union all
  select 'V03', 'no table / sequence privileges for anon, authenticated, service_role',
         not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n), tbl
                      where pg_catalog.has_table_privilege(r.n, tbl.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
         and not exists (select 1
                           from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                                (values ('public.zell_order_shipments_log_id_seq'), ('public.zell_order_customer_updates_id_seq'),
                                        ('public.zell_order_customer_updates_log_id_seq')) s(n)
                          where pg_catalog.has_sequence_privilege(r.n, s.n, 'USAGE,SELECT,UPDATE')),
         null
  union all
  select 'V04', 'functions: 6 public (definer, security definer) + 3 internal (definer, invoker), search_path empty; 2 trigger functions owned by postgres; 11 names in all',
         (select count(*) from pub where pub.owner = 'zell_order_definer' and pub.prosecdef and pub.proconfig = array['search_path=""']) = 6
         and (select count(*) from inner_fn where inner_fn.owner = 'zell_order_definer' and not inner_fn.prosecdef
                                               and inner_fn.proconfig = array['search_path=""']) = 3
         and (select count(*) from pg_catalog.pg_proc p
               where p.oid in (pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()'),
                               pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()'))
                 and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef) = 2
         and (select count(*) from pg_catalog.pg_proc p
               where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%') = 11,
         (select pg_catalog.string_agg(pub.proname || ':' || pub.owner, ',' order by pub.proname) from pub)
  union all
  select 'V05', 'EXECUTE: the 6 public for authenticated only · internal + trigger functions for nobody',
         coalesce((select bool_and(pg_catalog.has_function_privilege('authenticated', pub.oid, 'EXECUTE')
                                   and not pg_catalog.has_function_privilege('anon', pub.oid, 'EXECUTE')
                                   and not pg_catalog.has_function_privilege('service_role', pub.oid, 'EXECUTE')) from pub), false)
         and not exists (select 1 from inner_fn, (values ('anon'), ('authenticated'), ('service_role')) r(n)
                          where pg_catalog.has_function_privilege(r.n, inner_fn.oid, 'EXECUTE'))
         and not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                                       (values ('public.zell_shipment_trg_append_only()'), ('public.zell_customer_update_trg_append_only()')) f(n)
                          where pg_catalog.has_function_privilege(r.n, f.n, 'EXECUTE')),
         null
  union all
  select 'V06', 'guards: 8 triggers enabled (logs immutable + no truncate · shipments and updates no delete + no truncate)',
         (select count(*) from pg_catalog.pg_trigger g join tbl on tbl.oid = g.tgrelid
           where not g.tgisinternal and g.tgenabled = 'O'
             and g.tgname in ('zell_order_shipments_no_delete', 'zell_order_shipments_no_truncate',
                              'zell_order_shipments_log_immutable', 'zell_order_shipments_log_no_truncate',
                              'zell_order_customer_updates_no_delete', 'zell_order_customer_updates_no_truncate',
                              'zell_order_customer_updates_log_immutable', 'zell_order_customer_updates_log_no_truncate')) = 8,
         null
  union all
  select 'V07', 'zell_checkout_track_order: one, v2 body (md5), owner zell_order_definer, security definer, stable, returns jsonb, search_path empty, EXECUTE exactly as T1 (service_role only)',
         (select count(*) from pg_catalog.pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') = 1
         and coalesce((select pg_catalog.md5(tr.prosrc) = '14dad4721c48b73ee5e040bf7436bfc5' and tr.owner = 'zell_order_definer' and tr.prosecdef
                              and tr.provolatile = 's' and tr.prorettype = 'jsonb'::regtype and tr.proconfig = array['search_path=""']
                              and tr.proacl::text = '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}' from tr), false),
         (select pg_catalog.md5(tr.prosrc) from tr)
  union all
  select 'V08', 'data = log: every shipment = its last log entry · every update starts with "add", its text = the last add/edit, hidden = the last hide/show (or false), edited = any edit · no log without a row',
         not exists (select 1 from public.zell_order_shipments s
                      where (select l.new_value from public.zell_order_shipments_log l where l.order_id = s.order_id order by l.id desc limit 1)
                            is distinct from pg_catalog.jsonb_build_object('carrier', s.carrier, 'tracking_number', s.tracking_number,
                                                                          'tracking_url', s.tracking_url, 'shipped_on', s.shipped_on,
                                                                          'expected_on', s.expected_on))
         and not exists (select 1 from public.zell_order_shipments_log l
                          where not exists (select 1 from public.zell_order_shipments s where s.order_id = l.order_id))
         and not exists (select 1 from public.zell_order_customer_updates u
                          where not exists (select 1 from ulog where ulog.update_id = u.id and ulog.first_n = 1 and ulog.action = 'add')
                             or (select ulog.new_value ->> 'text' from ulog
                                  where ulog.update_id = u.id and ulog.action in ('add', 'edit') and ulog.last_n = 1) is distinct from u.text
                             or coalesce((select (ulog.new_value ->> 'hidden')::boolean from ulog
                                           where ulog.update_id = u.id and ulog.action in ('hide', 'show') and ulog.last_n = 1), false)
                                is distinct from u.hidden
                             or exists (select 1 from ulog where ulog.update_id = u.id and ulog.action = 'edit') is distinct from u.edited)
         and not exists (select 1 from public.zell_order_customer_updates_log l
                          where l.action = 'add' and exists (select 1 from public.zell_order_customer_updates_log l2
                                                              where l2.update_id = l.update_id and l2.action = 'add' and l2.id <> l.id)),
         (select 'shipments=' || pg_catalog.count(*) from public.zell_order_shipments)
           || ' log=' || (select pg_catalog.count(*) from public.zell_order_shipments_log)
           || ' updates=' || (select pg_catalog.count(*) from public.zell_order_customer_updates)
           || ' log=' || (select pg_catalog.count(*) from public.zell_order_customer_updates_log)
  union all
  select 'V09', 'money: for every order the net paid (orders.paid_piastres) = payments - refunds (the track response shows both)',
         not exists (select 1 from public.orders o
                      where o.paid_piastres
                            <> coalesce((select pg_catalog.sum(case p.kind when 'payment' then p.amount_piastres else -p.amount_piastres end)
                                           from public.order_payments p where p.order_id = o.id), 0)),
         null
  union all
  select 'V10', 'others intact: 24 zell_order_* · 24 zell_payment_* · 4 zell_checkout_* · 45433 only in zell_shipment_save · 45434 only in the 3 update functions · zell_order_definer: no new grants on orders / order_events / order_payments (12 UPDATE columns on orders; SELECT + INSERT on the other two) · no CREATE',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4
         and coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                        where p.prosrc like '%45433%'), '') = 'zell_shipment_save'
         and coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                        where p.prosrc like '%45434%'), '') = 'zell_customer_update_add,zell_customer_update_set_hidden,zell_customer_update_text'
         and pg_catalog.has_table_privilege('zell_order_definer', 'public.orders', 'SELECT')
         and not pg_catalog.has_table_privilege('zell_order_definer', 'public.orders', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and (select count(*) from pg_catalog.pg_attribute a
               where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
                 and pg_catalog.has_column_privilege('zell_order_definer', 'public.orders', a.attname::text, 'UPDATE')) = 12
         and not pg_catalog.has_any_column_privilege('zell_order_definer', 'public.orders', 'INSERT,REFERENCES')
         and pg_catalog.has_table_privilege('zell_order_definer', 'public.order_events', 'SELECT')
         and pg_catalog.has_table_privilege('zell_order_definer', 'public.order_events', 'INSERT')
         and not pg_catalog.has_table_privilege('zell_order_definer', 'public.order_events', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and not pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_events', 'UPDATE,REFERENCES')
         and pg_catalog.has_table_privilege('zell_order_definer', 'public.order_payments', 'SELECT')
         and pg_catalog.has_table_privilege('zell_order_definer', 'public.order_payments', 'INSERT')
         and not pg_catalog.has_table_privilege('zell_order_definer', 'public.order_payments', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and not pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_payments', 'UPDATE,REFERENCES')
         and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 10 then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from public.zell_order_shipments) as shipments,
       (select count(*) from public.zell_order_customer_updates) as updates,
       (select count(*) from public.zell_order_customer_updates u where not u.hidden) as visible_updates
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null, null, null, null
  from checks c
order by 1;

rollback;
