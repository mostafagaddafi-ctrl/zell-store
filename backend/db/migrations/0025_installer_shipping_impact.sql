-- INSTALLER-SHIPPING — استعلام الأثر (قراية بس) لـ 0025 قبل كل خطوة Production وبعدها، بنفس النص بالحرف (خطة تشغيل 0025).
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، وصف واحد في SELECT واحد. مفيش كتابة ولا DDL، ومفيش بيانات شخصية في الناتج
--   (أعداد وبصمات md5 ونص الصلاحيات بس).
-- • الوقت UTC (timezone = UTC جوه المعاملة)، ومهلة للجملة وللمعاملة الخاملة 15s.
-- • الأعمدة بالترتيب (15):
--     1 observed_at_utc
--     2 create_order — عدد zell_create_order بالاسم : md5(prosrc) (قبل التطبيق 1:62924d0fe9b1563e76c54bbddfb628b4 · بعده 1:03e839e30fe7d0c9354d1df4f21b71b3)
--     3 co_props — للتوقيع (15): المالك|security definer|search_path (المتوقع postgres|true|{"search_path=\"\""})
--     4 co_acl — proacl كامل للتوقيع (15): المداخل مرتّبة بنصّها، ومنها الـ grantor وعلامة grant option (*) — إثبات الصلاحيات قبل التطبيق
--     5 co_acl_ok — 3 مداخل بالظبط = EXECUTE لـ postgres و service_role و zell_order_writer، كلها من غير grant option (نفس verify V04) — وقف لو مش t
--     6 guards — الحراس الأربعة: md5/المالك/secdef (payment,shipment,customer_update,events_immutable) — زي 0024 V04
--     7 payment_fns — md5 لـ zell_payment_order_fee و zell_payment_fee_calc (التطبيق مابيلمسهمش)
--     8 fee_cfg — md5 إعداد رسوم التأكيد (معلومة: بيحدد المقدّم)
--     9 orders · 10 installer_orders · 11 installer_ship0 (طلبات بفني شحنها المحفوظ 0) · 12 last_order_at_utc
--     13 idle_tx (وقف لو > 0) · 14 sessions_visible (وقف لو مش t) · 15 co_signature_ok (التوقيع 15 موجود)
-- • idle_tx = جلسات «idle in transaction» في نفس القاعدة غيرنا. sessions_visible = المستخدم الحالي عنده صلاحيات pg_read_all_stats ومفيش جلسة
--   تانية حالتها مخفية؛ لو مش t: idle_tx بيرجع NULL مش 0، والخطة بتقف. الاستعلام مابيمنحش أي صلاحية. (نفس تعريفات استعلام أثر 0024.)
-- • الأعداد 9–12 ممكن تزيد بين قرايتين بطلبات حقيقية بس؛ أي فرق لازم يتفسّر بطلبات created_at بعد القراية اللي قبلها.

begin;
set transaction read only;
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';

with vis(ok) as (
  select coalesce(pg_catalog.pg_has_role('pg_read_all_stats', 'USAGE')
                  and not exists (select 1 from pg_catalog.pg_stat_activity a
                                   where a.datname = pg_catalog.current_database() and a.pid <> pg_catalog.pg_backend_pid()
                                     and a.query = '<insufficient privilege>'), false)
), co as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl, pg_catalog.pg_get_userbyid(p.proowner)::text as owner
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)')::oid
), acl as (
  select pg_catalog.count(*) as n, pg_catalog.string_agg(e.v, ',' order by e.v) as v
    from (select (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end)
                 || ':' || a.privilege_type || ':' || (case when a.is_grantable then 'grantable' else 'plain' end) as v
            from co, pg_catalog.aclexplode(co.proacl) a) e
), g(ord, sig) as (
  values (1, 'public.zell_payment_trg_append_only()'), (2, 'public.zell_shipment_trg_append_only()'),
         (3, 'public.zell_customer_update_trg_append_only()'), (4, 'public.zell_order_trg_events_immutable()')
)
select
  pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as observed_at_utc,
  (select pg_catalog.count(*)::text || ':' || coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by pg_catalog.md5(p.prosrc)), '-')
     from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order,
  coalesce((select co.owner || '|' || co.prosecdef::text || '|' || coalesce(co.proconfig::text, '-') from co), '-') as co_props,
  coalesce((select coalesce(pg_catalog.string_agg(x::text, ',' order by x::text collate "C"), 'NULL') from co left join lateral pg_catalog.unnest(co.proacl) x on true), '-') as co_acl,
  coalesce((select acl.n = 3 and acl.v = 'postgres:EXECUTE:plain,service_role:EXECUTE:plain,zell_order_writer:EXECUTE:plain' from acl), false) as co_acl_ok,
  (select pg_catalog.string_agg(coalesce((select pg_catalog.md5(p.prosrc) || '/' || pg_catalog.pg_get_userbyid(p.proowner) || '/' || p.prosecdef::text
                                            from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure(g.sig)::oid), '-'), ',' order by g.ord) from g) as guards,
  coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_order_fee(integer, integer, boolean, boolean)')::oid), '-')
    || ',' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_fee_calc(jsonb, integer, integer, boolean, boolean)')::oid), '-') as payment_fns,
  coalesce((select pg_catalog.md5(s.confirmation_fee::text) from public.zell_payment_settings s where s.id), '-') as fee_cfg,
  (select pg_catalog.count(*) from public.orders) as orders,
  (select pg_catalog.count(*) from public.orders o where o.installation_requested) as installer_orders,
  (select pg_catalog.count(*) from public.orders o where o.installation_requested and o.shipping_piastres = 0) as installer_ship0,
  coalesce((select pg_catalog.to_char(pg_catalog.max(o.created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.orders o), '-') as last_order_at_utc,
  (select case when vs.ok then (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a
    where a.datname = pg_catalog.current_database() and a.pid <> pg_catalog.pg_backend_pid()
      and a.state in ('idle in transaction', 'idle in transaction (aborted)')) end from vis vs) as idle_tx,
  (select vs.ok from vis vs) as sessions_visible,
  (select pg_catalog.count(*) from co) = 1 as co_signature_ok;

rollback;
