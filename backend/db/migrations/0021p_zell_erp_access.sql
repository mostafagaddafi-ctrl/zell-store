-- 0021-P — الصلاحيات: محوّل ZELL (zell_erp_*)
--
-- العقد المعتمد: مسودة ٤ + Delta مسودة ٥ + قرارات المراجع بعد الـ Spike.
--   • ده المكان الوحيد اللي بيربط المحرك (erp_*) بجداول ZELL. المحرك نفسه مابيقراش ولا بيكتب جداول ZELL.
--   • بيستبدل جسم الواجهة erp_actor_status_v1 بس (نفس الشكل والخصائص)، وبعد كده مالكها zell_erp_definer.
--   • zell_erp_definer مالوش أي صلاحية على admin_users؛ بيعدّي من دوال مساعدة ضيقة مالكها postgres (نمط 0020).
--   • حماية آخر مالك: عدّاد في صف واحد (zell_erp_owner_guard) بيتعدّل من trigger AFTER ROW على admin_users.
--     تعديل نفس الصف بيخلّي المعاملات تستنى بعض: READ COMMITTED = التعديل على آخر قيمة محفوظة،
--     REPEATABLE READ / SERIALIZABLE = 40001. اتثبت باتصالين متزامنين على PG 15 و17 (Spike 8260b53).
--   • ممنوع تغيير user_id (45310) · TRUNCATE على admin_users (45311) · تعديل العدّاد مباشرة (45312) ·
--     آخر مالك (45303) · العدّاد مختلف عن العدد الفعلي = الإدارة مقفولة (45314).
--   • كل تغيير على admin_users (حتى اليدوي) بيتسجّل في zell_erp_admin_users_log (append-only).
--   • بيسجّل صلاحيات zell.* والقالبين، وبيمنح كل أدمن شغال قالب «أدمن (زي النهارده)» منح صريح، بسطر سجل
--     مصدره migration ومعاه اسم اللي وافق.
--
-- التشغيل: لازم في نفس الجلسة قبل الملف:
--   select pg_catalog.set_config('zell.approved_by', '<اسم الموافقة وتاريخها>', false);
-- الترتيب: 0021p_erp_access.sql ← الملف ده.
-- ⚠ بيتطبّق على Production بموافقة صريحة بس. بياخد SHARE ROW EXCLUSIVE على admin_users لحد آخر المعاملة (ثواني).

begin;
-- >>> 0021P ADAPTER BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight
do $zpre$
declare
  v_n integer;
  v_src text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021P_WRONG_CALLER';
  end if;
  if coalesce(btrim(pg_catalog.current_setting('zell.approved_by', true)), '') = '' then
    raise exception 'ZELL_0021P_APPROVER_REQUIRED';
  end if;
  if pg_catalog.to_regrole('erp_definer') is null
     or pg_catalog.to_regprocedure('public.erp_actor_status_v1(uuid)') is null
     or pg_catalog.to_regprocedure('public.erp_actor_status_contract_version()') is null
     or pg_catalog.to_regclass('public.erp_capabilities') is null then
    raise exception 'ZELL_0021P_ENGINE_MISSING';
  end if;
  select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p.prosrc), '\s+', ' ', 'g')) into v_src
    from pg_catalog.pg_proc p where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure;
  if v_src <> 'select false, false;'
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
          where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) <> 'postgres' then
    raise exception 'ZELL_0021P_INTERFACE_NOT_DEFAULT';
  end if;
  if pg_catalog.to_regrole('zell_erp_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_erp\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace and c.relname like 'zell\_erp\_%')
     or exists (select 1 from public.erp_capabilities c where c.key like 'zell.%') then
    raise exception 'ZELL_0021P_ALREADY_PRESENT';
  end if;

  select count(*) into v_n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.admin_users'::regclass and a.attnum > 0 and not a.attisdropped
     and (a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)) in
         (('user_id', 'uuid'), ('role', 'text'), ('is_active', 'boolean'));
  if v_n <> 3 then
    raise exception 'ZELL_0021P_ADMIN_USERS_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = 'public.admin_users'::regclass and a.attname = 'created_at'
                    and a.attnum > 0 and not a.attisdropped) then
    raise exception 'ZELL_0021P_ADMIN_USERS_CREATED_AT';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.admin_users'::regclass and c.conname = 'admin_users_role_check' and c.contype = 'c')
     or not exists (select 1 from pg_catalog.pg_index i
                     where i.indrelid = 'public.admin_users'::regclass and i.indisprimary
                       and i.indnatts = 1
                       and i.indkey[0] = (select a.attnum from pg_catalog.pg_attribute a
                                           where a.attrelid = 'public.admin_users'::regclass and a.attname = 'user_id')) then
    raise exception 'ZELL_0021P_ADMIN_USERS_CONSTRAINTS';
  end if;
  if not exists (select 1 from public.admin_users u where u.role = 'owner' and u.is_active) then
    raise exception 'ZELL_0021P_NO_ACTIVE_OWNER';
  end if;
end
$zpre$;


-- (1) الدور
create role zell_erp_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;
grant zell_erp_definer to postgres with inherit false, set true;

do $zrole$
begin
  if not exists (select 1 from pg_catalog.pg_auth_members m
                  where m.roleid = 'zell_erp_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_erp_definer'::regrole and m.member = 'postgres'::regrole and m.set_option)
     or exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_erp_definer'::regrole and m.member = 'postgres'::regrole and m.inherit_option) then
    raise exception 'ZELL_0021P_ROLE_MEMBERSHIP_SHAPE';
  end if;
end
$zrole$;

grant usage on schema public to zell_erp_definer;
grant create on schema public to zell_erp_definer;


-- (2) العدّاد وسجل admin_users (مالكهم postgres، RLS من غير policies، وصفر صلاحيات لأي دور تاني)
lock table public.admin_users in share row exclusive mode;

create table public.zell_erp_owner_guard (
  id                 smallint primary key,
  active_owner_count integer  not null,
  constraint zell_erp_owner_guard_singleton check (id = 1),
  constraint zell_erp_owner_guard_count check (active_owner_count >= 0)
);

create table public.zell_erp_admin_users_log (
  id            bigint      generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  operation     text        not null,
  user_id       uuid        not null,
  old_role      text,
  new_role      text,
  old_is_active boolean,
  new_is_active boolean,
  db_user       text        not null,
  app_actor     uuid,
  constraint zell_erp_admin_users_log_operation check (operation in ('INSERT', 'UPDATE', 'DELETE'))
);

-- القيمة الأولى تحت القفل (مفيش تعديل على admin_users ممكن يحصل في النص).
insert into public.zell_erp_owner_guard (id, active_owner_count)
select 1, count(*)::integer from public.admin_users a where a.role = 'owner' and a.is_active;

revoke all on table public.zell_erp_owner_guard, public.zell_erp_admin_users_log
  from public, anon, authenticated, service_role;
revoke all on sequence public.zell_erp_admin_users_log_id_seq from public, anon, authenticated, service_role;
alter table public.zell_erp_owner_guard enable row level security;
alter table public.zell_erp_admin_users_log enable row level security;


-- (3) دوال الـ triggers (مالكها postgres)
-- العدّاد مايتعدّلش غير من trigger الحماية (عمق ≥ 2).
create function public.zell_erp_owner_guard_no_direct()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_catalog.pg_trigger_depth() <= 1 then
    raise exception 'ZELL_ERP_OWNER_GUARD_DIRECT_WRITE' using errcode = '45312';
  end if;
  if tg_level = 'STATEMENT' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$fn$;

create function public.zell_erp_trg_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ZELL_ERP_IMMUTABLE' using errcode = '45315', detail = tg_table_name || '.' || lower(tg_op);
end
$fn$;

create function public.zell_erp_admin_users_user_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'ZELL_ERP_ADMIN_USER_ID_IMMUTABLE' using errcode = '45310';
  end if;
  return new;
end
$fn$;

-- AFTER ROW عشان INSERT ... ON CONFLICT DO UPDATE مايتحسبش مرتين. SECURITY DEFINER عشان يشتغل لأي منفّذ.
create function public.zell_erp_owner_guard_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old integer := 0;
  v_new integer := 0;
  v_count integer;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.is_active then
    v_old := 1;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' and new.is_active then
    v_new := 1;
  end if;
  if v_new - v_old <> 0 then
    update public.zell_erp_owner_guard g
       set active_owner_count = g.active_owner_count + (v_new - v_old)
     where g.id = 1
    returning g.active_owner_count into v_count;
    if not found then
      raise exception 'ZELL_ERP_OWNER_GUARD_MISSING' using errcode = '45303';
    end if;
    if v_count < 1 then
      raise exception 'ZELL_ERP_LAST_OWNER' using errcode = '45303';
    end if;
  end if;
  return null;
end
$fn$;

create function public.zell_erp_admin_users_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ZELL_ERP_ADMIN_USERS_TRUNCATE' using errcode = '45311';
end
$fn$;

-- كل تغيير على admin_users (حتى اليدوي) بيتسجّل. app_actor من zell.actor لو المحوّل هو اللي عدّل.
create function public.zell_erp_admin_users_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_text text := pg_catalog.current_setting('zell.actor', true);
  v_actor uuid;
begin
  if v_actor_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor := v_actor_text::uuid;
  end if;
  insert into public.zell_erp_admin_users_log (
    operation, user_id, old_role, new_role, old_is_active, new_is_active, db_user, app_actor)
  values (
    tg_op, coalesce(new.user_id, old.user_id), old.role, new.role, old.is_active, new.is_active,
    session_user::text, v_actor);
  return null;
end
$fn$;

revoke all on function
  public.zell_erp_owner_guard_no_direct(),
  public.zell_erp_trg_immutable(),
  public.zell_erp_admin_users_user_id_immutable(),
  public.zell_erp_owner_guard_count(),
  public.zell_erp_admin_users_no_truncate(),
  public.zell_erp_admin_users_log_change()
from public, anon, authenticated, service_role;

create trigger zell_erp_owner_guard_no_direct
  before insert or update or delete on public.zell_erp_owner_guard
  for each row execute function public.zell_erp_owner_guard_no_direct();
create trigger zell_erp_owner_guard_no_truncate
  before truncate on public.zell_erp_owner_guard
  for each statement execute function public.zell_erp_owner_guard_no_direct();
create trigger zell_erp_admin_users_log_immutable
  before update or delete on public.zell_erp_admin_users_log
  for each row execute function public.zell_erp_trg_immutable();
create trigger zell_erp_admin_users_log_no_truncate
  before truncate on public.zell_erp_admin_users_log
  for each statement execute function public.zell_erp_trg_immutable();

create trigger zell_erp_admin_users_user_id_immutable
  before update on public.admin_users
  for each row execute function public.zell_erp_admin_users_user_id_immutable();
create trigger zell_erp_owner_guard_count
  after insert or update or delete on public.admin_users
  for each row execute function public.zell_erp_owner_guard_count();
create trigger zell_erp_admin_users_log_change
  after insert or update or delete on public.admin_users
  for each row execute function public.zell_erp_admin_users_log_change();
create trigger zell_erp_admin_users_no_truncate
  before truncate on public.admin_users
  for each statement execute function public.zell_erp_admin_users_no_truncate();


-- (4) الدوال المساعدة الضيقة (مالكها postgres، EXECUTE لـ zell_erp_definer بس)
create function public.zell_erp_admin_status(p_user uuid)
returns table (found boolean, is_active boolean, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*) > 0,
         coalesce(bool_or(a.is_active), false),
         coalesce(bool_or(a.role = 'owner'), false)
    from public.admin_users a
   where a.user_id = p_user;
$fn$;

create function public.zell_erp_admin_set_active(p_target uuid, p_active boolean, p_actor uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  perform pg_catalog.set_config('zell.actor', coalesce(p_actor::text, ''), true);
  update public.admin_users a set is_active = p_active where a.user_id = p_target;
  get diagnostics v_n = row_count;
  perform pg_catalog.set_config('zell.actor', '', true);
  return v_n = 1;
end
$fn$;

create function public.zell_erp_admin_list()
returns table (user_id uuid, role text, is_active boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.user_id, a.role, a.is_active, a.created_at::timestamptz
    from public.admin_users a
   order by a.created_at, a.user_id;
$fn$;

create function public.zell_erp_owner_guard_lock()
returns table (guard_count integer, actual_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_guard integer;
  v_actual integer;
begin
  select g.active_owner_count into v_guard from public.zell_erp_owner_guard g where g.id = 1 for update;
  select count(*)::integer into v_actual from public.admin_users a where a.role = 'owner' and a.is_active;
  return query select v_guard, v_actual;
end
$fn$;

create function public.zell_erp_owner_guard_read()
returns table (guard_count integer, actual_count integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  select (select g.active_owner_count from public.zell_erp_owner_guard g where g.id = 1),
         (select count(*)::integer from public.admin_users a where a.role = 'owner' and a.is_active);
$fn$;

revoke all on function
  public.zell_erp_admin_status(uuid),
  public.zell_erp_admin_set_active(uuid, boolean, uuid),
  public.zell_erp_admin_list(),
  public.zell_erp_owner_guard_lock(),
  public.zell_erp_owner_guard_read()
from public, anon, authenticated, service_role;
grant execute on function
  public.zell_erp_admin_status(uuid),
  public.zell_erp_admin_set_active(uuid, boolean, uuid),
  public.zell_erp_admin_list(),
  public.zell_erp_owner_guard_lock(),
  public.zell_erp_owner_guard_read()
to zell_erp_definer;


-- (5) الواجهة: نفس الشكل والخصائص، والجسم بس اللي بيتغيّر. المالك بيبقى zell_erp_definer.
create temporary table zell_0021p_iface_before on commit drop as
select p.prosecdef, p.provolatile, p.proconfig::text as config, p.prorettype, p.proretset,
       p.proargtypes::text as argtypes, p.proallargtypes::text as allargs, p.proargnames::text as argnames,
       p.proargmodes::text as argmodes, p.prolang, p.proparallel, p.proleakproof, p.prokind
  from pg_catalog.pg_proc p
 where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure;

alter function public.erp_actor_status_v1(uuid) owner to zell_erp_definer;
set local role zell_erp_definer;
create or replace function public.erp_actor_status_v1(p_user uuid)
returns table (is_active boolean, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select s.is_active, s.is_owner from public.zell_erp_admin_status(p_user) s;
$fn$;
reset role;

do $ziface$
begin
  if exists (
    select p.prosecdef, p.provolatile, p.proconfig::text, p.prorettype, p.proretset,
           p.proargtypes::text, p.proallargtypes::text, p.proargnames::text, p.proargmodes::text,
           p.prolang, p.proparallel, p.proleakproof, p.prokind
      from pg_catalog.pg_proc p
     where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure
    except
    select b.prosecdef, b.provolatile, b.config, b.prorettype, b.proretset, b.argtypes, b.allargs, b.argnames,
           b.argmodes, b.prolang, b.proparallel, b.proleakproof, b.prokind
      from pg_temp.zell_0021p_iface_before b) then
    raise exception 'ZELL_0021P_INTERFACE_ATTRIBUTES_CHANGED';
  end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
       where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) <> 'zell_erp_definer' then
    raise exception 'ZELL_0021P_INTERFACE_OWNER';
  end if;
  if pg_catalog.has_function_privilege('service_role', 'public.erp_actor_status_v1(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.erp_actor_status_v1(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.erp_actor_status_v1(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('erp_definer', 'public.erp_actor_status_v1(uuid)', 'EXECUTE') then
    raise exception 'ZELL_0021P_INTERFACE_ACL';
  end if;
end
$ziface$;


-- (6) دوال المحوّل العامة (مالكها zell_erp_definer، SECURITY DEFINER، EXECUTE لـ service_role)
-- إيقاف وتشغيل حساب: owner-only، بسبب، ومن غير ما تقدر توقف نفسك. بيتسجّل في سجل المحرك ومنع التكرار بتاعه.
create function public.zell_erp_set_user_active(p_actor uuid, p_command_id uuid, p_target uuid, p_active boolean, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_op text;
  v_reason text;
  v_hash text;
  v_prior jsonb;
  v_found boolean;
  v_active boolean;
  v_owner boolean;
  v_guard integer;
  v_actual integer;
  v_code text;
  v_before text[];
  v_after text[];
begin
  if p_target is null or p_active is null then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'set_user_active';
  end if;
  v_op := case when p_active then 'activate' else 'suspend' end;
  v_reason := public.erp_access_reason(p_reason, true);
  v_hash := public.erp_access_request_hash(pg_catalog.jsonb_build_object(
    'op', v_op, 'target', p_target, 'reason', v_reason));
  v_prior := public.erp_access_command_begin(p_actor, p_command_id, v_op, v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  if not public.erp_has_capability(p_actor, 'erp.access.manage') then
    v_code := '45300';
  elsif p_target = p_actor then
    v_code := '45301';
  else
    select s.found, s.is_active, s.is_owner into v_found, v_active, v_owner from public.zell_erp_admin_status(p_target) s;
    if not v_found then
      v_code := '45305';
    end if;
  end if;
  if v_code is not null then
    return public.erp_access_command_finish(p_actor, p_command_id, v_op, v_hash, public.erp_access_denial(v_code),
                                            p_target, null, null, null, null);
  end if;

  -- قفل العدّاد قبل القرار: العمليات المتزامنة على المُلّاك بتستنى بعض.
  select g.guard_count, g.actual_count into v_guard, v_actual from public.zell_erp_owner_guard_lock() g;
  if v_guard is null or v_guard <> v_actual then
    raise exception 'ZELL_ERP_OWNER_GUARD_DRIFT' using errcode = '45314';
  end if;
  select s.is_active, s.is_owner into v_active, v_owner from public.zell_erp_admin_status(p_target) s;
  if not p_active and v_owner and v_active and v_guard <= 1 then
    return public.erp_access_command_finish(p_actor, p_command_id, v_op, v_hash, public.erp_access_denial('45303'),
                                            p_target, null, null, null, null);
  end if;

  v_before := case when v_active then array['active'] else '{}'::text[] end;
  if v_active is distinct from p_active then
    if not public.zell_erp_admin_set_active(p_target, p_active, p_actor) then
      raise exception 'ZELL_ERP_TARGET_VANISHED' using errcode = '45305';
    end if;
  end if;
  v_after := case when p_active then array['active'] else '{}'::text[] end;
  return public.erp_access_command_finish(p_actor, p_command_id, v_op, v_hash,
    pg_catalog.jsonb_build_object('ok', true, 'isActive', p_active),
    p_target, null, v_before, v_after, v_reason);
end
$fn$;

create function public.zell_erp_access_users(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.erp_has_capability(p_actor, 'erp.access.view') then
    raise exception 'ERP_FORBIDDEN' using errcode = '45300', detail = 'erp.access.view';
  end if;
  return pg_catalog.jsonb_build_object('users', coalesce((
    select jsonb_agg(pg_catalog.jsonb_build_object(
             'userId', l.user_id, 'role', l.role, 'isActive', l.is_active, 'createdAt', l.created_at)
             order by l.created_at, l.user_id)
      from public.zell_erp_admin_list() l), '[]'::jsonb));
end
$fn$;

-- تقرير المطابقة: القاعدة القديمة (أدمن شغال = كل صفحات الأدمن، مالك = كل حاجة، موقوف = ولا حاجة)
-- قدام الصلاحيات الجديدة لكل مستخدم، والعدّاد قدام العدد الفعلي.
create function public.zell_erp_access_parity(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_preset text[];
  v_users jsonb := '[]'::jsonb;
  v_mismatches integer := 0;
  r record;
  v_expected text[];
  v_actual text[];
  v_missing text[];
  v_extra text[];
  v_guard integer;
  v_owners integer;
begin
  if not public.erp_has_capability(p_actor, 'erp.access.view') then
    raise exception 'ERP_FORBIDDEN' using errcode = '45300', detail = 'erp.access.view';
  end if;
  v_preset := public.erp_access_preset_keys('zell.admin_today');
  for r in select l.user_id, l.role, l.is_active from public.zell_erp_admin_list() l loop
    if r.role = 'admin' and r.is_active then
      v_expected := v_preset;
      v_actual := public.erp_access_user_keys(r.user_id);
    else
      v_expected := '{}'::text[];
      v_actual := '{}'::text[];
    end if;
    select coalesce(array_agg(k.k order by k.k), '{}'::text[]) into v_missing
      from unnest(v_expected) as k(k) where not (k.k = any (v_actual));
    select coalesce(array_agg(k.k order by k.k), '{}'::text[]) into v_extra
      from unnest(v_actual) as k(k) where not (k.k = any (v_expected));
    if cardinality(v_missing) > 0 or cardinality(v_extra) > 0 then
      v_mismatches := v_mismatches + 1;
    end if;
    v_users := v_users || jsonb_build_array(pg_catalog.jsonb_build_object(
      'userId', r.user_id, 'role', r.role, 'isActive', r.is_active,
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)));
  end loop;
  select g.guard_count, g.actual_count into v_guard, v_owners from public.zell_erp_owner_guard_read() g;
  return pg_catalog.jsonb_build_object(
    'clean', v_mismatches = 0 and v_guard = v_owners and v_owners >= 1,
    'mismatches', v_mismatches,
    'guard', pg_catalog.jsonb_build_object('count', v_guard, 'actual', v_owners),
    'users', v_users);
end
$fn$;

revoke all on function
  public.zell_erp_set_user_active(uuid, uuid, uuid, boolean, text),
  public.zell_erp_access_users(uuid),
  public.zell_erp_access_parity(uuid)
from public, anon, authenticated, service_role;
alter function public.zell_erp_set_user_active(uuid, uuid, uuid, boolean, text) owner to zell_erp_definer;
alter function public.zell_erp_access_users(uuid) owner to zell_erp_definer;
alter function public.zell_erp_access_parity(uuid) owner to zell_erp_definer;

-- دوال المحرك الداخلية اللي المحوّل محتاجها (الـ grant من مالكها erp_definer).
set local role erp_definer;
grant execute on function
  public.erp_has_capability(uuid, text),
  public.erp_access_request_hash(jsonb),
  public.erp_access_denial(text),
  public.erp_access_reason(text, boolean),
  public.erp_access_user_keys(uuid),
  public.erp_access_preset_keys(text),
  public.erp_access_command_begin(uuid, uuid, text, text),
  public.erp_access_command_finish(uuid, uuid, text, text, jsonb, uuid, text, text[], text[], text)
to zell_erp_definer;
reset role;

set local role zell_erp_definer;
grant execute on function
  public.zell_erp_set_user_active(uuid, uuid, uuid, boolean, text),
  public.zell_erp_access_users(uuid),
  public.zell_erp_access_parity(uuid)
to service_role;
reset role;

revoke create on schema public from zell_erp_definer;


-- (7) صلاحيات ZELL والقوالب
insert into public.erp_capabilities (key, category, description) values
  ('zell.dashboard.view', 'sales', 'الرئيسية'),
  ('zell.orders.view', 'sales', 'عرض الطلبات وتفاصيلها'),
  ('zell.orders.status_edit', 'sales', 'تغيير حالة الطلب (بيتشال في 0021-A)'),
  ('zell.orders.note_edit', 'sales', 'الملاحظات الداخلية على الطلب'),
  ('zell.products.view', 'sales', 'عرض المنتجات'),
  ('zell.products.edit', 'sales', 'حفظ المنتج والإظهار والترتيب والعروض والإضافات'),
  ('zell.products.images_edit', 'operational', 'صور المنتجات'),
  ('zell.collections.view', 'operational', 'عرض الأقسام'),
  ('zell.collections.edit', 'operational', 'تعديل الأقسام والغلاف ومنتجات الرئيسية'),
  ('zell.content.view', 'operational', 'عرض المحتوى'),
  ('zell.content.edit', 'operational', 'تعديل المحتوى وصور الموقع'),
  ('zell.identity.view', 'operational', 'عرض هوية المتجر'),
  ('zell.identity.edit', 'operational', 'تعديل الهوية ونص العرض والسوشيال'),
  ('zell.shipping.view', 'sales', 'عرض الشحن'),
  ('zell.shipping.edit', 'sales', 'تعديل الشحن والمناطق'),
  ('zell.installation.view', 'sales', 'عرض فني التركيب'),
  ('zell.installation.edit', 'sales', 'تعديل فني التركيب'),
  ('zell.installation_tools.view', 'operational', 'عرض صفحة أدوات التركيب'),
  ('zell.installation_tools.edit', 'operational', 'تعديل صفحة أدوات التركيب'),
  ('zell.settings.view', 'operational', 'الإعدادات وحالة النظام'),
  ('zell.telegram.test', 'operational', 'اختبار تليجرام'),
  ('zell.storefront.revalidate', 'operational', 'تحديث المتجر'),
  ('zell.coupons.view', 'owner', 'عرض أكواد الخصم'),
  ('zell.coupons.edit', 'owner', 'تعديل أكواد الخصم'),
  ('zell.inventory0020.view', 'owner', 'عرض المخزون والمشتريات (0020)'),
  ('zell.inventory0020.edit', 'owner', 'كتابة المخزون والمشتريات (0020)'),
  ('zell.unimplemented', 'owner', 'أكشنز لسه مش متعملة');

insert into public.erp_presets (key, name) values
  ('zell.admin_today', 'أدمن (زي النهارده)'),
  ('zell.warehouse', 'مخزن');

insert into public.erp_preset_items (preset_key, capability_key)
select 'zell.admin_today', c.key
  from public.erp_capabilities c
 where c.key like 'zell.%' and c.category in ('operational', 'sales');


-- (8) المنح الصريح لكل أدمن شغال (لقطة من القالب)، بسطر سجل مصدره migration.
do $zseed$
declare
  v_by text := left(btrim(pg_catalog.current_setting('zell.approved_by', true)), 120);
  v_keys text[];
  r record;
begin
  select array_agg(i.capability_key order by i.capability_key) into v_keys
    from public.erp_preset_items i where i.preset_key = 'zell.admin_today';
  for r in select a.user_id from public.admin_users a where a.role = 'admin' and a.is_active order by a.user_id loop
    insert into public.erp_user_grants (user_id, capability_key, preset_key, granted_by, command_id)
    select r.user_id, k.k, 'zell.admin_today', null, null from unnest(v_keys) as k(k);
    insert into public.erp_user_access (user_id, version) values (r.user_id, 1);
    insert into public.erp_access_audit (
      source, actor_user_id, target_user_id, operation, subject_key, outcome, code,
      command_id, request_hash, before_keys, after_keys, reason, approved_by)
    values ('migration', null, r.user_id, 'apply_preset', 'zell.admin_today', 'ok', null,
            null, null, '{}'::text[], v_keys, null, v_by);
  end loop;
end
$zseed$;


-- (9) postflight
do $zpost$
declare
  v_list text;
  v_bad text;
  v_owner uuid;
  v_r jsonb;
begin
  if (select g.active_owner_count from public.zell_erp_owner_guard g where g.id = 1)
     is distinct from (select count(*)::integer from public.admin_users a where a.role = 'owner' and a.is_active) then
    raise exception 'ZELL_0021P_GUARD_MISMATCH';
  end if;
  if (select count(*) from public.erp_capabilities c where c.key like 'zell.%') <> 27
     or (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') <> 22
     or exists (select 1 from public.erp_preset_items i where i.preset_key = 'zell.warehouse') then
    raise exception 'ZELL_0021P_CATALOG_SHAPE';
  end if;

  select string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_erp\_%'
     and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v_list is distinct from 'zell_erp_access_parity,zell_erp_access_users,zell_erp_set_user_active' then
    raise exception 'ZELL_0021P_SERVICE_EXECUTE_SET %', coalesce(v_list, '');
  end if;

  select string_agg(p.proname::text, ',') into v_bad
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_erp\_%'
     and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'ZELL_0021P_PUBLIC_EXECUTE %', v_bad;
  end if;

  select string_agg(c.relname::text, ',') into v_bad
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname like 'zell\_erp\_%' and c.relkind = 'r'
     and (pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('zell_erp_definer', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or not c.relrowsecurity);
  if v_bad is not null then
    raise exception 'ZELL_0021P_TABLE_PRIVILEGES %', v_bad;
  end if;

  if pg_catalog.has_table_privilege('zell_erp_definer', 'public.admin_users', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'ZELL_0021P_DEFINER_TOUCHES_ADMIN_USERS';
  end if;

  select string_agg(t.tgname::text, ',') into v_bad
    from (values ('zell_erp_admin_users_user_id_immutable'), ('zell_erp_owner_guard_count'),
                 ('zell_erp_admin_users_log_change'), ('zell_erp_admin_users_no_truncate')) as t(tgname)
   where not exists (select 1 from pg_catalog.pg_trigger g
                      where g.tgrelid = 'public.admin_users'::regclass and g.tgname = t.tgname and g.tgenabled = 'O');
  if v_bad is not null then
    raise exception 'ZELL_0021P_TRIGGERS_MISSING %', v_bad;
  end if;

  select a.user_id into v_owner from public.admin_users a where a.role = 'owner' and a.is_active
   order by a.created_at, a.user_id limit 1;
  set local role zell_erp_definer;
  select pg_catalog.to_jsonb(s) into v_r from public.erp_actor_status_v1(v_owner) s;
  if v_r is distinct from '{"is_active": true, "is_owner": true}'::jsonb then
    raise exception 'ZELL_0021P_INTERFACE_OWNER_CHECK %', coalesce(v_r::text, 'null');
  end if;
  select pg_catalog.to_jsonb(s) into v_r from public.erp_actor_status_v1(gen_random_uuid()) s;
  if v_r is distinct from '{"is_active": false, "is_owner": false}'::jsonb then
    raise exception 'ZELL_0021P_INTERFACE_UNKNOWN_CHECK %', coalesce(v_r::text, 'null');
  end if;
  v_r := public.zell_erp_access_parity(v_owner);
  reset role;
  if not coalesce((v_r ->> 'clean')::boolean, false) then
    raise exception 'ZELL_0021P_PARITY %', v_r::text;
  end if;
end
$zpost$;

-- <<< 0021P ADAPTER BODY
commit;
