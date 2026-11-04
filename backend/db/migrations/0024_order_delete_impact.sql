-- 0024 ORDER-DELETE — استعلام الأثر (قراية بس) قبل كل خطوة Production وبعدها، بنفس النص بالحرف (خطة تشغيل 0024).
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، وصف واحد في SELECT واحد. مفيش كتابة ولا DDL، ومفيش بيانات شخصية
--   في الناتج (البصمات md5 لنص الصفوف مرتّبة بنصّها، والأعداد بس).
-- • الوقت UTC (timezone = UTC جوه المعاملة)، ومهلة للجملة وللمعاملة الخاملة 15s.
-- • الأعمدة بالترتيب (31):
--     1 observed_at_utc
--     2 purge_role · 3 purge_fns · 4 purge_tables · 5 purge_policies — كائنات 0024 (قبل التطبيق: false · 0 · 0 · 0)
--     6 guards — md5 الحراس الأربعة: payment,shipment,customer_update,events_immutable
--     7 create_order — عدد zell_create_order : md5(prosrc)
--     8 shape_ok — شكل التوابع (نفس تعبير verify V09) = النص المعتمد في العقد §١٣ بالحرف
--     9..26 لكل جدول من التسعة: العدد والبصمة (orders · order_items · order_events · order_payments · zell_payment_commands ·
--           zell_order_shipments · zell_order_shipments_log · zell_order_customer_updates · zell_order_customer_updates_log)
--     27 orders_by_status · 28 idle_tx (وقف لو > 0) · 29 stop_locks (وقف لو > 0) · 30 admin_users_locks (وقف لو > 0) · 31 all_locks (معلومة)
-- • idle_tx = جلسات «idle in transaction» في نفس القاعدة غيرنا. stop_locks = أقفال جلسات تانية على الجداول التسعة مستنية، أو أقوى
--   من RowExclusive، أو ماسكها جلسة idle in transaction. all_locks = كل أقفال الجلسات التانية على الجداول دي.
-- • admin_users_locks = كل أقفال الجلسات التانية على public.admin_users في نفس القاعدة، أي نوع، ممنوحة أو مستنية (زي أثر 0021-P؛
--   04-DB-SAFETY دروس 0021-P §٤). لازم 0 في أثر الخطوة 1، وزي الـ baseline (0) في كل أثر بعده.

begin;
set transaction read only;
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';

with t(rel) as (
  values ('public.orders'::regclass), ('public.order_items'::regclass), ('public.order_events'::regclass), ('public.order_payments'::regclass),
         ('public.zell_payment_commands'::regclass), ('public.zell_order_shipments'::regclass), ('public.zell_order_shipments_log'::regclass),
         ('public.zell_order_customer_updates'::regclass), ('public.zell_order_customer_updates_log'::regclass)
), shp(v) as (
  with recursive d(coid, child) as (
      select c.oid, c.conrelid from pg_catalog.pg_constraint c where c.contype = 'f' and c.confrelid = 'public.orders'::regclass
      union
      select c.oid, c.conrelid from pg_catalog.pg_constraint c join d on c.confrelid = d.child where c.contype = 'f'
    )
    select pg_catalog.string_agg(x.v, ',' order by x.v collate "C") as v
      from (select cn.nspname::text || '.' || cc.relname::text
                   || '(' || (select pg_catalog.string_agg(a.attname::text, '+' order by k.i) from pg_catalog.unnest(c.conkey) with ordinality k(n, i)
                                join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) || ')>'
                   || pn.nspname::text || '.' || pc.relname::text
                   || '(' || (select pg_catalog.string_agg(a.attname::text, '+' order by k.i) from pg_catalog.unnest(c.confkey) with ordinality k(n, i)
                                join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) || '):'
                   || c.conname::text || ':' || c.confdeltype::text || ':' || c.confupdtype::text || ':' || c.confmatchtype::text || ':' || c.condeferrable::text as v
              from d join pg_catalog.pg_constraint c on c.oid = d.coid
                     join pg_catalog.pg_class cc on cc.oid = c.conrelid join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace
                     join pg_catalog.pg_class pc on pc.oid = c.confrelid join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace) x
)
select
  pg_catalog.to_char(pg_catalog.clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as observed_at_utc,
  (pg_catalog.to_regrole('zell_purge_definer') is not null) as purge_role,
  (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%') as purge_fns,
  (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'zell\_purge\_%') as purge_tables,
  (select pg_catalog.count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_purge\_%' or 'zell_purge_definer' = any (p.roles)) as purge_policies,
  (select pg_catalog.string_agg(coalesce(pg_catalog.md5(p.prosrc), '-'), ',' order by f.n)
     from (values (1, 'public.zell_payment_trg_append_only()'), (2, 'public.zell_shipment_trg_append_only()'),
                  (3, 'public.zell_customer_update_trg_append_only()'), (4, 'public.zell_order_trg_events_immutable()')) f(n, s)
     left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(f.s)) as guards,
  (select pg_catalog.count(*)::text || ':' || coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc), '+'), '-')
     from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order,
  ((select s.v from shp s) = 'public.order_events(order_id)>public.orders(id):order_events_order_fkey:c:a:s:false,public.order_items(order_id)>public.orders(id):order_items_order_id_fkey:c:a:s:false,public.order_payments(order_id)>public.orders(id):order_payments_order_fkey:r:a:s:false,public.zell_order_customer_updates(order_id)>public.orders(id):zell_order_customer_updates_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(order_id)>public.orders(id):zell_order_customer_updates_log_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(update_id)>public.zell_order_customer_updates(id):zell_order_customer_updates_log_update_fkey:r:a:s:false,public.zell_order_shipments(order_id)>public.orders(id):zell_order_shipments_order_fkey:r:a:s:false,public.zell_order_shipments_log(order_id)>public.orders(id):zell_order_shipments_log_order_fkey:r:a:s:false,public.zell_payment_commands(order_id)>public.orders(id):zell_payment_commands_order_fkey:r:a:s:false') as shape_ok,
  (select pg_catalog.count(*) from public.orders) as orders,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.orders x) as orders_fp,
  (select pg_catalog.count(*) from public.order_items) as order_items,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.order_items x) as order_items_fp,
  (select pg_catalog.count(*) from public.order_events) as order_events,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.order_events x) as order_events_fp,
  (select pg_catalog.count(*) from public.order_payments) as order_payments,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.order_payments x) as order_payments_fp,
  (select pg_catalog.count(*) from public.zell_payment_commands) as payment_commands,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.zell_payment_commands x) as payment_commands_fp,
  (select pg_catalog.count(*) from public.zell_order_shipments) as shipments,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.zell_order_shipments x) as shipments_fp,
  (select pg_catalog.count(*) from public.zell_order_shipments_log) as shipments_log,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.zell_order_shipments_log x) as shipments_log_fp,
  (select pg_catalog.count(*) from public.zell_order_customer_updates) as customer_updates,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.zell_order_customer_updates x) as customer_updates_fp,
  (select pg_catalog.count(*) from public.zell_order_customer_updates_log) as customer_updates_log,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(x::text, '|' order by x::text collate "C"), '')) from public.zell_order_customer_updates_log x) as customer_updates_log_fp,
  (select coalesce(pg_catalog.string_agg(s.status::text || '=' || s.n::text, ',' order by s.status::text), '') from (select o.status, pg_catalog.count(*) as n from public.orders o group by o.status) s) as orders_by_status,
  (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a
    where a.datname = pg_catalog.current_database() and a.pid <> pg_catalog.pg_backend_pid()
      and a.state in ('idle in transaction', 'idle in transaction (aborted)')) as idle_tx,
  (select pg_catalog.count(*) from pg_catalog.pg_locks l left join pg_catalog.pg_stat_activity a on a.pid = l.pid
    where l.database = (select d.oid from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
      and l.pid <> pg_catalog.pg_backend_pid() and l.relation in (select t.rel from t)
      and (not l.granted
           or l.mode in ('ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
           or a.state in ('idle in transaction', 'idle in transaction (aborted)'))) as stop_locks,
  (select pg_catalog.count(*) from pg_catalog.pg_locks l
    where l.database = (select d.oid from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
      and l.pid <> pg_catalog.pg_backend_pid() and l.relation = 'public.admin_users'::regclass) as admin_users_locks,
  (select pg_catalog.count(*) from pg_catalog.pg_locks l
    where l.database = (select d.oid from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
      and l.pid <> pg_catalog.pg_backend_pid() and l.relation in (select t.rel from t)) as all_locks;

rollback;
