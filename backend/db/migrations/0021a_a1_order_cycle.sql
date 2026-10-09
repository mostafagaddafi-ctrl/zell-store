-- 0021-A A1 — أساس دورة الطلب في الداتابيز (SQL بس)
--
-- العقد: docs/contracts/0021-A.md (معتمد، #115). التفاصيل والقرارات التنفيذية في §١٣ منه.
--   • الحالات: preparing و refused اتضافوا للقيد ولجدول الانتقالات order_status_transitions، وورا «البوابة» (zell_order_gate)
--     المقفولة افتراضيًا. وهي مقفولة: الانتقال للحالتين مرفوض من أي طريق (45406)، والطريق القديم (PATCH المباشر من اللوحة
--     بـ service_role) شغّال زي النهارده. بعد فتحها (خطوة مستقلة بموافقة المالك بعد A2): أي تغيير مباشر للحالة = 45407.
--   • الدوال العامة الـ 11 zell_order_* بهوية الجلسة (sub من request.jwt.claims بدور authenticated + صف شغّال في admin_users)،
--     من غير p_actor. EXECUTE لـ authenticated بس. الانتقال والمكالمة والمتابعة والموعد المؤكد والتعديل والملاحظة:
--     قفل الصف FOR UPDATE + فحص updated_at بدقة الميلي ثانية + حدث في order_events في نفس المعاملة.
--   • order_events append-only (و created من trigger على orders، من غير أي تعديل في zell_create_order).
--   • order_delivery_periods: الفترات بقيم افتراضية 09–12 · 12–17 · 17–21 (القاهرة)، والمالك بس بيعدّلها.
--   • المالك zell_order_definer (NOLOGIN · NOBYPASSRLS · NOINHERIT): CREATE تحت SET LOCAL ROLE (بروتوكول 04-DB-SAFETY).
--   • الأكواد: 45400..45414 (نطاق 0021-أ 45400..45449). الـ preflight والـ postflight: ZELL_0021A1_*.
--   • الطلبات القديمة ماتتلمسش: الأعمدة الجديدة فاضية، ومفيش backfill للسجل.
--
-- التحقق بعد التطبيق: 0021a_a1_order_cycle_verify.sql · الرجوع: 0021a_a1_order_cycle_rollback.sql
-- الاختبار قبل التطبيق: 0021a_a1_order_cycle_ptest.sql · CI: backend/db/ci/0021a_sql_ci.sh
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد backup، وقت طلبات قليلة (ALTER TABLE orders بياخد قفل ACCESS EXCLUSIVE
--   لثواني). لو مالقاش قفل في 5 ثواني بيفشل كله بأمان.

begin;
-- >>> 0021A1 BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight
do $a1pre$
declare
  v_def text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A1_WRONG_CALLER';
  end if;
  if not (select r.rolcreaterole from pg_catalog.pg_roles r where r.rolname = current_user) then
    raise exception 'ZELL_0021A1_NO_CREATEROLE';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0021A1_SERVER_VERSION';
  end if;
  if coalesce(pg_catalog.current_setting('createrole_self_grant', true), '') ilike '%inherit%' then
    raise exception 'ZELL_0021A1_CREATEROLE_SELF_GRANT';
  end if;
  if pg_catalog.to_regrole('service_role') is null or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null then
    raise exception 'ZELL_0021A1_CALLER_ROLES_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%')
     or pg_catalog.to_regclass('public.order_events') is not null
     or pg_catalog.to_regclass('public.order_status_transitions') is not null
     or pg_catalog.to_regclass('public.order_delivery_periods') is not null
     or pg_catalog.to_regclass('public.zell_order_gate') is not null
     or pg_catalog.to_regclass('public.zell_order_config_log') is not null then
    raise exception 'ZELL_0021A1_ALREADY_APPLIED';
  end if;
  if pg_catalog.to_regclass('public.orders') is null or pg_catalog.to_regclass('public.admin_users') is null then
    raise exception 'ZELL_0021A1_TABLES_MISSING';
  end if;
  -- الأعمدة اللي A1 بيعتمد عليها موجودة، والجديدة مش موجودة.
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = 'public.orders'::regclass and not a.attisdropped
         and a.attname in ('id', 'status', 'created_at', 'updated_at', 'customer_name', 'customer_phone',
                           'address', 'notes', 'internal_notes', 'coupon_id')) <> 10 then
    raise exception 'ZELL_0021A1_ORDERS_SHAPE';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                and a.attname in ('next_follow_up_at', 'delivery_confirmed_date', 'delivery_confirmed_period',
                                  'delivery_confirmed_note')) then
    raise exception 'ZELL_0021A1_ORDERS_COLUMNS_PRESENT';
  end if;
  if (select pg_catalog.format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a
       where a.attrelid = 'public.orders'::regclass and a.attname = 'id') <> 'integer' then
    raise exception 'ZELL_0021A1_ORDERS_ID_TYPE';
  end if;
  -- قيد الحالة النهارده: الخمس حالات بالظبط.
  select pg_catalog.pg_get_constraintdef(c.oid) into v_def
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check' and c.contype = 'c';
  if v_def is null or v_def not like '%''new''%' or v_def not like '%''confirmed''%' or v_def not like '%''shipped''%'
     or v_def not like '%''delivered''%' or v_def not like '%''cancelled''%'
     or v_def like '%''preparing''%' or v_def like '%''refused''%' then
    raise exception 'ZELL_0021A1_STATUS_CHECK_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_cancelled_final' and not t.tgisinternal) then
    raise exception 'ZELL_0021A1_CANCELLED_FINAL_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid = 'public.orders'::regclass and t.tgname in ('orders_status_guard', 'orders_created_event')) then
    raise exception 'ZELL_0021A1_TRIGGERS_PRESENT';
  end if;
  if not (select c.relrowsecurity and not c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = 'public.orders'::regclass) then
    raise exception 'ZELL_0021A1_ORDERS_RLS_SHAPE';
  end if;
end
$a1pre$;

-- (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي) + SET، و INHERIT FALSE.
create role zell_order_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;
grant zell_order_definer to postgres with inherit false, set true;

do $a1role$
begin
  if not exists (select 1 from pg_catalog.pg_auth_members m
                  where m.roleid = 'zell_order_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_order_definer'::regrole and m.member = 'postgres'::regrole and m.set_option)
     or exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_order_definer'::regrole and m.member = 'postgres'::regrole and m.inherit_option) then
    raise exception 'ZELL_0021A1_ROLE_MEMBERSHIP_SHAPE';
  end if;
end
$a1role$;

grant usage on schema public to zell_order_definer;

-- (2) orders: أعمدة جديدة (فاضية) + الحالتين الجداد في القيد. الصفوف القديمة ماتتغيّرش.
alter table public.orders
  add column next_follow_up_at timestamptz,
  add column delivery_confirmed_date date,
  add column delivery_confirmed_period text,
  add column delivery_confirmed_note text,
  add constraint orders_delivery_confirmed_shape check (
    (delivery_confirmed_date is null and delivery_confirmed_period is null and delivery_confirmed_note is null)
    or (delivery_confirmed_date is not null
        and (delivery_confirmed_period is null or delivery_confirmed_period in ('morning', 'noon', 'evening'))
        and (delivery_confirmed_note is null
             or (pg_catalog.char_length(delivery_confirmed_note) between 1 and 200
                 and delivery_confirmed_note = pg_catalog.btrim(delivery_confirmed_note))))
  );

-- قيد الحالة: 7 حالات. التعريف القديم (متعرّف برّه ملفات الـ migration) بيتحفظ بالحرف في تعليق القيد الجديد،
-- والـ rollback بيرجّعه زي ما كان.
do $a1status$
declare
  v_def text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into strict v_def
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check' and c.contype = 'c';
  alter table public.orders
    drop constraint orders_status_check,
    add constraint orders_status_check check (
      status in ('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'refused')
    );
  execute pg_catalog.format('comment on constraint orders_status_check on public.orders is %L', 'zell-0021a1-previous: ' || v_def);
end
$a1status$;

-- الدور بيقرا الطلبات ويعدّل أعمدة الدورة بس (مفيش أي عمود فلوس). RLS: policy للدور بس.
grant select on table public.orders to zell_order_definer;
grant update (status, updated_at, customer_name, customer_phone, address, notes, internal_notes,
              next_follow_up_at, delivery_confirmed_date, delivery_confirmed_period, delivery_confirmed_note)
  on table public.orders to zell_order_definer;
create policy zell_order_definer_select on public.orders for select to zell_order_definer using (true);
create policy zell_order_definer_update on public.orders for update to zell_order_definer using (true) with check (true);

-- (3) الجداول الجديدة (مالكها postgres): RLS + policy للدور بس، وصفر صلاحيات لأي دور تاني.
create table public.order_status_transitions (
  from_status text not null,
  to_status   text not null,
  gate        text not null constraint order_status_transitions_gate_check check (gate in ('any', 'open', 'closed')),
  constraint order_status_transitions_pkey primary key (from_status, to_status)
);
insert into public.order_status_transitions (from_status, to_status, gate) values
  ('new', 'confirmed', 'any'),
  ('new', 'cancelled', 'any'),
  ('confirmed', 'preparing', 'open'),
  ('confirmed', 'shipped', 'closed'),
  ('confirmed', 'cancelled', 'any'),
  ('preparing', 'shipped', 'open'),
  ('preparing', 'cancelled', 'open'),
  ('shipped', 'delivered', 'any'),
  ('shipped', 'refused', 'open');

create table public.order_events (
  id         bigint generated always as identity constraint order_events_pkey primary key,
  order_id   integer not null constraint order_events_order_fkey references public.orders (id) on delete cascade,
  kind       text not null constraint order_events_kind_check check (kind in (
               'created', 'status_changed', 'call_attempt', 'follow_up_set', 'delivery_preferred_set',
               'delivery_confirmed_set', 'details_edited', 'note_changed', 'payment_recorded', 'payment_refunded')),
  actor      uuid,
  payload    jsonb not null default '{}'::jsonb
             constraint order_events_payload_check check (pg_catalog.jsonb_typeof(payload) = 'object'
                                                          and pg_catalog.pg_column_size(payload) <= 8000),
  created_at timestamptz not null default pg_catalog.now()
);
create index order_events_order_idx on public.order_events (order_id, id desc);

create table public.order_delivery_periods (
  period     text not null constraint order_delivery_periods_pkey primary key
             constraint order_delivery_periods_period_check check (period in ('morning', 'noon', 'evening')),
  starts_at  time not null,
  ends_at    time not null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint order_delivery_periods_range_check check (starts_at < ends_at)
);
insert into public.order_delivery_periods (period, starts_at, ends_at) values
  ('morning', '09:00', '12:00'),
  ('noon', '12:00', '17:00'),
  ('evening', '17:00', '21:00');

create table public.zell_order_gate (
  id         boolean not null default true constraint zell_order_gate_pkey primary key
             constraint zell_order_gate_single check (id),
  is_open    boolean not null default false,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid
);
insert into public.zell_order_gate (id, is_open) values (true, false);

create table public.zell_order_config_log (
  id         bigint generated always as identity constraint zell_order_config_log_pkey primary key,
  kind       text not null constraint zell_order_config_log_kind_check check (kind in ('gate', 'delivery_periods')),
  actor      uuid,
  approval   text,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

revoke all on table public.order_status_transitions, public.order_events, public.order_delivery_periods,
  public.zell_order_gate, public.zell_order_config_log from public, anon, authenticated, service_role;
revoke all on sequence public.order_events_id_seq, public.zell_order_config_log_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.order_status_transitions to zell_order_definer;
grant select, insert on table public.order_events, public.zell_order_config_log to zell_order_definer;
grant select, update on table public.order_delivery_periods, public.zell_order_gate to zell_order_definer;

alter table public.order_status_transitions enable row level security;
alter table public.order_events enable row level security;
alter table public.order_delivery_periods enable row level security;
alter table public.zell_order_gate enable row level security;
alter table public.zell_order_config_log enable row level security;
create policy zell_order_definer_all on public.order_status_transitions for select to zell_order_definer using (true);
create policy zell_order_definer_all on public.order_events for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.order_delivery_periods for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_order_gate for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_order_config_log for all to zell_order_definer using (true) with check (true);

-- (4) الثبات: السجلين append-only، والبوابة صف واحد ومفيش مسح. دوال الـ triggers مالكها postgres (invoker).
create function public.zell_order_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_ORD_APPEND_ONLY' using errcode = '45413';
end
$fn$;

-- أحداث الطلب: مفيش UPDATE ولا TRUNCATE أبدًا. DELETE مرفوض طول ما الطلب موجود؛ بيعدّي بس كـ cascade لمسح الطلب
-- نفسه (تنضيف التجارب قبل A3 — منع مسح الطلبات نفسه في A3، §٢-٦).
create function public.zell_order_trg_events_immutable()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.orders o where o.id = old.order_id) then
    return old;
  end if;
  raise exception 'ZELL_ORD_APPEND_ONLY' using errcode = '45413';
end
$fn$;

create trigger order_events_immutable before update or delete on public.order_events
  for each row execute function public.zell_order_trg_events_immutable();
create trigger order_events_no_truncate before truncate on public.order_events
  for each statement execute function public.zell_order_trg_append_only();
create trigger zell_order_config_log_immutable before update or delete on public.zell_order_config_log
  for each row execute function public.zell_order_trg_append_only();
create trigger zell_order_config_log_no_truncate before truncate on public.zell_order_config_log
  for each statement execute function public.zell_order_trg_append_only();

-- البوابة: صف واحد. مفيش INSERT ولا DELETE ولا TRUNCATE، والـ UPDATE من دالة zell_order_set_gate بس
-- (دور الدالة + علامة محلية للمعاملة بتحطها الدالة وتشيلها). ممنوع UPDATE مباشر على الصف (§٢-١).
create function public.zell_order_trg_gate_guard()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' and current_user = 'zell_order_definer'
     and pg_catalog.current_setting('zell.order_gate_change', true) = 'on' then
    return new;
  end if;
  raise exception 'ZELL_ORD_GATE_LOCKED' using errcode = '45414';
end
$fn$;

create trigger zell_order_gate_guard before insert or update or delete on public.zell_order_gate
  for each row execute function public.zell_order_trg_gate_guard();
create trigger zell_order_gate_no_truncate before truncate on public.zell_order_gate
  for each statement execute function public.zell_order_trg_gate_guard();

-- هوية: دور الممثل من admin_users (مالكها postgres علشان RLS على admin_users؛ EXECUTE للدور بس).
create function public.zell_order_admin_role(p_user uuid)
returns text language sql stable security definer set search_path = '' as $fn$
  select u.role from public.admin_users u where u.user_id = p_user and u.is_active and u.role in ('owner', 'admin')
$fn$;
revoke all on function public.zell_order_admin_role(uuid) from public, anon, authenticated, service_role;
grant execute on function public.zell_order_admin_role(uuid) to zell_order_definer;

-- (5) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

-- sub من JWT الجلسة بشرط role = authenticated، وإلا NULL. نفس منطق zell_inv_claims_actor من غير اعتماد عليها. داخلية.
create function public.zell_order_claims_actor()
returns uuid language plpgsql stable set search_path = '' as $fn$
declare
  v_raw text := nullif(pg_catalog.current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
  v_sub text;
  v_role text;
begin
  if v_raw is not null then
    begin
      v_claims := v_raw::jsonb;
    exception when others then
      return null;
    end;
  end if;
  v_sub := coalesce(v_claims ->> 'sub', nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''));
  v_role := coalesce(v_claims ->> 'role', nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''));
  if v_role is distinct from 'authenticated' or v_sub is null
     or v_sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_sub::uuid;
end
$fn$;

-- الممثل: جلسة + صف شغّال في admin_users (والمالك بس لو p_owner_only). داخلية.
create function public.zell_order_actor(p_owner_only boolean)
returns uuid language plpgsql stable set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_claims_actor();
  v_role text;
begin
  if v_actor is null then
    raise exception 'ZELL_ORD_UNAUTHENTICATED' using errcode = '45400';
  end if;
  v_role := public.zell_order_admin_role(v_actor);
  if v_role is null then
    raise exception 'ZELL_ORD_FORBIDDEN' using errcode = '45401';
  end if;
  if p_owner_only and v_role <> 'owner' then
    raise exception 'ZELL_ORD_OWNER_ONLY' using errcode = '45402';
  end if;
  return v_actor;
end
$fn$;

-- حالة البوابة: بيقراها الـ trigger بصلاحية اللي بيعدّل الطلب، فـ EXECUTE لأدوار الكتابة بس. بترجّع boolean بس.
create function public.zell_order_gate_is_open()
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select g.is_open from public.zell_order_gate g where g.id), false)
$fn$;

-- قفل صف الطلب + فحص النسخة بدقة الميلي ثانية (زي اللوحة النهارده). داخلية.
create function public.zell_order_lock(p_order_id integer, p_expected_updated_at timestamptz)
returns public.orders language plpgsql set search_path = '' as $fn$
declare
  v_order public.orders;
begin
  if p_order_id is null or p_order_id <= 0 then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_order.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  return v_order;
end
$fn$;

-- نص اختياري: trim، والفاضي NULL، وحد أقصى للطول. داخلية.
create function public.zell_order_text(p_value text, p_max integer)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  v text := nullif(pg_catalog.btrim(coalesce(p_value, '')), '');
begin
  if v is not null and pg_catalog.char_length(v) > p_max then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  return v;
end
$fn$;

-- الانتقال: جوه نفس المعاملة (قفل الصف + الجدول + البوابة + الحدث). داخلية؛ النداء من الدوال العامة بعد الهوية والقفل.
create function public.zell_order_apply_transition(p_order public.orders, p_to text, p_actor uuid, p_reason text)
returns timestamptz language plpgsql set search_path = '' as $fn$
declare
  v_gate text;
  v_open boolean := public.zell_order_gate_is_open();
  v_now timestamptz := pg_catalog.now();
begin
  if p_to is null or p_to not in ('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'refused') then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  select t.gate into v_gate from public.order_status_transitions t
   where t.from_status = p_order.status and t.to_status = p_to;
  if v_gate is null or (v_gate = 'closed' and v_open) then
    raise exception 'ZELL_ORD_TRANSITION_NOT_ALLOWED' using errcode = '45405';
  end if;
  if v_gate = 'open' and not v_open then
    raise exception 'ZELL_ORD_GATE_CLOSED' using errcode = '45406';
  end if;
  update public.orders set status = p_to, updated_at = v_now where id = p_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (p_order.id, 'status_changed', p_actor,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('from', p_order.status, 'to', p_to, 'reason', p_reason)));
  return v_now;
end
$fn$;

create function public.zell_order_result(p_order_id integer)
returns jsonb language sql stable set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object('ok', true, 'order_id', o.id, 'status', o.status, 'updated_at', o.updated_at)
    from public.orders o where o.id = p_order_id
$fn$;

-- ── الدوال العامة (EXECUTE لـ authenticated بس) ──

create function public.zell_order_transition(p_order_id integer, p_expected_updated_at timestamptz, p_to text,
                                             p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
begin
  perform public.zell_order_apply_transition(v_order, p_to, v_actor, public.zell_order_text(p_reason, 300));
  return public.zell_order_result(p_order_id);
end
$fn$;

create function public.zell_order_record_call(p_order_id integer, p_expected_updated_at timestamptz, p_outcome text,
                                              p_note text default null, p_follow_up_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
  v_note text := public.zell_order_text(p_note, 300);
  v_now timestamptz := pg_catalog.now();
begin
  if p_outcome is null or p_outcome not in ('no_answer', 'busy', 'wrong_number', 'callback_later', 'confirmed',
                                            'agreed_awaiting_deposit', 'customer_cancelled') then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  if v_order.status <> 'new' then
    raise exception 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' using errcode = '45410';
  end if;
  if p_outcome = 'callback_later' then
    if p_follow_up_at is null then
      raise exception 'ZELL_ORD_FOLLOW_UP_REQUIRED' using errcode = '45409';
    end if;
    if p_follow_up_at < v_now - interval '5 minutes' or p_follow_up_at > v_now + interval '366 days' then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
  elsif p_follow_up_at is not null then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  insert into public.order_events (order_id, kind, actor, payload)
  values (v_order.id, 'call_attempt', v_actor,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('outcome', p_outcome, 'note', v_note)));
  if p_outcome = 'callback_later' then
    update public.orders set next_follow_up_at = p_follow_up_at, updated_at = v_now where id = v_order.id;
    insert into public.order_events (order_id, kind, actor, payload)
    values (v_order.id, 'follow_up_set', v_actor,
            pg_catalog.jsonb_build_object('old', v_order.next_follow_up_at, 'new', p_follow_up_at, 'note', v_note));
  elsif p_outcome = 'confirmed' then
    perform public.zell_order_apply_transition(v_order, 'confirmed', v_actor, 'call');
  elsif p_outcome = 'customer_cancelled' then
    perform public.zell_order_apply_transition(v_order, 'cancelled', v_actor, 'call');
  else
    update public.orders set updated_at = v_now where id = v_order.id;
  end if;
  return public.zell_order_result(p_order_id);
end
$fn$;

create function public.zell_order_set_follow_up(p_order_id integer, p_expected_updated_at timestamptz,
                                                p_follow_up_at timestamptz, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
  v_note text := public.zell_order_text(p_note, 300);
  v_now timestamptz := pg_catalog.now();
begin
  if v_order.status <> 'new' then
    raise exception 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' using errcode = '45410';
  end if;
  if p_follow_up_at is not null
     and (p_follow_up_at < v_now - interval '5 minutes' or p_follow_up_at > v_now + interval '366 days') then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  update public.orders set next_follow_up_at = p_follow_up_at, updated_at = v_now where id = v_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (v_order.id, 'follow_up_set', v_actor,
          pg_catalog.jsonb_build_object('old', v_order.next_follow_up_at, 'new', p_follow_up_at, 'note', v_note));
  return public.zell_order_result(p_order_id);
end
$fn$;

create function public.zell_order_set_confirmed_delivery(p_order_id integer, p_expected_updated_at timestamptz,
                                                         p_date date, p_period text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
  v_note text := public.zell_order_text(p_note, 200);
  v_now timestamptz := pg_catalog.now();
begin
  if v_order.status in ('delivered', 'refused', 'cancelled') then
    raise exception 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' using errcode = '45410';
  end if;
  if p_date is null then
    if p_period is not null or v_note is not null then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
  elsif (p_period is not null and p_period not in ('morning', 'noon', 'evening'))
        or p_date < (v_order.created_at at time zone 'Africa/Cairo')::date
        or p_date > (v_now at time zone 'Africa/Cairo')::date + 366 then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  update public.orders
     set delivery_confirmed_date = p_date, delivery_confirmed_period = p_period, delivery_confirmed_note = v_note,
         updated_at = v_now
   where id = v_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (v_order.id, 'delivery_confirmed_set', v_actor, pg_catalog.jsonb_build_object(
    'old', pg_catalog.jsonb_build_object('date', v_order.delivery_confirmed_date, 'period', v_order.delivery_confirmed_period,
                                         'note', v_order.delivery_confirmed_note),
    'new', pg_catalog.jsonb_build_object('date', p_date, 'period', p_period, 'note', v_note)));
  return public.zell_order_result(p_order_id);
end
$fn$;

-- تعديل بيانات الزبون: في «جديد» بس. الاسم والعنوان والملاحظات، والتليفون بس لو الطلب من غير كوبون.
create function public.zell_order_edit_details(p_order_id integer, p_expected_updated_at timestamptz, p_changes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
  v_now timestamptz := pg_catalog.now();
  v_key text;
  v_name text := v_order.customer_name;
  v_phone text := v_order.customer_phone;
  v_address text := v_order.address;
  v_notes text := v_order.notes;
  v_changed integer := 0;
begin
  if v_order.status <> 'new' then
    raise exception 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' using errcode = '45410';
  end if;
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_changes) as k loop
    if v_key not in ('customer_name', 'customer_phone', 'address', 'notes')
       or (v_key <> 'notes' and pg_catalog.jsonb_typeof(p_changes -> v_key) <> 'string')
       or (v_key = 'notes' and pg_catalog.jsonb_typeof(p_changes -> v_key) not in ('string', 'null')) then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
  end loop;
  if p_changes ? 'customer_name' then
    v_name := pg_catalog.btrim(p_changes ->> 'customer_name');
    if pg_catalog.char_length(v_name) < 3 or pg_catalog.char_length(v_name) > 100 then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
  end if;
  if p_changes ? 'address' then
    v_address := pg_catalog.btrim(p_changes ->> 'address');
    if pg_catalog.char_length(v_address) < 8 or pg_catalog.char_length(v_address) > 500 then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
  end if;
  if p_changes ? 'notes' then
    v_notes := public.zell_order_text(p_changes ->> 'notes', 500);
  end if;
  if p_changes ? 'customer_phone' then
    v_phone := p_changes ->> 'customer_phone';
    if v_phone !~ '^01[0125][0-9]{8}$' then
      raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
    end if;
    if v_phone is distinct from v_order.customer_phone and v_order.coupon_id is not null then
      raise exception 'ZELL_ORD_PHONE_HAS_COUPON' using errcode = '45411';
    end if;
  end if;
  if v_name is distinct from v_order.customer_name then
    insert into public.order_events (order_id, kind, actor, payload) values (v_order.id, 'details_edited', v_actor,
      pg_catalog.jsonb_build_object('field', 'customer_name', 'old', v_order.customer_name, 'new', v_name));
    v_changed := v_changed + 1;
  end if;
  if v_phone is distinct from v_order.customer_phone then
    insert into public.order_events (order_id, kind, actor, payload) values (v_order.id, 'details_edited', v_actor,
      pg_catalog.jsonb_build_object('field', 'customer_phone', 'old', v_order.customer_phone, 'new', v_phone));
    v_changed := v_changed + 1;
  end if;
  if v_address is distinct from v_order.address then
    insert into public.order_events (order_id, kind, actor, payload) values (v_order.id, 'details_edited', v_actor,
      pg_catalog.jsonb_build_object('field', 'address', 'old', v_order.address, 'new', v_address));
    v_changed := v_changed + 1;
  end if;
  if v_notes is distinct from v_order.notes then
    insert into public.order_events (order_id, kind, actor, payload) values (v_order.id, 'details_edited', v_actor,
      pg_catalog.jsonb_build_object('field', 'notes', 'old', v_order.notes, 'new', v_notes));
    v_changed := v_changed + 1;
  end if;
  if v_changed = 0 then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  update public.orders
     set customer_name = v_name, customer_phone = v_phone, address = v_address, notes = v_notes, updated_at = v_now
   where id = v_order.id;
  return public.zell_order_result(p_order_id);
end
$fn$;

create function public.zell_order_set_internal_note(p_order_id integer, p_expected_updated_at timestamptz, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders := public.zell_order_lock(p_order_id, p_expected_updated_at);
  v_note text := public.zell_order_text(p_note, 2000);
begin
  update public.orders set internal_notes = v_note, updated_at = pg_catalog.now() where id = v_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (v_order.id, 'note_changed', v_actor, pg_catalog.jsonb_build_object('new', v_note));
  return public.zell_order_result(p_order_id);
end
$fn$;

create function public.zell_order_events(p_order_id integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  if p_order_id is null or not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', e.id, 'kind', e.kind, 'actor', e.actor,
                                                              'created_at', e.created_at, 'payload', e.payload) order by e.id desc)
      from (select * from public.order_events e2 where e2.order_id = p_order_id order by e2.id desc limit 500) e
  ), '[]'::jsonb);
end
$fn$;

create function public.zell_order_delivery_periods()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return (
    select pg_catalog.jsonb_build_object(
             'updated_at', max(p.updated_at),
             'periods', pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'period', p.period,
                          'starts_at', pg_catalog.to_char(p.starts_at, 'HH24:MI'),
                          'ends_at', pg_catalog.to_char(p.ends_at, 'HH24:MI'))
                        order by case p.period when 'morning' then 1 when 'noon' then 2 else 3 end))
      from public.order_delivery_periods p);
end
$fn$;

-- الفترات: المالك بس. التلاتة مع بعض، HH:MI بتوقيت القاهرة، البداية أقل من النهاية، ومفيش تداخل.
create function public.zell_order_save_delivery_periods(p_expected_updated_at timestamptz, p_periods jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_current timestamptz;
  v_old jsonb;
  v_rows record;
  v_prev_end time;
  v_i integer := 0;
  v_now timestamptz := pg_catalog.now();
begin
  perform 1 from public.order_delivery_periods p for update;
  select max(p.updated_at), pg_catalog.jsonb_object_agg(p.period, pg_catalog.jsonb_build_object(
           'starts_at', pg_catalog.to_char(p.starts_at, 'HH24:MI'), 'ends_at', pg_catalog.to_char(p.ends_at, 'HH24:MI')))
    into v_current, v_old
    from public.order_delivery_periods p;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_current) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_periods is null or pg_catalog.jsonb_typeof(p_periods) <> 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(p_periods)) <> 3
     or not (p_periods ? 'morning' and p_periods ? 'noon' and p_periods ? 'evening') then
    raise exception 'ZELL_ORD_PERIODS_INVALID' using errcode = '45412';
  end if;
  v_prev_end := null;
  for v_rows in
    select k.key as period, k.value ->> 'starts_at' as s, k.value ->> 'ends_at' as e
      from pg_catalog.jsonb_each(p_periods) k
     order by k.value ->> 'starts_at'
  loop
    v_i := v_i + 1;
    -- الترتيب ثابت: الصبح ثم الضهر ثم بالليل.
    if v_rows.period is distinct from (array['morning', 'noon', 'evening'])[v_i]
       or v_rows.s is null or v_rows.e is null
       or v_rows.s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_rows.e !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_rows.s::time >= v_rows.e::time
       or (v_prev_end is not null and v_rows.s::time < v_prev_end) then
      raise exception 'ZELL_ORD_PERIODS_INVALID' using errcode = '45412';
    end if;
    v_prev_end := v_rows.e::time;
  end loop;
  update public.order_delivery_periods p
     set starts_at = (p_periods -> p.period ->> 'starts_at')::time,
         ends_at = (p_periods -> p.period ->> 'ends_at')::time,
         updated_at = v_now
   where p.period in ('morning', 'noon', 'evening');
  insert into public.zell_order_config_log (kind, actor, old_value, new_value)
  values ('delivery_periods', v_actor, v_old, p_periods);
  return public.zell_order_delivery_periods();
end
$fn$;

create function public.zell_order_gate_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return (select pg_catalog.jsonb_build_object('is_open', g.is_open, 'changed_at', g.changed_at)
            from public.zell_order_gate g where g.id);
end
$fn$;

-- فتح / قفل البوابة: المالك بهوية الجلسة + نص موافقة إجباري. كل تغيير سطر في السجل (مين · إمتى · من/لـ).
create function public.zell_order_set_gate(p_open boolean, p_approval text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_gate public.zell_order_gate;
  v_now timestamptz := pg_catalog.now();
begin
  if p_open is null or p_approval is null
     or p_approval !~ '^owner-approval-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]{1,60}$' then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  select g.* into v_gate from public.zell_order_gate g where g.id for update;
  if v_gate.is_open = p_open then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  perform pg_catalog.set_config('zell.order_gate_change', 'on', true);
  update public.zell_order_gate set is_open = p_open, changed_at = v_now, changed_by = v_actor where id;
  perform pg_catalog.set_config('zell.order_gate_change', '', true);
  insert into public.zell_order_config_log (kind, actor, approval, old_value, new_value)
  values ('gate', v_actor, p_approval,
          pg_catalog.jsonb_build_object('is_open', v_gate.is_open, 'changed_at', v_gate.changed_at),
          pg_catalog.jsonb_build_object('is_open', p_open, 'changed_at', v_now));
  return pg_catalog.jsonb_build_object('is_open', p_open, 'changed_at', v_now);
end
$fn$;

-- حدث «created» لكل طلب جديد، ذرّي مع الطلب (fail-closed): لو تسجيله فشل لأي سبب، الخطأ بيطلع وإنشاء الطلب كله
-- بيترجع. مفيش طلب من غير سجله.
create function public.zell_order_trg_created_event()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.order_events (order_id, kind, actor, payload)
  values (new.id, 'created', null, pg_catalog.jsonb_build_object('status', new.status));
  return new;
end
$fn$;

reset role;
revoke create on schema public from zell_order_definer;

-- (6) triggers على orders.
-- الحارس: (أ) الحالتين الجداد مرفوضين طول ما البوابة مقفولة، من أي طريق. (ب) بعد فتح البوابة، تغيير الحالة من
-- برّه دوال الدورة (PATCH مباشر) مرفوض. قبل الفتح، الطريق القديم شغّال زي النهارده.
create function public.zell_order_trg_status_guard()
returns trigger language plpgsql set search_path = '' as $fn$
declare
  v_open boolean;
begin
  -- الإنشاء (zell_create_order بدور zell_order_writer): مابيقراش البوابة. الحالتين الجداد مش حالة بداية.
  if tg_op = 'INSERT' then
    if new.status in ('preparing', 'refused') then
      raise exception 'ZELL_ORD_TRANSITION_NOT_ALLOWED' using errcode = '45405';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_open := public.zell_order_gate_is_open();
  if new.status in ('preparing', 'refused') and not v_open then
    raise exception 'ZELL_ORD_GATE_CLOSED' using errcode = '45406';
  end if;
  if v_open and current_user <> 'zell_order_definer' then
    raise exception 'ZELL_ORD_DIRECT_STATUS_LOCKED' using errcode = '45407';
  end if;
  return new;
end
$fn$;

create trigger orders_status_guard before insert or update of status on public.orders
  for each row execute function public.zell_order_trg_status_guard();
create trigger orders_created_event after insert on public.orders
  for each row execute function public.zell_order_trg_created_event();

-- (7) EXECUTE: الكل مسحوب، وبعدين: العامة الـ 11 لـ authenticated (منهم البوابة، للمالك بس جوه الدالة) · حالة البوابة لأدوار الكتابة (للـ trigger).
-- دوال الدور بيغيّر صلاحياتها مالكها بس (postgres عضو من غير inherit)، فـ SET LOCAL ROLE تاني.
set local role zell_order_definer;
revoke all on function public.zell_order_claims_actor(), public.zell_order_actor(boolean), public.zell_order_gate_is_open(),
  public.zell_order_lock(integer, timestamptz), public.zell_order_text(text, integer),
  public.zell_order_apply_transition(public.orders, text, uuid, text), public.zell_order_result(integer),
  public.zell_order_transition(integer, timestamptz, text, text),
  public.zell_order_record_call(integer, timestamptz, text, text, timestamptz),
  public.zell_order_set_follow_up(integer, timestamptz, timestamptz, text),
  public.zell_order_set_confirmed_delivery(integer, timestamptz, date, text, text),
  public.zell_order_edit_details(integer, timestamptz, jsonb),
  public.zell_order_set_internal_note(integer, timestamptz, text),
  public.zell_order_events(integer), public.zell_order_delivery_periods(),
  public.zell_order_save_delivery_periods(timestamptz, jsonb), public.zell_order_gate_state(),
  public.zell_order_set_gate(boolean, text), public.zell_order_trg_created_event()
  from public, anon, authenticated, service_role;

grant execute on function
  public.zell_order_transition(integer, timestamptz, text, text),
  public.zell_order_record_call(integer, timestamptz, text, text, timestamptz),
  public.zell_order_set_follow_up(integer, timestamptz, timestamptz, text),
  public.zell_order_set_confirmed_delivery(integer, timestamptz, date, text, text),
  public.zell_order_edit_details(integer, timestamptz, jsonb),
  public.zell_order_set_internal_note(integer, timestamptz, text),
  public.zell_order_events(integer), public.zell_order_delivery_periods(),
  public.zell_order_save_delivery_periods(timestamptz, jsonb), public.zell_order_gate_state(),
  public.zell_order_set_gate(boolean, text)
  to authenticated;
-- الحارس بيقرا البوابة بصلاحية اللي بيغيّر الحالة: اللوحة (service_role) ومحرّر SQL (postgres). boolean بس.
grant execute on function public.zell_order_gate_is_open() to postgres, service_role;
reset role;

-- دوال الـ triggers بتاعة postgres (admin_role اتسحبت وقت إنشائها).
revoke all on function public.zell_order_trg_status_guard(), public.zell_order_trg_append_only(),
  public.zell_order_trg_events_immutable(), public.zell_order_trg_gate_guard()
  from public, anon, authenticated, service_role;

-- (8) postflight
do $a1post$
declare
  v_n integer;
begin
  if (select count(*) from public.order_status_transitions) <> 9
     or (select count(*) from public.order_delivery_periods) <> 3
     or (select count(*) from public.zell_order_gate where not is_open) <> 1 then
    raise exception 'ZELL_0021A1_POST_SEED';
  end if;
  select count(*) into v_n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%';
  if v_n <> 24 then
    raise exception 'ZELL_0021A1_POST_FUNCTIONS %', v_n;
  end if;
  select count(*) into v_n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%'
     and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_n <> 11 then
    raise exception 'ZELL_0021A1_POST_AUTH_EXECUTE %', v_n;
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%'
                and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     or (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                         and p.proname <> 'zell_order_gate_is_open'))) then
    raise exception 'ZELL_0021A1_POST_EXECUTE_LEAK';
  end if;
  if exists (select 1 from pg_catalog.pg_class c
              where c.oid in ('public.order_status_transitions'::regclass, 'public.order_events'::regclass,
                              'public.order_delivery_periods'::regclass, 'public.zell_order_gate'::regclass,
                              'public.zell_order_config_log'::regclass)
                and (not c.relrowsecurity
                     or pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')
                     or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
                     or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'))) then
    raise exception 'ZELL_0021A1_POST_TABLE_PRIVILEGES';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.orders'::regclass and t.tgname in ('orders_status_guard', 'orders_created_event')) <> 2 then
    raise exception 'ZELL_0021A1_POST_TRIGGERS';
  end if;
  if pg_catalog.pg_get_constraintdef((select c.oid from pg_catalog.pg_constraint c
       where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check')) not like '%''refused''%' then
    raise exception 'ZELL_0021A1_POST_STATUS_CHECK';
  end if;
end
$a1post$;
-- <<< 0021A1 BODY
commit;
