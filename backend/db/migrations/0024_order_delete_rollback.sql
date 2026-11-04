-- 0024 ORDER-DELETE — الرجوع من 0024_order_delete.sql
--
-- • بياخد pg_advisory_xact_lock(hashtextextended('zell_purge:orders', 0)) exclusive الأول: بيستنى أي مسح شغّال (المسح بيمسكه shared لحد الـ commit)،
--   ومفيش مسح جديد بيبدأ لحد آخر الرجوع (45608). فحص السجل بيتعمل تحت القفل.
-- • بيرفض لو zell_purge_log فيه سطور (يعني اتعمل مسح فعلًا): ZELL_0024_ROLLBACK_PURGES_EXIST. الطلبات اللي اتمسحت مابترجعش غير بالـ backup.
-- • بيرفض لو أي دالة من الـ 8 أو الحراس التلاتة مش ببصمة 0024 بالحرف (حد غيّرها بعد التطبيق): ZELL_0024_ROLLBACK_DRIFT، قبل أي تغيير.
-- • بيرجّع الحراس التلاتة لتعريفهم القديم بالحرف (نفس بصمات قراية Production)، ويشيل الدور والدوال والجداول والـ policies والمنح.
-- • التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-order-delete-rollback';
-- ⚠ Production بموافقة صريحة جديدة بس.

begin;
-- >>> 0024 ROLLBACK
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $r24$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0024_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0024_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_purge_definer') is null or pg_catalog.to_regclass('public.zell_purge_log') is null then
    raise exception 'ZELL_0024_NOT_APPLIED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_purge:orders', 0));
  if exists (select 1 from public.zell_purge_log) then
    raise exception 'ZELL_0024_ROLLBACK_PURGES_EXIST';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%') <> 8
     or exists (select 1 from (values ('public.zell_purge_ids_hash(integer[])', '84d52a5f10ec855f8358a4d8e7055077'),
                                       ('public.zell_purge_shape_problem()', 'f0b3fc593b80a362ee6a832f3bc781b9'),
                                       ('public.zell_purge_snapshot_hash(integer[])', 'de9442b871ac48af4a2d844ed66bc1e1'),
                                       ('public.zell_purge_preview(integer[])', '007aa2299b6733d97dd41a96303c2f7a'),
                                       ('public.zell_purge_orders(integer[], text, integer, uuid)', '016f29ebb944ce061e57c2714d1fa044'),
                                       ('public.zell_purge_reauth_begin(uuid)', 'c7184a12872628261de514294251147c'),
                                       ('public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)', '8a87110ffbcbc9c7d449c67b29911d70'),
                                       ('public.zell_purge_trg_append_only()', '78e8fdd2db353f13621c82c6cf545297'),
                                       ('public.zell_payment_trg_append_only()', '002afae51685f2ac8e4e718d33035997'),
                                       ('public.zell_shipment_trg_append_only()', 'b3d68e747a49556e01fa2918b0206415'),
                                       ('public.zell_customer_update_trg_append_only()', '0668e7dacc77a9c9a138d3647521dc8e')) f(s, h)
                 where (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure(f.s)) is distinct from f.h) then
    raise exception 'ZELL_0024_ROLLBACK_DRIFT';
  end if;
end
$r24$;

set local role zell_purge_definer;
drop function public.zell_purge_orders(integer[], text, integer, uuid), public.zell_purge_preview(integer[]), public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer), public.zell_purge_reauth_begin(uuid), public.zell_purge_snapshot_hash(integer[]), public.zell_purge_shape_problem(), public.zell_purge_ids_hash(integer[]);
reset role;
drop trigger zell_purge_log_immutable on public.zell_purge_log;
drop trigger zell_purge_log_no_truncate on public.zell_purge_log;
drop function public.zell_purge_trg_append_only();
drop table public.zell_purge_log, public.zell_purge_reauth, public.zell_purge_attempts;

create or replace function public.zell_payment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_PAY_APPEND_ONLY' using errcode = '45427', detail = tg_table_name || '.' || pg_catalog.lower(tg_op);
end
$fn$;
create or replace function public.zell_shipment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_SHIPMENT_APPEND_ONLY' using errcode = '45413';
end
$fn$;
create or replace function public.zell_customer_update_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_CUSTOMER_UPDATE_APPEND_ONLY' using errcode = '45413';
end
$fn$;

drop policy zell_purge_select on public.orders;
drop policy zell_purge_lock on public.orders;
drop policy zell_purge_delete on public.orders;
drop policy zell_purge_select on public.order_items;
drop policy zell_purge_lock on public.order_items;
drop policy zell_purge_select on public.order_events;
drop policy zell_purge_lock on public.order_events;
drop policy zell_purge_select on public.order_payments;
drop policy zell_purge_lock on public.order_payments;
drop policy zell_purge_delete on public.order_payments;
drop policy zell_purge_select on public.zell_payment_commands;
drop policy zell_purge_lock on public.zell_payment_commands;
drop policy zell_purge_delete on public.zell_payment_commands;
drop policy zell_purge_select on public.zell_order_shipments;
drop policy zell_purge_lock on public.zell_order_shipments;
drop policy zell_purge_delete on public.zell_order_shipments;
drop policy zell_purge_select on public.zell_order_shipments_log;
drop policy zell_purge_lock on public.zell_order_shipments_log;
drop policy zell_purge_delete on public.zell_order_shipments_log;
drop policy zell_purge_select on public.zell_order_customer_updates;
drop policy zell_purge_lock on public.zell_order_customer_updates;
drop policy zell_purge_delete on public.zell_order_customer_updates;
drop policy zell_purge_select on public.zell_order_customer_updates_log;
drop policy zell_purge_lock on public.zell_order_customer_updates_log;
drop policy zell_purge_delete on public.zell_order_customer_updates_log;
revoke all on table public.orders, public.order_items, public.order_events, public.order_payments, public.zell_payment_commands, public.zell_order_shipments, public.zell_order_shipments_log, public.zell_order_customer_updates, public.zell_order_customer_updates_log from zell_purge_definer;
revoke update (updated_at) on table public.orders from zell_purge_definer;
revoke update (order_id) on table public.order_items, public.order_events, public.order_payments, public.zell_payment_commands, public.zell_order_shipments, public.zell_order_shipments_log, public.zell_order_customer_updates, public.zell_order_customer_updates_log from zell_purge_definer;
set local role zell_order_definer;
revoke execute on function public.zell_order_actor(boolean), public.zell_order_claims_actor() from zell_purge_definer;
reset role;
revoke execute on function public.zell_order_admin_role(uuid) from zell_purge_definer;
revoke usage on schema public from zell_purge_definer;
drop role zell_purge_definer;

do $s24$
begin
  if pg_catalog.to_regrole('zell_purge_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%')
     or exists (select 1 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'zell\_purge\_%')
     or exists (select 1 from pg_catalog.pg_policy po where po.polname like 'zell\_purge\_%')
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()')) is distinct from '7bdc5a72585917ba4e27f7c902bd15ad'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()')) is distinct from 'e340a7264ecee639665d3da78c64f0f6'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()')) is distinct from 'afbee972f9b44d516f4da8cd19fe31fa' then
    raise exception 'ZELL_0024_ROLLBACK_POST_SHAPE';
  end if;
end
$s24$;
-- <<< 0024 ROLLBACK
commit;
