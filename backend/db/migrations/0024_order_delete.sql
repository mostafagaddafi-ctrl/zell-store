-- 0024 ORDER-DELETE B — حذف الطلبات للمالك (SQL بس، من غير تطبيق في الـ PR ده)
--
-- العقد: docs/contracts/ORDER-DELETE.md (المراجعة 4، مدموج في #197). مبني على قراية Production بموافقة المالك 2026-11-03 23:04Z
--   (الـ FKs والحراس الأربعة ببصماتهم و zell_create_order 62924d0f… — العقد §١٢).
-- • دور جديد zell_purge_definer (NOLOGIN · NOINHERIT · NOBYPASSRLS) ومالك 7 دوال zell_purge_*:
--     zell_purge_preview(integer[])                          — المالك بس، EXECUTE لـ authenticated. القايمة + snapshot_hash.
--     zell_purge_orders(integer[], text, integer, uuid)      — المالك بس، EXECUTE لـ authenticated. المسح في معاملة واحدة.
--     zell_purge_reauth_begin(uuid) · zell_purge_reauth_finish(…) — service_role بس (سيرفر اللوحة بعد الباسورد).
--     zell_purge_ids_hash · zell_purge_shape_problem · zell_purge_snapshot_hash — داخلية.
--   + zell_purge_trg_append_only() (postgres) حارس سجل الحذف من غير استثناء.
-- • جداول جديدة: zell_purge_log (append-only، من غير بيانات شخصية) · zell_purge_reauth (التذاكر) · zell_purge_attempts (الحد).
-- • استثناء في 3 حراس بس: zell_payment_trg_append_only · zell_shipment_trg_append_only · zell_customer_update_trg_append_only —
--   DELETE لصف لما current_user = zell_purge_definer والجدول من الجداول المعتمدة للحارس والطلب من طلبات العملية (إعداد محلي).
--   غير كده نفس الرفض ونفس الكود. zell_order_trg_events_immutable و zell_create_order مابيتلمسوش.
-- • الأكواد 45601..45610 (ZELL_PURGE_*).
-- • ترتيب المسح: قفل advisory shared (من غير انتظار) ← ROW EXCLUSIVE على الجداول التسعة (بيوقف أي تغيير FK) ← فحص شكل التوابع الكامل ←
--   صفوف الطلبات ثم التوابع NOWAIT ← التذكرة ← البصمة ← الحذف ← سطر السجل.
-- الرجوع: 0024_order_delete_rollback.sql (بياخد القفل exclusive، وبيرفض لو zell_purge_log فيه سطور أو لو دالة اتغيّرت). التحقق: 0024_order_delete_verify.sql ·
-- الاختبار قبل التطبيق: 0024_order_delete_ptest.sql · CI: backend/db/ci/0024_sql_ci.sh
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-order-delete';
--   ومفيش أي سطر تشغيل تاني (درس 0023).
-- ⚠ Production بموافقة صريحة لكل خطوة: ptest ← backup كامل ← تطبيق ← verify. والـ GRANT/CREATE POLICY على جداول الطلبات بياخدوا أقفال لحظية.

begin;
-- >>> 0024 BODY
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- (0) preflight: المتصل · الموافقة · مش متطبّق · المتطلبات · الحراس و zell_create_order = قراية Production · الأكواد فاضية · التوابع = القايمة المعتمدة.
do $p24$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_shape text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0024_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0024_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_purge_definer') is not null
     or exists (select 1 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'zell\_purge\_%')
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%') then
    raise exception 'ZELL_0024_ALREADY_APPLIED';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_order_claims_actor()') is null
     or pg_catalog.to_regprocedure('public.zell_order_admin_role(uuid)') is null then
    raise exception 'ZELL_0024_PREREQ_MISSING';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()')) is distinct from '7bdc5a72585917ba4e27f7c902bd15ad'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()')) is distinct from 'e340a7264ecee639665d3da78c64f0f6'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()')) is distinct from 'afbee972f9b44d516f4da8cd19fe31fa'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_trg_events_immutable()')) is distinct from 'd629f8b5c3a0fe1573ad87dd6727cccd' then
    raise exception 'ZELL_0024_GUARD_DRIFT';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1
     or not exists (select 1 from pg_catalog.pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'
                       and pg_catalog.md5(p.prosrc) = '62924d0fe9b1563e76c54bbddfb628b4') then
    raise exception 'ZELL_0024_CREATE_ORDER_DRIFT';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.prosrc ~ '\m456(0[1-9]|10)\M') then
    raise exception 'ZELL_0024_CODE_TAKEN';
  end if;
  select s.v into v_shape from (with recursive d(coid, child) as (
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
                   join pg_catalog.pg_class pc on pc.oid = c.confrelid join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace) x) s;
  if v_shape is distinct from 'public.order_events(order_id)>public.orders(id):order_events_order_fkey:c:a:s:false,public.order_items(order_id)>public.orders(id):order_items_order_id_fkey:c:a:s:false,public.order_payments(order_id)>public.orders(id):order_payments_order_fkey:r:a:s:false,public.zell_order_customer_updates(order_id)>public.orders(id):zell_order_customer_updates_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(order_id)>public.orders(id):zell_order_customer_updates_log_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(update_id)>public.zell_order_customer_updates(id):zell_order_customer_updates_log_update_fkey:r:a:s:false,public.zell_order_shipments(order_id)>public.orders(id):zell_order_shipments_order_fkey:r:a:s:false,public.zell_order_shipments_log(order_id)>public.orders(id):zell_order_shipments_log_order_fkey:r:a:s:false,public.zell_payment_commands(order_id)>public.orders(id):zell_payment_commands_order_fkey:r:a:s:false' then
    raise exception 'ZELL_0024_DEPENDENTS_DRIFT' using detail = coalesce(v_shape, '-');
  end if;
end
$p24$;

-- (1) الدور: NOLOGIN · NOBYPASSRLS · NOINHERIT. عضوية postgres: SET بس (زي zell_catalog_definer).
create role zell_purge_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;
grant zell_purge_definer to postgres with inherit false, set true;
grant usage on schema public to zell_purge_definer;

-- (2) سلسلة الهوية: الأولتين مالكهم zell_order_definer، والتالتة مالكها postgres.
set local role zell_order_definer;
grant execute on function public.zell_order_actor(boolean), public.zell_order_claims_actor() to zell_purge_definer;
reset role;
grant execute on function public.zell_order_admin_role(uuid) to zell_purge_definer;

-- (3) الجداول الجديدة (مالكها postgres، RLS، صفر لـ anon و authenticated و service_role).
create table public.zell_purge_log (
  id                bigint generated always as identity constraint zell_purge_log_pkey primary key,
  purged_at         timestamptz not null default pg_catalog.now(),
  actor             uuid not null,
  order_numbers     text[] not null constraint zell_purge_log_numbers_check check (pg_catalog.cardinality(order_numbers) between 1 and 10000),
  orders_count      integer not null constraint zell_purge_log_count_check check (orders_count = pg_catalog.cardinality(order_numbers)),
  payments_count    integer not null constraint zell_purge_log_payments_check check (payments_count >= 0),
  received_piastres bigint not null constraint zell_purge_log_received_check check (received_piastres >= 0),
  refunded_piastres bigint not null constraint zell_purge_log_refunded_check check (refunded_piastres >= 0)
);
create table public.zell_purge_reauth (
  ticket         uuid not null default pg_catalog.gen_random_uuid() constraint zell_purge_reauth_pkey primary key,
  actor          uuid not null,
  session_id     uuid not null,
  scope_ids_hash text not null constraint zell_purge_reauth_scope_check check (scope_ids_hash ~ '^[0-9a-f]{32}$'),
  snapshot_hash  text not null constraint zell_purge_reauth_snapshot_check check (snapshot_hash ~ '^[0-9a-f]{32}$'),
  orders_count   integer not null constraint zell_purge_reauth_count_check check (orders_count between 1 and 10000),
  issued_at      timestamptz not null default pg_catalog.now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  constraint zell_purge_reauth_expiry_check check (expires_at > issued_at)
);
create table public.zell_purge_attempts (
  actor             uuid not null constraint zell_purge_attempts_pkey primary key,
  failed_count      integer not null default 0 constraint zell_purge_attempts_count_check check (failed_count >= 0),
  window_started_at timestamptz,
  locked_until      timestamptz,
  updated_at        timestamptz not null default pg_catalog.now()
);
alter table public.zell_purge_log enable row level security;
alter table public.zell_purge_reauth enable row level security;
alter table public.zell_purge_attempts enable row level security;
revoke all on table public.zell_purge_log, public.zell_purge_reauth, public.zell_purge_attempts from public, anon, authenticated, service_role;
revoke all on sequence public.zell_purge_log_id_seq from public, anon, authenticated, service_role;

-- (4) سجل الحذف append-only من غير أي استثناء.
create function public.zell_purge_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_PURGE_LOG_APPEND_ONLY' using errcode = '45610', detail = tg_table_name || '.' || pg_catalog.lower(tg_op);
end
$fn$;
revoke all on function public.zell_purge_trg_append_only() from public, anon, authenticated, service_role;
create trigger zell_purge_log_immutable before update or delete on public.zell_purge_log
  for each row execute function public.zell_purge_trg_append_only();
create trigger zell_purge_log_no_truncate before truncate on public.zell_purge_log
  for each statement execute function public.zell_purge_trg_append_only();

-- (5) الاستثناء في 3 حراس بس (العقد §٤-٢): DELETE · الدور ده · الجداول بالاسم · طلبات العملية. غير كده بالحرف زي ما كان.
-- zell_order_trg_events_immutable مابيتلمسش. create or replace بيسيب المالك (postgres) والصلاحيات زي ما هي.
create or replace function public.zell_payment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' and current_user = 'zell_purge_definer'
     and tg_table_name in ('order_payments', 'zell_payment_commands') then
    if old.order_id = any (coalesce(nullif(pg_catalog.current_setting('zell.purge_order_ids', true), ''), '{}')::integer[]) then
      return old;
    end if;
  end if;
  raise exception 'ZELL_PAY_APPEND_ONLY' using errcode = '45427', detail = tg_table_name || '.' || pg_catalog.lower(tg_op);
end
$fn$;
create or replace function public.zell_shipment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' and current_user = 'zell_purge_definer'
     and tg_table_name in ('zell_order_shipments', 'zell_order_shipments_log') then
    if old.order_id = any (coalesce(nullif(pg_catalog.current_setting('zell.purge_order_ids', true), ''), '{}')::integer[]) then
      return old;
    end if;
  end if;
  raise exception 'ZELL_SHIPMENT_APPEND_ONLY' using errcode = '45413';
end
$fn$;
create or replace function public.zell_customer_update_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' and current_user = 'zell_purge_definer'
     and tg_table_name in ('zell_order_customer_updates', 'zell_order_customer_updates_log') then
    if old.order_id = any (coalesce(nullif(pg_catalog.current_setting('zell.purge_order_ids', true), ''), '{}')::integer[]) then
      return old;
    end if;
  end if;
  raise exception 'ZELL_CUSTOMER_UPDATE_APPEND_ONLY' using errcode = '45413';
end
$fn$;

-- (6) صلاحيات الدور على جداول الطلبات: SELECT كامل (البصمة) · UPDATE على عمود واحد للقفل بس · DELETE على 7 · policies (العقد §٤-٣).
grant select on table public.orders, public.order_items, public.order_events, public.order_payments, public.zell_payment_commands, public.zell_order_shipments, public.zell_order_shipments_log, public.zell_order_customer_updates, public.zell_order_customer_updates_log to zell_purge_definer;
grant update (updated_at) on table public.orders to zell_purge_definer;
grant update (order_id) on table public.order_items, public.order_events, public.order_payments, public.zell_payment_commands, public.zell_order_shipments, public.zell_order_shipments_log, public.zell_order_customer_updates, public.zell_order_customer_updates_log to zell_purge_definer;
grant delete on table public.orders, public.order_payments, public.zell_payment_commands, public.zell_order_shipments, public.zell_order_shipments_log, public.zell_order_customer_updates, public.zell_order_customer_updates_log to zell_purge_definer;
create policy zell_purge_select on public.orders for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.orders for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.orders for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.order_items for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.order_items for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_select on public.order_events for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.order_events for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_select on public.order_payments for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.order_payments for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.order_payments for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.zell_payment_commands for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.zell_payment_commands for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.zell_payment_commands for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.zell_order_shipments for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.zell_order_shipments for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.zell_order_shipments for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.zell_order_shipments_log for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.zell_order_shipments_log for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.zell_order_shipments_log for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.zell_order_customer_updates for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.zell_order_customer_updates for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.zell_order_customer_updates for delete to zell_purge_definer using (true);
create policy zell_purge_select on public.zell_order_customer_updates_log for select to zell_purge_definer using (true);
create policy zell_purge_lock on public.zell_order_customer_updates_log for update to zell_purge_definer using (true) with check (false);
create policy zell_purge_delete on public.zell_order_customer_updates_log for delete to zell_purge_definer using (true);
grant insert on table public.zell_purge_log to zell_purge_definer;
grant usage on sequence public.zell_purge_log_id_seq to zell_purge_definer;
create policy zell_purge_log_insert on public.zell_purge_log for insert to zell_purge_definer with check (true);
grant select, insert, update on table public.zell_purge_reauth to zell_purge_definer;
create policy zell_purge_reauth_select on public.zell_purge_reauth for select to zell_purge_definer using (true);
create policy zell_purge_reauth_insert on public.zell_purge_reauth for insert to zell_purge_definer with check (true);
create policy zell_purge_reauth_update on public.zell_purge_reauth for update to zell_purge_definer using (true) with check (true);
grant select, insert, update on table public.zell_purge_attempts to zell_purge_definer;
create policy zell_purge_attempts_select on public.zell_purge_attempts for select to zell_purge_definer using (true);
create policy zell_purge_attempts_insert on public.zell_purge_attempts for insert to zell_purge_definer with check (true);
create policy zell_purge_attempts_update on public.zell_purge_attempts for update to zell_purge_definer using (true) with check (true);

-- (7) الدوال: CREATE كـ zell_purge_definer (SET LOCAL ROLE).
grant create on schema public to zell_purge_definer;
set local role zell_purge_definer;
create function public.zell_purge_ids_hash(p_ids integer[])
returns text language sql immutable set search_path = '' as $fn$
  select pg_catalog.md5(coalesce(pg_catalog.array_to_string(array(select distinct u.x from pg_catalog.unnest(p_ids) as u(x) order by u.x), ','), ''))
$fn$;
create function public.zell_purge_shape_problem()
returns text language sql stable set search_path = '' as $fn$
  select case when s.v is distinct from 'public.order_events(order_id)>public.orders(id):order_events_order_fkey:c:a:s:false,public.order_items(order_id)>public.orders(id):order_items_order_id_fkey:c:a:s:false,public.order_payments(order_id)>public.orders(id):order_payments_order_fkey:r:a:s:false,public.zell_order_customer_updates(order_id)>public.orders(id):zell_order_customer_updates_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(order_id)>public.orders(id):zell_order_customer_updates_log_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(update_id)>public.zell_order_customer_updates(id):zell_order_customer_updates_log_update_fkey:r:a:s:false,public.zell_order_shipments(order_id)>public.orders(id):zell_order_shipments_order_fkey:r:a:s:false,public.zell_order_shipments_log(order_id)>public.orders(id):zell_order_shipments_log_order_fkey:r:a:s:false,public.zell_payment_commands(order_id)>public.orders(id):zell_payment_commands_order_fkey:r:a:s:false' then coalesce(s.v, '-') end
    from (with recursive d(coid, child) as (
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
                   join pg_catalog.pg_class pc on pc.oid = c.confrelid join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace) x) s
$fn$;
create function public.zell_purge_snapshot_hash(p_ids integer[])
returns text language sql stable set search_path = '' set "TimeZone" = 'UTC' as $fn$
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.part, E'\n' order by x.id), ''))
    from (
      select o.id, pg_catalog.concat_ws(E'\x1f', pg_catalog.to_jsonb(o)::text,
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.order_items t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.order_events t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.order_payments t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.zell_payment_commands t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.zell_order_shipments t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.zell_order_shipments_log t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.zell_order_customer_updates t where t.order_id = o.id) r),
               (select coalesce(pg_catalog.string_agg(r.j, E'\x1e' order by r.j collate "C"), '') from (select pg_catalog.to_jsonb(t)::text as j from public.zell_order_customer_updates_log t where t.order_id = o.id) r)) as part
        from public.orders o
       where o.id = any (p_ids)
    ) x
$fn$;
create function public.zell_purge_preview(p_ids integer[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' set "TimeZone" = 'UTC' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_req integer[];
  v_ids integer[];
begin
  if p_ids is not null then
    if pg_catalog.cardinality(p_ids) = 0 or pg_catalog.cardinality(p_ids) > 10000 or pg_catalog.array_position(p_ids, null) is not null then
      raise exception 'ZELL_PURGE_INVALID_INPUT' using errcode = '45601';
    end if;
    v_req := array(select distinct u.x from pg_catalog.unnest(p_ids) as u(x) order by u.x);
  end if;
  v_ids := array(select o.id from public.orders o where v_req is null or o.id = any (v_req) order by o.id);
  if v_req is not null and pg_catalog.cardinality(v_ids) <> pg_catalog.cardinality(v_req) then
    raise exception 'ZELL_PURGE_NOT_FOUND' using errcode = '45602';
  end if;
  return pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'ids', pg_catalog.to_jsonb(v_ids),
    'count', pg_catalog.cardinality(v_ids),
    'ids_hash', public.zell_purge_ids_hash(v_ids),
    'snapshot_hash', public.zell_purge_snapshot_hash(v_ids),
    'payments_count', (select pg_catalog.count(*) from public.order_payments p where p.order_id = any (v_ids)),
    'received_piastres', (select coalesce(pg_catalog.sum(p.amount_piastres), 0) from public.order_payments p where p.order_id = any (v_ids) and p.kind = 'payment'),
    'refunded_piastres', (select coalesce(pg_catalog.sum(p.amount_piastres), 0) from public.order_payments p where p.order_id = any (v_ids) and p.kind = 'refund'),
    'orders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'created_at', o.created_at,
        'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
        'status', o.status, 'total_piastres', o.total_piastres,
        'payments_count', (select pg_catalog.count(*) from public.order_payments p where p.order_id = o.id),
        'received_piastres', (select coalesce(pg_catalog.sum(p.amount_piastres), 0) from public.order_payments p where p.order_id = o.id and p.kind = 'payment'),
        'refunded_piastres', (select coalesce(pg_catalog.sum(p.amount_piastres), 0) from public.order_payments p where p.order_id = o.id and p.kind = 'refund'))
      order by o.id) from public.orders o where o.id = any (v_ids)), '[]'::jsonb));
end
$fn$;
create function public.zell_purge_reauth_begin(p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_row public.zell_purge_attempts;
begin
  if p_actor is null or public.zell_order_admin_role(p_actor) is distinct from 'owner' then
    raise exception 'ZELL_PURGE_FORBIDDEN' using errcode = '45603';
  end if;
  insert into public.zell_purge_attempts (actor) values (p_actor) on conflict (actor) do nothing;
  select a.* into v_row from public.zell_purge_attempts a where a.actor = p_actor for update;
  if v_row.locked_until is not null and v_row.locked_until > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('allowed', false, 'locked_until', v_row.locked_until);
  end if;
  if v_row.window_started_at is null or v_row.window_started_at <= pg_catalog.now() - interval '15 minutes' then
    v_row.failed_count := 0;
    v_row.window_started_at := pg_catalog.now();
  end if;
  if v_row.failed_count >= 5 then
    update public.zell_purge_attempts a
       set locked_until = pg_catalog.now() + interval '15 minutes', updated_at = pg_catalog.now()
     where a.actor = p_actor;
    return pg_catalog.jsonb_build_object('allowed', false, 'locked_until', pg_catalog.now() + interval '15 minutes');
  end if;
  update public.zell_purge_attempts a
     set failed_count = v_row.failed_count + 1, window_started_at = v_row.window_started_at,
         locked_until = null, updated_at = pg_catalog.now()
   where a.actor = p_actor;
  return pg_catalog.jsonb_build_object('allowed', true, 'attempt', v_row.failed_count + 1);
end
$fn$;
create function public.zell_purge_reauth_finish(p_actor uuid, p_session uuid, p_ok boolean, p_ids_hash text, p_snapshot_hash text, p_count integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_row public.zell_purge_attempts;
  v_ticket uuid;
begin
  if p_actor is null or public.zell_order_admin_role(p_actor) is distinct from 'owner' then
    raise exception 'ZELL_PURGE_FORBIDDEN' using errcode = '45603';
  end if;
  if p_ok is null or p_session is null or p_count is null or p_count < 1 or p_count > 10000
     or coalesce(p_ids_hash, '') !~ '^[0-9a-f]{32}$' or coalesce(p_snapshot_hash, '') !~ '^[0-9a-f]{32}$' then
    raise exception 'ZELL_PURGE_INVALID_INPUT' using errcode = '45601';
  end if;
  select a.* into v_row from public.zell_purge_attempts a where a.actor = p_actor for update;
  if not found or v_row.failed_count < 1 or v_row.window_started_at is null
     or (v_row.locked_until is not null and v_row.locked_until > pg_catalog.now()) then
    raise exception 'ZELL_PURGE_TICKET_INVALID' using errcode = '45607';
  end if;
  if not p_ok then
    if v_row.failed_count >= 5 then
      update public.zell_purge_attempts a
         set locked_until = pg_catalog.now() + interval '15 minutes', updated_at = pg_catalog.now()
       where a.actor = p_actor;
    end if;
    return pg_catalog.jsonb_build_object('ticket', null, 'locked', v_row.failed_count >= 5);
  end if;
  update public.zell_purge_attempts a
     set failed_count = 0, window_started_at = null, locked_until = null, updated_at = pg_catalog.now()
   where a.actor = p_actor;
  insert into public.zell_purge_reauth (actor, session_id, scope_ids_hash, snapshot_hash, orders_count, expires_at)
  values (p_actor, p_session, p_ids_hash, p_snapshot_hash, p_count, pg_catalog.now() + interval '2 minutes')
  returning ticket into v_ticket;
  return pg_catalog.jsonb_build_object('ticket', v_ticket);
end
$fn$;
create function public.zell_purge_orders(p_ids integer[], p_snapshot_hash text, p_count integer, p_ticket uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set "TimeZone" = 'UTC' set lock_timeout = '3s' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_session uuid;
  v_ids integer[];
  v_locked integer;
  v_problem text;
  v_numbers text[];
  v_pay integer;
  v_rec bigint;
  v_ref bigint;
  v_left integer;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) = 0 or pg_catalog.cardinality(p_ids) > 10000
     or pg_catalog.array_position(p_ids, null) is not null or p_count is null or p_ticket is null
     or coalesce(p_snapshot_hash, '') !~ '^[0-9a-f]{32}$' then
    raise exception 'ZELL_PURGE_INVALID_INPUT' using errcode = '45601';
  end if;
  v_ids := array(select distinct u.x from pg_catalog.unnest(p_ids) as u(x) order by u.x);
  if pg_catalog.cardinality(v_ids) <> p_count or pg_catalog.cardinality(p_ids) <> p_count then
    raise exception 'ZELL_PURGE_COUNT_MISMATCH' using errcode = '45606';
  end if;
  begin
    v_session := (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid;
  exception when others then
    v_session := null;
  end;
  if v_session is null then
    raise exception 'ZELL_PURGE_TICKET_INVALID' using errcode = '45607';
  end if;
  -- (2) the rollback takes this lock exclusive: no purge starts while it runs, and it waits for a running purge.
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('zell_purge:orders', 0)) then
    raise exception 'ZELL_PURGE_BUSY' using errcode = '45608', detail = 'maintenance';
  end if;
  -- (3) ROW EXCLUSIVE on orders and the 8 approved dependents until commit (zero-row UPDATE of the lock column; LOCK TABLE needs
  --     table-level UPDATE/DELETE/TRUNCATE). It conflicts with every FK change on them (ADD = SHARE ROW EXCLUSIVE, DROP/ALTER =
  --     ACCESS EXCLUSIVE), so the shape checked next is the shape the DELETE runs on. Normal writes are not blocked.
  begin
    update public.orders o set updated_at = o.updated_at where false;
    update public.order_items t set order_id = t.order_id where false;
    update public.order_events t set order_id = t.order_id where false;
    update public.order_payments t set order_id = t.order_id where false;
    update public.zell_payment_commands t set order_id = t.order_id where false;
    update public.zell_order_shipments t set order_id = t.order_id where false;
    update public.zell_order_shipments_log t set order_id = t.order_id where false;
    update public.zell_order_customer_updates t set order_id = t.order_id where false;
    update public.zell_order_customer_updates_log t set order_id = t.order_id where false;
  exception when lock_not_available then
    raise exception 'ZELL_PURGE_BUSY' using errcode = '45608', detail = 'tables';
  end;
  -- (4) any dependent outside the approved list, or an approved FK changed in any way = refuse (no uncounted cascade).
  v_problem := public.zell_purge_shape_problem();
  if v_problem is not null then
    raise exception 'ZELL_PURGE_UNAPPROVED_DEPENDENT' using errcode = '45604', detail = pg_catalog.left(v_problem, 500);
  end if;
  -- (5a) the snapshot's orders, in id order, never waiting.
  begin
    perform 1 from public.orders o where o.id = any (v_ids) order by o.id for update nowait;
  exception when lock_not_available then
    raise exception 'ZELL_PURGE_BUSY' using errcode = '45608', detail = 'orders';
  end;
  select pg_catalog.count(*) into v_locked from public.orders o where o.id = any (v_ids);
  if v_locked <> p_count then
    raise exception 'ZELL_PURGE_SNAPSHOT_CHANGED' using errcode = '45605', detail = 'orders';
  end if;
  -- (5b) every approved dependent row, fixed table order, never waiting.
  begin
    perform 1 from public.order_items t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.order_events t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.order_payments t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.zell_payment_commands t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.zell_order_shipments t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.zell_order_shipments_log t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.zell_order_customer_updates t where t.order_id = any (v_ids) for update nowait;
    perform 1 from public.zell_order_customer_updates_log t where t.order_id = any (v_ids) for update nowait;
  exception when lock_not_available then
    raise exception 'ZELL_PURGE_BUSY' using errcode = '45608', detail = 'dependents';
  end;
  -- (6) single-use ticket bound to owner, session and scope, consumed atomically.
  update public.zell_purge_reauth r
     set used_at = pg_catalog.clock_timestamp()
   where r.ticket = p_ticket and r.used_at is null and r.expires_at > pg_catalog.clock_timestamp()
     and r.actor = v_actor and r.session_id = v_session
     and r.scope_ids_hash = public.zell_purge_ids_hash(v_ids) and r.snapshot_hash = p_snapshot_hash and r.orders_count = p_count;
  if not found then
    raise exception 'ZELL_PURGE_TICKET_INVALID' using errcode = '45607';
  end if;
  -- (7) same content hash as the preview, after the locks.
  if public.zell_purge_snapshot_hash(v_ids) is distinct from p_snapshot_hash then
    raise exception 'ZELL_PURGE_SNAPSHOT_CHANGED' using errcode = '45605', detail = 'content';
  end if;
  select pg_catalog.array_agg(o.order_number order by o.id) into v_numbers from public.orders o where o.id = any (v_ids);
  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.sum(p.amount_piastres) filter (where p.kind = 'payment'), 0),
         coalesce(pg_catalog.sum(p.amount_piastres) filter (where p.kind = 'refund'), 0)
    into v_pay, v_rec, v_ref
    from public.order_payments p where p.order_id = any (v_ids);
  -- (8) the guards allow DELETE only for these orders, this role and the approved tables.
  perform pg_catalog.set_config('zell.purge_order_ids', v_ids::text, true);
  delete from public.zell_order_customer_updates_log t where t.order_id = any (v_ids);
  delete from public.zell_order_customer_updates t where t.order_id = any (v_ids);
  delete from public.zell_order_shipments_log t where t.order_id = any (v_ids);
  delete from public.zell_order_shipments t where t.order_id = any (v_ids);
  delete from public.zell_payment_commands t where t.order_id = any (v_ids);
  delete from public.order_payments t where t.order_id = any (v_ids);
  delete from public.orders o where o.id = any (v_ids);
  perform pg_catalog.set_config('zell.purge_order_ids', '', true);
  -- (9) log without personal data.
  insert into public.zell_purge_log (actor, order_numbers, orders_count, payments_count, received_piastres, refunded_piastres)
  values (v_actor, v_numbers, p_count, v_pay, v_rec, v_ref);
  select pg_catalog.count(*)::integer into v_left from public.orders;
  return pg_catalog.jsonb_build_object('deleted', p_count, 'order_numbers', pg_catalog.to_jsonb(v_numbers),
                                       'payments_count', v_pay, 'received_piastres', v_rec, 'refunded_piastres', v_ref,
                                       'remaining_orders', v_left);
end
$fn$;
revoke all on function public.zell_purge_ids_hash(integer[]), public.zell_purge_shape_problem(), public.zell_purge_snapshot_hash(integer[]), public.zell_purge_preview(integer[]), public.zell_purge_orders(integer[], text, integer, uuid), public.zell_purge_reauth_begin(uuid), public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.zell_purge_preview(integer[]), public.zell_purge_orders(integer[], text, integer, uuid) to authenticated;
grant execute on function public.zell_purge_reauth_begin(uuid), public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer) to service_role;
reset role;
revoke create on schema public from zell_purge_definer;

-- (8) postflight
do $q24$
begin
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_purge_definer' and not r.rolcanlogin and not r.rolbypassrls and not r.rolinherit and not r.rolsuper)
     or (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%') <> 8
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_ids_hash(integer[])') and pg_catalog.md5(p.prosrc) = '84d52a5f10ec855f8358a4d8e7055077' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_shape_problem()') and pg_catalog.md5(p.prosrc) = 'f0b3fc593b80a362ee6a832f3bc781b9' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_snapshot_hash(integer[])') and pg_catalog.md5(p.prosrc) = 'de9442b871ac48af4a2d844ed66bc1e1' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_preview(integer[])') and pg_catalog.md5(p.prosrc) = '007aa2299b6733d97dd41a96303c2f7a' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_orders(integer[], text, integer, uuid)') and pg_catalog.md5(p.prosrc) = '016f29ebb944ce061e57c2714d1fa044' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_reauth_begin(uuid)') and pg_catalog.md5(p.prosrc) = 'c7184a12872628261de514294251147c' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)') and pg_catalog.md5(p.prosrc) = '8a87110ffbcbc9c7d449c67b29911d70' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_trg_append_only()') and pg_catalog.md5(p.prosrc) = '78e8fdd2db353f13621c82c6cf545297' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and p.prosecdef = false)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()') and pg_catalog.md5(p.prosrc) = '002afae51685f2ac8e4e718d33035997' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()') and pg_catalog.md5(p.prosrc) = 'b3d68e747a49556e01fa2918b0206415' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef)
     or not exists (select 1 from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()') and pg_catalog.md5(p.prosrc) = '0668e7dacc77a9c9a138d3647521dc8e' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef)
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_trg_events_immutable()')) is distinct from 'd629f8b5c3a0fe1573ad87dd6727cccd'
     or not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order' and pg_catalog.md5(p.prosrc) = '62924d0fe9b1563e76c54bbddfb628b4')
     or not pg_catalog.has_function_privilege('authenticated', 'public.zell_purge_preview(integer[])', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.zell_purge_orders(integer[], text, integer, uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.zell_purge_reauth_begin(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)', 'EXECUTE')
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n), (values ('public.zell_purge_ids_hash(integer[])'), ('public.zell_purge_shape_problem()'), ('public.zell_purge_snapshot_hash(integer[])'), ('public.zell_purge_trg_append_only()')) f(s)
                 where pg_catalog.has_function_privilege(r.n, f.s, 'EXECUTE'))
     or pg_catalog.has_function_privilege('anon', 'public.zell_purge_preview(integer[])', 'EXECUTE') or pg_catalog.has_function_privilege('service_role', 'public.zell_purge_preview(integer[])', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.zell_purge_orders(integer[], text, integer, uuid)', 'EXECUTE') or pg_catalog.has_function_privilege('service_role', 'public.zell_purge_orders(integer[], text, integer, uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.zell_purge_reauth_begin(uuid)', 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', 'public.zell_purge_reauth_begin(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)', 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', 'public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)', 'EXECUTE')
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n), (values ('public.zell_purge_log'), ('public.zell_purge_reauth'), ('public.zell_purge_attempts')) t(s)
                 where pg_catalog.has_table_privilege(r.n, t.s, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polname like 'zell\_purge\_%') <> 32
     or (select s.v from (select pg_catalog.string_agg(x.v, ',' order by x.v collate "C") as v
    from (select p.schemaname::text || '.' || p.tablename::text || '/' || p.policyname::text || '/' || p.cmd || '/' || p.permissive || '/' || p.roles::text
                 || '/' || coalesce(p.qual, '-') || '/' || coalesce(p.with_check, '-') as v
            from pg_catalog.pg_policies p
           where p.policyname like 'zell\_purge\_%' or 'zell_purge_definer' = any (p.roles)) x) s) is distinct from 'public.order_events/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.order_events/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.order_items/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.order_items/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.order_payments/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.order_payments/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.order_payments/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.orders/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.orders/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.orders/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_customer_updates/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_customer_updates/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.zell_order_customer_updates/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_customer_updates_log/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_customer_updates_log/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.zell_order_customer_updates_log/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_shipments/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_shipments/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.zell_order_shipments/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_shipments_log/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_order_shipments_log/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.zell_order_shipments_log/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_payment_commands/zell_purge_delete/DELETE/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_payment_commands/zell_purge_lock/UPDATE/PERMISSIVE/{zell_purge_definer}/true/false,public.zell_payment_commands/zell_purge_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_purge_attempts/zell_purge_attempts_insert/INSERT/PERMISSIVE/{zell_purge_definer}/-/true,public.zell_purge_attempts/zell_purge_attempts_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_purge_attempts/zell_purge_attempts_update/UPDATE/PERMISSIVE/{zell_purge_definer}/true/true,public.zell_purge_log/zell_purge_log_insert/INSERT/PERMISSIVE/{zell_purge_definer}/-/true,public.zell_purge_reauth/zell_purge_reauth_insert/INSERT/PERMISSIVE/{zell_purge_definer}/-/true,public.zell_purge_reauth/zell_purge_reauth_select/SELECT/PERMISSIVE/{zell_purge_definer}/true/-,public.zell_purge_reauth/zell_purge_reauth_update/UPDATE/PERMISSIVE/{zell_purge_definer}/true/true'
     or (select pg_catalog.count(*) from pg_catalog.pg_trigger g where g.tgrelid = 'public.zell_purge_log'::regclass and not g.tgisinternal and g.tgenabled = 'O') <> 2
     or (select s.v from (with recursive d(coid, child) as (
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
                   join pg_catalog.pg_class pc on pc.oid = c.confrelid join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace) x) s) is distinct from 'public.order_events(order_id)>public.orders(id):order_events_order_fkey:c:a:s:false,public.order_items(order_id)>public.orders(id):order_items_order_id_fkey:c:a:s:false,public.order_payments(order_id)>public.orders(id):order_payments_order_fkey:r:a:s:false,public.zell_order_customer_updates(order_id)>public.orders(id):zell_order_customer_updates_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(order_id)>public.orders(id):zell_order_customer_updates_log_order_fkey:r:a:s:false,public.zell_order_customer_updates_log(update_id)>public.zell_order_customer_updates(id):zell_order_customer_updates_log_update_fkey:r:a:s:false,public.zell_order_shipments(order_id)>public.orders(id):zell_order_shipments_order_fkey:r:a:s:false,public.zell_order_shipments_log(order_id)>public.orders(id):zell_order_shipments_log_order_fkey:r:a:s:false,public.zell_payment_commands(order_id)>public.orders(id):zell_payment_commands_order_fkey:r:a:s:false'
     or pg_catalog.has_schema_privilege('zell_purge_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0024_POST_SHAPE';
  end if;
end
$q24$;
-- <<< 0024 BODY
commit;
