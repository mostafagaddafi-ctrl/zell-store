-- 0021-P — اختبار قبل التطبيق (pre-apply ptest) لـ 0021p_erp_access.sql + 0021p_zell_erp_access.sql
--
-- • قبل التطبيق بس (لو أي جزء متطبّق بيقف بـ ZELL_0021P_PTEST_PRE_APPLY_ONLY). بعد التطبيق: 0021p_access_verify.sql.
-- • كل حاجة جوه معاملة واحدة بتنتهي بـ exception مقصود ثم ROLLBACK — ومنها الأدوار والجداول والدوال الجديدة.
-- • جسمين الـ migration منسوخين بالحرف بين علامات >>> و <<< (الـ CI بيقارن md5 الجسمين في كل تشغيل).
-- • اتصال واحد بس. التزامن نفسه بيتثبت في CI على Postgres مؤقت (backend/db/ci/0021p_sql_ci.sh)، مش هنا.
-- • ملفين تشغيل: production (الافتراضي) — بيستخدم صفوف admin_users الموجودة بس، ومن غير TRUNCATE على admin_users،
--   والاختبارات اللي محتاجة مالك تاني أو أدمن مش موجود بتتعدّى (skip) — و ci (Postgres مؤقت بس).
-- • النداءات كـ service_role (الـ caller الحقيقي)، والممثل (مالك / أدمن / عشوائي / null) منفصل.
-- • النتيجة في رسالة ZELL_0021P_PTEST_RESULT (exception عن قصد، والمعاملة بترجع).
-- • الأثر على Production: SHARE ROW EXCLUSIVE على admin_users لحد آخر المعاملة (ثواني)، وتعديلات على admin_users
--   جوه المعاملة بس (بترجع). ⚠ تشغيله على Production محتاج موافقة منفصلة، وبعد قراءة نسخة PostgreSQL الحية.

begin;
select pg_catalog.set_config('zell.ptest_profile', 'production', true);   -- 'production' | 'ci'
select pg_catalog.set_config('zell.approved_by', 'ptest-0021p', true);

do $zguard$
begin
  if pg_catalog.to_regrole('erp_definer') is not null or pg_catalog.to_regrole('zell_erp_definer') is not null
     or pg_catalog.to_regclass('public.erp_access_audit') is not null
     or pg_catalog.to_regclass('public.zell_erp_owner_guard') is not null then
    raise exception 'ZELL_0021P_PTEST_PRE_APPLY_ONLY';
  end if;
  if pg_catalog.current_setting('zell.ptest_profile', true) not in ('production', 'ci') then
    raise exception 'ZELL_0021P_PTEST_PROFILE';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, name text, outcome text, detail text) on commit drop;
create temporary table zt_fx (owner_a uuid, owner_b uuid, admin_x uuid) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (name, outcome, detail)
  values (p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_skip(p_name text, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (name, outcome, detail) values (p_name, 'skip', p_detail);
$f$;

-- نداء كـ دور معيّن، وأي خطأ بيرجع {_error, _message} بدل ما يوقف الاختبار.
create function pg_temp.as_role(p_role text, p_sql text)
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  begin
    execute 'set local role ' || quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    return jsonb_build_object('_error', sqlstate, '_message', sqlerrm);
  end;
  return r;
end
$f$;

create function pg_temp.svc(p_sql text)
returns jsonb language sql as $f$
  select pg_temp.as_role('service_role', p_sql);
$f$;

-- تنفيذ كـ postgres. بيرجّع sqlstate أو 'none'.
create function pg_temp.pg_err(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate;
end
$f$;

-- أي مفتاح فيه تكلفة أو قيمة مالية في أي مستوى من الـ JSON.
create function pg_temp.bad_keys(p jsonb)
returns text language sql as $f$
  select string_agg(distinct k, ',')
    from jsonb_path_query(coalesce(p, '{}'::jsonb), 'lax $.**') v,
         lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k
   where k ~* '(cost|landed|allocated|margin|profit|treasury|salary)';
$f$;

-- الـ fixtures: من الصفوف الموجودة. ملف ci بس ممكن يضيف صفوف (جوه المعاملة).
do $zfx$
declare
  v_ci boolean := pg_catalog.current_setting('zell.ptest_profile', true) = 'ci';
  v_a uuid;
  v_b uuid;
  v_x uuid;
begin
  select u.user_id into v_a from public.admin_users u where u.role = 'owner' and u.is_active order by u.created_at, u.user_id limit 1;
  if v_a is null then
    raise exception 'ZELL_0021P_PTEST_NO_ACTIVE_OWNER';
  end if;
  select u.user_id into v_b from public.admin_users u where u.role = 'owner' and u.is_active and u.user_id <> v_a order by u.created_at, u.user_id limit 1;
  select u.user_id into v_x from public.admin_users u where u.role = 'admin' and u.is_active order by u.created_at, u.user_id limit 1;
  if v_ci and v_b is null then
    v_b := gen_random_uuid();
    insert into public.admin_users (user_id, role, is_active) values (v_b, 'owner', true);
  end if;
  if v_ci and v_x is null then
    v_x := gen_random_uuid();
    insert into public.admin_users (user_id, role, is_active) values (v_x, 'admin', true);
  end if;
  insert into pg_temp.zt_fx (owner_a, owner_b, admin_x) values (v_a, v_b, v_x);
end
$zfx$;

-- >>> 0021P ENGINE BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight
do $epre$
begin
  if current_user <> 'postgres' then
    raise exception 'ERP_0021P_WRONG_CALLER';
  end if;
  if not (select r.rolcreaterole from pg_catalog.pg_roles r where r.rolname = current_user) then
    raise exception 'ERP_0021P_NO_CREATEROLE';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ERP_0021P_SERVER_VERSION';
  end if;
  if coalesce(pg_catalog.current_setting('createrole_self_grant', true), '') ilike '%inherit%' then
    raise exception 'ERP_0021P_CREATEROLE_SELF_GRANT_UNSUPPORTED';
  end if;
  if pg_catalog.to_regrole('service_role') is null or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null then
    raise exception 'ERP_0021P_CALLER_ROLES_MISSING';
  end if;
  if pg_catalog.to_regrole('erp_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace and c.relname like 'erp\_%') then
    raise exception 'ERP_0021P_ALREADY_PRESENT';
  end if;
end
$epre$;


-- (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي من CREATE ROLE) + SET، و INHERIT FALSE.
create role erp_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;
grant erp_definer to postgres with inherit false, set true;

do $erole$
begin
  if not exists (select 1 from pg_catalog.pg_auth_members m
                  where m.roleid = 'erp_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'erp_definer'::regrole and m.member = 'postgres'::regrole and m.set_option)
     or exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'erp_definer'::regrole and m.member = 'postgres'::regrole and m.inherit_option) then
    raise exception 'ERP_0021P_ROLE_MEMBERSHIP_SHAPE';
  end if;
end
$erole$;

grant usage on schema public to erp_definer;
grant create on schema public to erp_definer;


-- (2) الجداول (مالكها postgres)
create table public.erp_capabilities (
  key         text        primary key,
  category    text        not null,
  description text        not null,
  created_at  timestamptz not null default now(),
  constraint erp_capabilities_key_shape check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' and char_length(key) <= 64),
  constraint erp_capabilities_category check (category in ('operational', 'sales', 'financial', 'owner')),
  constraint erp_capabilities_description check (char_length(description) between 1 and 200)
);

create table public.erp_presets (
  key         text        primary key,
  name        text        not null,
  created_at  timestamptz not null default now(),
  constraint erp_presets_key_shape check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' and char_length(key) <= 64),
  constraint erp_presets_name check (char_length(name) between 1 and 80)
);

create table public.erp_preset_items (
  preset_key     text not null references public.erp_presets (key),
  capability_key text not null references public.erp_capabilities (key),
  primary key (preset_key, capability_key)
);

create table public.erp_user_grants (
  user_id        uuid        not null,
  capability_key text        not null references public.erp_capabilities (key),
  preset_key     text        references public.erp_presets (key),
  granted_at     timestamptz not null default now(),
  granted_by     uuid,
  command_id     uuid,
  primary key (user_id, capability_key)
);

create table public.erp_user_access (
  user_id    uuid        primary key,
  version    integer     not null,
  updated_at timestamptz not null default now(),
  constraint erp_user_access_version check (version >= 0)
);

create table public.erp_commands (
  command_id    uuid        primary key,
  actor_user_id uuid        not null,
  operation     text        not null,
  request_hash  text        not null,
  outcome       text        not null,
  result        jsonb       not null,
  created_at    timestamptz not null default now(),
  constraint erp_commands_outcome check (outcome in ('ok', 'denied')),
  constraint erp_commands_hash_shape check (request_hash ~ '^[0-9a-f]{64}$')
);

create table public.erp_access_audit (
  id             bigint      generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  source         text        not null,
  actor_user_id  uuid,
  target_user_id uuid,
  operation      text        not null,
  subject_key    text,
  outcome        text        not null,
  code           text,
  command_id     uuid,
  request_hash   text,
  before_keys    text[],
  after_keys     text[],
  reason         text,
  approved_by    text,
  constraint erp_access_audit_source check (source in ('rpc', 'migration')),
  constraint erp_access_audit_operation check (operation in ('grant', 'revoke', 'apply_preset', 'revoke_all', 'suspend', 'activate')),
  constraint erp_access_audit_outcome check (outcome in ('ok', 'denied')),
  constraint erp_access_audit_code check (code is null or code ~ '^[0-9]{5}$'),
  constraint erp_access_audit_subject check (subject_key is null or char_length(subject_key) <= 64),
  constraint erp_access_audit_reason check (reason is null or char_length(reason) <= 300),
  constraint erp_access_audit_approved_by check (approved_by is null or char_length(approved_by) between 1 and 120),
  constraint erp_access_audit_denied_minimal check (
    outcome = 'ok' or (before_keys is null and after_keys is null and reason is null and code is not null)),
  constraint erp_access_audit_source_shape check (
    (source = 'rpc' and actor_user_id is not null and command_id is not null and request_hash is not null and approved_by is null)
    or (source = 'migration' and approved_by is not null and command_id is null))
);

create table public.erp_access_shadow_events (
  day            date        not null,
  user_id        uuid        not null,
  route_key      text        not null,
  capability_key text        not null,
  kind           text        not null,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  hits           integer     not null default 1,
  primary key (day, user_id, route_key, capability_key, kind),
  constraint erp_access_shadow_route check (char_length(route_key) between 1 and 200),
  constraint erp_access_shadow_capability check (char_length(capability_key) between 1 and 64),
  constraint erp_access_shadow_kind check (kind in ('legacy_allow_new_deny', 'legacy_deny_new_allow', 'new_unavailable')),
  constraint erp_access_shadow_hits check (hits >= 1)
);

-- الصلاحيات على الجداول: صفر لأي حد غير postgres (المالك) و erp_definer (من الـ policy).
revoke all on table public.erp_capabilities, public.erp_presets, public.erp_preset_items, public.erp_user_grants,
                    public.erp_user_access, public.erp_commands, public.erp_access_audit, public.erp_access_shadow_events
  from public, anon, authenticated, service_role;
revoke all on sequence public.erp_access_audit_id_seq from public, anon, authenticated, service_role;

grant select on table public.erp_capabilities, public.erp_presets, public.erp_preset_items to erp_definer;
grant select, insert, delete on table public.erp_user_grants to erp_definer;
grant select, insert, update on table public.erp_user_access to erp_definer;
grant select, insert on table public.erp_commands, public.erp_access_audit to erp_definer;
grant select, insert, update on table public.erp_access_shadow_events to erp_definer;
grant usage on sequence public.erp_access_audit_id_seq to erp_definer;

alter table public.erp_capabilities enable row level security;
alter table public.erp_presets enable row level security;
alter table public.erp_preset_items enable row level security;
alter table public.erp_user_grants enable row level security;
alter table public.erp_user_access enable row level security;
alter table public.erp_commands enable row level security;
alter table public.erp_access_audit enable row level security;
alter table public.erp_access_shadow_events enable row level security;

create policy erp_definer_all on public.erp_capabilities for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_presets for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_preset_items for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_user_grants for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_user_access for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_commands for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_access_audit for all to erp_definer using (true) with check (true);
create policy erp_definer_all on public.erp_access_shadow_events for all to erp_definer using (true) with check (true);


-- (3) الثبات (دالة trigger مالكها postgres). بتمنع الـDML المباشر، ومش حاجز ضد مالك الكائنات المتعمد.
create function public.erp_trg_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ERP_IMMUTABLE' using errcode = '45315', detail = tg_table_name || '.' || lower(tg_op);
end
$fn$;
revoke all on function public.erp_trg_immutable() from public, anon, authenticated, service_role;

create trigger erp_commands_immutable before update or delete on public.erp_commands
  for each row execute function public.erp_trg_immutable();
create trigger erp_access_audit_immutable before update or delete on public.erp_access_audit
  for each row execute function public.erp_trg_immutable();
create trigger erp_commands_no_truncate before truncate on public.erp_commands
  for each statement execute function public.erp_trg_immutable();
create trigger erp_access_audit_no_truncate before truncate on public.erp_access_audit
  for each statement execute function public.erp_trg_immutable();
create trigger erp_user_grants_no_truncate before truncate on public.erp_user_grants
  for each statement execute function public.erp_trg_immutable();
create trigger erp_user_access_no_truncate before truncate on public.erp_user_access
  for each statement execute function public.erp_trg_immutable();
create trigger erp_capabilities_no_truncate before truncate on public.erp_capabilities
  for each statement execute function public.erp_trg_immutable();
create trigger erp_presets_no_truncate before truncate on public.erp_presets
  for each statement execute function public.erp_trg_immutable();
create trigger erp_preset_items_no_truncate before truncate on public.erp_preset_items
  for each statement execute function public.erp_trg_immutable();
create trigger erp_access_shadow_events_no_truncate before truncate on public.erp_access_shadow_events
  for each statement execute function public.erp_trg_immutable();


-- (4) الواجهة الثابتة (نسخة 1). المحرك بيعملها بجسم بيرفض الكل؛ المحوّل بيستبدل الجسم بس، ومالكها بيبقى المحوّل.
create function public.erp_actor_status_v1(p_user uuid)
returns table (is_active boolean, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select false, false;
$fn$;
revoke all on function public.erp_actor_status_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function public.erp_actor_status_v1(uuid) to erp_definer;

create function public.erp_actor_status_contract_version()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 1;
$fn$;


-- (5) الدوال الداخلية (مالكها erp_definer، ومفيش EXECUTE لـ service_role)
-- قراءة الواجهة مع فحص الشكل: صف واحد بالظبط ومفيش NULL، وإلا 45309 (رفض).
create function public.erp_actor_status(p_user uuid)
returns table (is_active boolean, is_owner boolean)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_n integer := 0;
  v_active boolean;
  v_owner boolean;
  r record;
begin
  if p_user is null then
    return query select false, false;
    return;
  end if;
  for r in select s.is_active as a, s.is_owner as o from public.erp_actor_status_v1(p_user) s loop
    v_n := v_n + 1;
    v_active := r.a;
    v_owner := r.o;
  end loop;
  if v_n <> 1 or v_active is null or v_owner is null then
    raise exception 'ERP_ACTOR_INTERFACE' using errcode = '45309';
  end if;
  return query select v_active, v_owner;
end
$fn$;

-- تجاوز المالك الصريح: المالك الشغال عنده كل صلاحية معروفة. غيره: منح صريح لصلاحية تشغيل أو بيع بس.
create function public.erp_has_capability(p_user uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_active boolean;
  v_owner boolean;
begin
  select s.is_active, s.is_owner into v_active, v_owner from public.erp_actor_status(p_user) s;
  if not coalesce(v_active, false) then
    return false;
  end if;
  if v_owner then
    return exists (select 1 from public.erp_capabilities c where c.key = p_key);
  end if;
  return exists (select 1
                   from public.erp_user_grants g
                   join public.erp_capabilities c on c.key = g.capability_key
                  where g.user_id = p_user and g.capability_key = p_key
                    and c.category in ('operational', 'sales'));
end
$fn$;

create function public.erp_require_capability(p_user uuid, p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.erp_has_capability(p_user, p_key) then
    raise exception 'ERP_FORBIDDEN' using errcode = '45300', detail = left(coalesce(p_key, ''), 64);
  end if;
end
$fn$;

create function public.erp_access_request_hash(p_payload jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload::text, 'UTF8')), 'hex');
$fn$;

create function public.erp_access_denial(p_code text)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('ok', false, 'code', p_code);
$fn$;

-- السبب: NFC + trim. إجباري في السحب والإيقاف، و ≤ 300 حرف. الغلط هنا مدخلات مشوّهة (45313، من غير سطر سجل).
create function public.erp_access_reason(p_reason text, p_required boolean)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
declare
  v text;
begin
  v := nullif(btrim(normalize(coalesce(p_reason, ''), NFC), E' \t\r\n'), '');
  if v is null and p_required then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'reason';
  end if;
  if v is not null and char_length(v) > 300 then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'reason';
  end if;
  return v;
end
$fn$;

create function public.erp_access_lock_user(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('erp_access_user:' || p_user::text, 0));
end
$fn$;

create function public.erp_access_user_keys(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(g.capability_key order by g.capability_key), '{}'::text[])
    from public.erp_user_grants g
   where g.user_id = p_user;
$fn$;

create function public.erp_access_preset_keys(p_preset text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(i.capability_key order by i.capability_key), '{}'::text[])
    from public.erp_preset_items i
   where i.preset_key = p_preset;
$fn$;

create function public.erp_access_user_version(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((select a.version from public.erp_user_access a where a.user_id = p_user), 0);
$fn$;

create function public.erp_access_bump(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v integer;
begin
  insert into public.erp_user_access as a (user_id, version, updated_at)
  values (p_user, 1, now())
  on conflict (user_id) do update set version = a.version + 1, updated_at = now()
  returning a.version into v;
  return v;
end
$fn$;

-- أول خطوة في أي أمر إدارة: قفل الرقم، وبعدين replay (نفس الممثل والعملية والبصمة) أو 45307 من غير سطر.
-- NULL = أمر جديد.
create function public.erp_access_command_begin(p_actor uuid, p_command_id uuid, p_operation text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_operation text;
  v_hash text;
  v_result jsonb;
begin
  if p_actor is null or p_command_id is null or p_operation is null or p_hash is null then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'command';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('erp_access_cmd:' || p_command_id::text, 0));
  select c.actor_user_id, c.operation, c.request_hash, c.result
    into v_actor, v_operation, v_hash, v_result
    from public.erp_commands c
   where c.command_id = p_command_id;
  if not found then
    return null;
  end if;
  if v_actor = p_actor and v_operation = p_operation and v_hash = p_hash then
    return v_result || pg_catalog.jsonb_build_object('replayed', true);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'code', '45307', 'replayed', false);
end
$fn$;

-- آخر خطوة: سطر السجل والأمر في نفس المعاملة. الرفض: أعمدة ثابتة بس (من غير قبل/بعد/سبب).
create function public.erp_access_command_finish(
  p_actor uuid, p_command_id uuid, p_operation text, p_hash text, p_result jsonb,
  p_target uuid, p_subject text, p_before text[], p_after text[], p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
begin
  insert into public.erp_access_audit (
    source, actor_user_id, target_user_id, operation, subject_key, outcome, code,
    command_id, request_hash, before_keys, after_keys, reason, approved_by)
  values (
    'rpc', p_actor, p_target, p_operation, case when p_subject is null then null else left(p_subject, 64) end,
    case when v_ok then 'ok' else 'denied' end,
    case when v_ok then null else p_result ->> 'code' end,
    p_command_id, p_hash,
    case when v_ok then p_before end,
    case when v_ok then p_after end,
    case when v_ok then p_reason end,
    null);
  insert into public.erp_commands (command_id, actor_user_id, operation, request_hash, outcome, result)
  values (p_command_id, p_actor, p_operation, p_hash, case when v_ok then 'ok' else 'denied' end, p_result);
  return p_result;
end
$fn$;

-- فحوص الإدارة المشتركة بالترتيب: صلاحية الإدارة (45300) ← تغيير النفس (45301) ← مالك (45308) ← الحالة (45305).
create function public.erp_access_target_check(p_actor uuid, p_target uuid, p_mode text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_active boolean;
  v_owner boolean;
begin
  if not public.erp_has_capability(p_actor, 'erp.access.manage') then
    return '45300';
  end if;
  if p_target = p_actor then
    return '45301';
  end if;
  select s.is_active, s.is_owner into v_active, v_owner from public.erp_actor_status(p_target) s;
  if v_owner then
    return '45308';
  end if;
  if p_mode = 'grant' and not v_active then
    return '45305';
  end if;
  if p_mode = 'revoke' and not v_active
     and not exists (select 1 from public.erp_user_grants g where g.user_id = p_target) then
    return '45305';
  end if;
  return null;
end
$fn$;


-- (6) الدوال العامة (مالكها erp_definer، SECURITY DEFINER، EXECUTE لـ service_role)
create function public.erp_effective_capabilities(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_active boolean;
  v_owner boolean;
  v_keys text[];
begin
  select s.is_active, s.is_owner into v_active, v_owner from public.erp_actor_status(p_actor) s;
  if not coalesce(v_active, false) then
    return pg_catalog.jsonb_build_object('active', false, 'owner', false, 'capabilities', '[]'::jsonb,
                                         'version', 0, 'contractVersion', public.erp_actor_status_contract_version());
  end if;
  if v_owner then
    select coalesce(array_agg(c.key order by c.key), '{}'::text[]) into v_keys from public.erp_capabilities c;
  else
    select coalesce(array_agg(g.capability_key order by g.capability_key), '{}'::text[]) into v_keys
      from public.erp_user_grants g
      join public.erp_capabilities c on c.key = g.capability_key
     where g.user_id = p_actor and c.category in ('operational', 'sales');
  end if;
  return pg_catalog.jsonb_build_object('active', true, 'owner', v_owner, 'capabilities', to_jsonb(v_keys),
                                       'version', public.erp_access_user_version(p_actor),
                                       'contractVersion', public.erp_actor_status_contract_version());
end
$fn$;

create function public.erp_access_grant(p_actor uuid, p_command_id uuid, p_target uuid, p_capability text, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_key text := nullif(btrim(coalesce(p_capability, '')), '');
  v_hash text;
  v_prior jsonb;
  v_code text;
  v_category text;
  v_before text[];
  v_after text[];
  v_version integer;
begin
  if p_target is null or v_key is null or char_length(v_key) > 64 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'grant';
  end if;
  v_hash := public.erp_access_request_hash(pg_catalog.jsonb_build_object(
    'op', 'grant', 'target', p_target, 'capability', v_key, 'expectedVersion', p_expected_version));
  v_prior := public.erp_access_command_begin(p_actor, p_command_id, 'grant', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  perform public.erp_access_lock_user(p_target);
  v_code := public.erp_access_target_check(p_actor, p_target, 'grant');
  if v_code is null then
    select c.category into v_category from public.erp_capabilities c where c.key = v_key;
    if v_category is null then
      v_code := '45304';
    elsif v_category not in ('operational', 'sales') then
      v_code := '45302';
    elsif public.erp_access_user_version(p_target) <> p_expected_version then
      v_code := '45306';
    end if;
  end if;
  if v_code is not null then
    return public.erp_access_command_finish(p_actor, p_command_id, 'grant', v_hash, public.erp_access_denial(v_code),
                                            p_target, v_key, null, null, null);
  end if;
  v_before := public.erp_access_user_keys(p_target);
  if v_key = any (v_before) then
    v_version := public.erp_access_user_version(p_target);
  else
    insert into public.erp_user_grants (user_id, capability_key, preset_key, granted_by, command_id)
    values (p_target, v_key, null, p_actor, p_command_id);
    v_version := public.erp_access_bump(p_target);
  end if;
  v_after := public.erp_access_user_keys(p_target);
  return public.erp_access_command_finish(p_actor, p_command_id, 'grant', v_hash,
    pg_catalog.jsonb_build_object('ok', true, 'version', v_version, 'capabilities', to_jsonb(v_after)),
    p_target, v_key, v_before, v_after, null);
end
$fn$;

create function public.erp_access_revoke(p_actor uuid, p_command_id uuid, p_target uuid, p_capability text,
                                          p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_key text := nullif(btrim(coalesce(p_capability, '')), '');
  v_reason text;
  v_hash text;
  v_prior jsonb;
  v_code text;
  v_before text[];
  v_after text[];
  v_version integer;
begin
  if p_target is null or v_key is null or char_length(v_key) > 64 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'revoke';
  end if;
  v_reason := public.erp_access_reason(p_reason, true);
  v_hash := public.erp_access_request_hash(pg_catalog.jsonb_build_object(
    'op', 'revoke', 'target', p_target, 'capability', v_key, 'expectedVersion', p_expected_version, 'reason', v_reason));
  v_prior := public.erp_access_command_begin(p_actor, p_command_id, 'revoke', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  perform public.erp_access_lock_user(p_target);
  v_code := public.erp_access_target_check(p_actor, p_target, 'revoke');
  if v_code is null then
    if not exists (select 1 from public.erp_capabilities c where c.key = v_key) then
      v_code := '45304';
    elsif public.erp_access_user_version(p_target) <> p_expected_version then
      v_code := '45306';
    end if;
  end if;
  if v_code is not null then
    return public.erp_access_command_finish(p_actor, p_command_id, 'revoke', v_hash, public.erp_access_denial(v_code),
                                            p_target, v_key, null, null, null);
  end if;
  v_before := public.erp_access_user_keys(p_target);
  if v_key = any (v_before) then
    delete from public.erp_user_grants g where g.user_id = p_target and g.capability_key = v_key;
    v_version := public.erp_access_bump(p_target);
  else
    v_version := public.erp_access_user_version(p_target);
  end if;
  v_after := public.erp_access_user_keys(p_target);
  return public.erp_access_command_finish(p_actor, p_command_id, 'revoke', v_hash,
    pg_catalog.jsonb_build_object('ok', true, 'version', v_version, 'capabilities', to_jsonb(v_after)),
    p_target, v_key, v_before, v_after, v_reason);
end
$fn$;

create function public.erp_access_apply_preset(p_actor uuid, p_command_id uuid, p_target uuid, p_preset text, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_preset text := nullif(btrim(coalesce(p_preset, '')), '');
  v_hash text;
  v_prior jsonb;
  v_code text;
  v_before text[];
  v_after text[];
  v_version integer;
  v_added integer;
begin
  if p_target is null or v_preset is null or char_length(v_preset) > 64 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'apply_preset';
  end if;
  v_hash := public.erp_access_request_hash(pg_catalog.jsonb_build_object(
    'op', 'apply_preset', 'target', p_target, 'preset', v_preset, 'expectedVersion', p_expected_version));
  v_prior := public.erp_access_command_begin(p_actor, p_command_id, 'apply_preset', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  perform public.erp_access_lock_user(p_target);
  v_code := public.erp_access_target_check(p_actor, p_target, 'grant');
  if v_code is null then
    if not exists (select 1 from public.erp_presets p where p.key = v_preset) then
      v_code := '45304';
    elsif exists (select 1 from public.erp_preset_items i
                    join public.erp_capabilities c on c.key = i.capability_key
                   where i.preset_key = v_preset and c.category not in ('operational', 'sales')) then
      v_code := '45302';
    elsif public.erp_access_user_version(p_target) <> p_expected_version then
      v_code := '45306';
    end if;
  end if;
  if v_code is not null then
    return public.erp_access_command_finish(p_actor, p_command_id, 'apply_preset', v_hash, public.erp_access_denial(v_code),
                                            p_target, v_preset, null, null, null);
  end if;
  v_before := public.erp_access_user_keys(p_target);
  -- لقطة: الصلاحيات بتتنسخ منح صريح، وتعديل القالب بعد كده مابيغيّرش اللي اتطبق عليهم.
  insert into public.erp_user_grants (user_id, capability_key, preset_key, granted_by, command_id)
  select p_target, i.capability_key, v_preset, p_actor, p_command_id
    from public.erp_preset_items i
   where i.preset_key = v_preset
  on conflict (user_id, capability_key) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    v_version := public.erp_access_bump(p_target);
  else
    v_version := public.erp_access_user_version(p_target);
  end if;
  v_after := public.erp_access_user_keys(p_target);
  return public.erp_access_command_finish(p_actor, p_command_id, 'apply_preset', v_hash,
    pg_catalog.jsonb_build_object('ok', true, 'version', v_version, 'capabilities', to_jsonb(v_after)),
    p_target, v_preset, v_before, v_after, null);
end
$fn$;

create function public.erp_access_revoke_all(p_actor uuid, p_command_id uuid, p_target uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_hash text;
  v_prior jsonb;
  v_code text;
  v_before text[];
  v_after text[];
  v_version integer;
begin
  if p_target is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'revoke_all';
  end if;
  v_reason := public.erp_access_reason(p_reason, true);
  v_hash := public.erp_access_request_hash(pg_catalog.jsonb_build_object(
    'op', 'revoke_all', 'target', p_target, 'expectedVersion', p_expected_version, 'reason', v_reason));
  v_prior := public.erp_access_command_begin(p_actor, p_command_id, 'revoke_all', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  perform public.erp_access_lock_user(p_target);
  v_code := public.erp_access_target_check(p_actor, p_target, 'revoke');
  if v_code is null and public.erp_access_user_version(p_target) <> p_expected_version then
    v_code := '45306';
  end if;
  if v_code is not null then
    return public.erp_access_command_finish(p_actor, p_command_id, 'revoke_all', v_hash, public.erp_access_denial(v_code),
                                            p_target, null, null, null, null);
  end if;
  v_before := public.erp_access_user_keys(p_target);
  if cardinality(v_before) > 0 then
    delete from public.erp_user_grants g where g.user_id = p_target;
    v_version := public.erp_access_bump(p_target);
  else
    v_version := public.erp_access_user_version(p_target);
  end if;
  v_after := public.erp_access_user_keys(p_target);
  return public.erp_access_command_finish(p_actor, p_command_id, 'revoke_all', v_hash,
    pg_catalog.jsonb_build_object('ok', true, 'version', v_version, 'capabilities', to_jsonb(v_after)),
    p_target, null, v_before, v_after, v_reason);
end
$fn$;

-- القراءات: erp.access.view (المالك). مقفولة لو المحرك مش متاح. مفيش أي مفتاح تكلفة أو قيمة مالية.
create function public.erp_access_snapshot(p_actor uuid)
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
  return pg_catalog.jsonb_build_object(
    'contractVersion', public.erp_actor_status_contract_version(),
    'capabilities', coalesce((select jsonb_agg(pg_catalog.jsonb_build_object(
                                 'key', c.key, 'category', c.category, 'description', c.description,
                                 'grantable', c.category in ('operational', 'sales')) order by c.key)
                                from public.erp_capabilities c), '[]'::jsonb),
    'presets', coalesce((select jsonb_agg(pg_catalog.jsonb_build_object(
                            'key', p.key, 'name', p.name,
                            'capabilities', to_jsonb(public.erp_access_preset_keys(p.key))) order by p.key)
                           from public.erp_presets p), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(pg_catalog.jsonb_build_object(
                          'userId', a.user_id, 'version', a.version,
                          'capabilities', to_jsonb(public.erp_access_user_keys(a.user_id))) order by a.user_id)
                         from public.erp_user_access a), '[]'::jsonb));
end
$fn$;

create function public.erp_access_audit_page(p_actor uuid, p_before_id bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_items jsonb;
  v_last bigint;
  v_n integer;
begin
  if not public.erp_has_capability(p_actor, 'erp.access.view') then
    raise exception 'ERP_FORBIDDEN' using errcode = '45300', detail = 'erp.access.view';
  end if;
  select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb), min(x.id), count(*)
    into v_items, v_last, v_n
    from (select a.id,
                 pg_catalog.jsonb_build_object(
                   'id', a.id, 'occurredAt', a.occurred_at, 'source', a.source,
                   'actorUserId', a.actor_user_id, 'targetUserId', a.target_user_id,
                   'operation', a.operation, 'subject', a.subject_key, 'outcome', a.outcome, 'code', a.code,
                   'before', to_jsonb(a.before_keys), 'after', to_jsonb(a.after_keys),
                   'reason', a.reason, 'approvedBy', a.approved_by) as j
            from public.erp_access_audit a
           where p_before_id is null or a.id < p_before_id
           order by a.id desc
           limit v_limit) x;
  return pg_catalog.jsonb_build_object('items', v_items, 'nextBeforeId', case when v_n = v_limit then v_last end);
end
$fn$;

-- أحداث الـ shadow: best-effort وللفروق بس. سطر واحد لكل (يوم، مستخدم، مسار، صلاحية، نوع).
create function public.erp_record_shadow_event(p_user uuid, p_route_key text, p_capability text, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_user is null or p_route_key is null or char_length(p_route_key) not between 1 and 200
     or p_capability is null or char_length(p_capability) not between 1 and 64
     or p_kind is null or p_kind not in ('legacy_allow_new_deny', 'legacy_deny_new_allow', 'new_unavailable') then
    raise exception 'ERP_INVALID' using errcode = '45313', detail = 'shadow_event';
  end if;
  insert into public.erp_access_shadow_events as e (day, user_id, route_key, capability_key, kind)
  values ((now() at time zone 'UTC')::date, p_user, p_route_key, p_capability, p_kind)
  on conflict (day, user_id, route_key, capability_key, kind)
  do update set hits = e.hits + 1, last_seen = now();
end
$fn$;

create function public.erp_access_shadow_report(p_actor uuid, p_since date)
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
  return pg_catalog.jsonb_build_object('items', coalesce((
    select jsonb_agg(pg_catalog.jsonb_build_object(
             'day', e.day, 'userId', e.user_id, 'routeKey', e.route_key, 'capability', e.capability_key,
             'kind', e.kind, 'hits', e.hits, 'firstSeen', e.first_seen, 'lastSeen', e.last_seen)
             order by e.day desc, e.user_id, e.route_key, e.capability_key, e.kind)
      from public.erp_access_shadow_events e
     where p_since is null or e.day >= p_since), '[]'::jsonb));
end
$fn$;


-- (7) صلاحيات المحرك نفسه (المالك فقط، ومش قابلة للمنح)
insert into public.erp_capabilities (key, category, description) values
  ('erp.access.view', 'owner', 'عرض الصلاحيات والسجل وتقرير المطابقة'),
  ('erp.access.manage', 'owner', 'منح وسحب الصلاحيات وتطبيق القوالب وإيقاف الحسابات');


-- (8) ملكية الدوال: CREATE كـ postgres ← سحب الكل ← OWNER TO erp_definer ← SET LOCAL ROLE (grant) ← RESET ROLE.
revoke all on function
  public.erp_actor_status_contract_version(),
  public.erp_actor_status(uuid),
  public.erp_has_capability(uuid, text),
  public.erp_require_capability(uuid, text),
  public.erp_access_request_hash(jsonb),
  public.erp_access_denial(text),
  public.erp_access_reason(text, boolean),
  public.erp_access_lock_user(uuid),
  public.erp_access_user_keys(uuid),
  public.erp_access_preset_keys(text),
  public.erp_access_user_version(uuid),
  public.erp_access_bump(uuid),
  public.erp_access_command_begin(uuid, uuid, text, text),
  public.erp_access_command_finish(uuid, uuid, text, text, jsonb, uuid, text, text[], text[], text),
  public.erp_access_target_check(uuid, uuid, text),
  public.erp_effective_capabilities(uuid),
  public.erp_access_grant(uuid, uuid, uuid, text, integer),
  public.erp_access_revoke(uuid, uuid, uuid, text, integer, text),
  public.erp_access_apply_preset(uuid, uuid, uuid, text, integer),
  public.erp_access_revoke_all(uuid, uuid, uuid, integer, text),
  public.erp_access_snapshot(uuid),
  public.erp_access_audit_page(uuid, bigint, integer),
  public.erp_record_shadow_event(uuid, text, text, text),
  public.erp_access_shadow_report(uuid, date)
from public, anon, authenticated, service_role;

alter function public.erp_actor_status_contract_version() owner to erp_definer;
alter function public.erp_actor_status(uuid) owner to erp_definer;
alter function public.erp_has_capability(uuid, text) owner to erp_definer;
alter function public.erp_require_capability(uuid, text) owner to erp_definer;
alter function public.erp_access_request_hash(jsonb) owner to erp_definer;
alter function public.erp_access_denial(text) owner to erp_definer;
alter function public.erp_access_reason(text, boolean) owner to erp_definer;
alter function public.erp_access_lock_user(uuid) owner to erp_definer;
alter function public.erp_access_user_keys(uuid) owner to erp_definer;
alter function public.erp_access_preset_keys(text) owner to erp_definer;
alter function public.erp_access_user_version(uuid) owner to erp_definer;
alter function public.erp_access_bump(uuid) owner to erp_definer;
alter function public.erp_access_command_begin(uuid, uuid, text, text) owner to erp_definer;
alter function public.erp_access_command_finish(uuid, uuid, text, text, jsonb, uuid, text, text[], text[], text) owner to erp_definer;
alter function public.erp_access_target_check(uuid, uuid, text) owner to erp_definer;
alter function public.erp_effective_capabilities(uuid) owner to erp_definer;
alter function public.erp_access_grant(uuid, uuid, uuid, text, integer) owner to erp_definer;
alter function public.erp_access_revoke(uuid, uuid, uuid, text, integer, text) owner to erp_definer;
alter function public.erp_access_apply_preset(uuid, uuid, uuid, text, integer) owner to erp_definer;
alter function public.erp_access_revoke_all(uuid, uuid, uuid, integer, text) owner to erp_definer;
alter function public.erp_access_snapshot(uuid) owner to erp_definer;
alter function public.erp_access_audit_page(uuid, bigint, integer) owner to erp_definer;
alter function public.erp_record_shadow_event(uuid, text, text, text) owner to erp_definer;
alter function public.erp_access_shadow_report(uuid, date) owner to erp_definer;

set local role erp_definer;
grant execute on function
  public.erp_effective_capabilities(uuid),
  public.erp_access_grant(uuid, uuid, uuid, text, integer),
  public.erp_access_revoke(uuid, uuid, uuid, text, integer, text),
  public.erp_access_apply_preset(uuid, uuid, uuid, text, integer),
  public.erp_access_revoke_all(uuid, uuid, uuid, integer, text),
  public.erp_access_snapshot(uuid),
  public.erp_access_audit_page(uuid, bigint, integer),
  public.erp_record_shadow_event(uuid, text, text, text),
  public.erp_access_shadow_report(uuid, date)
to service_role;
reset role;

revoke create on schema public from erp_definer;


-- (9) postflight
do $epost$
declare
  v_list text;
  v_bad text;
  v_active boolean;
  v_owner boolean;
begin
  select string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
     and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v_list is distinct from 'erp_access_apply_preset,erp_access_audit_page,erp_access_grant,erp_access_revoke,erp_access_revoke_all,erp_access_shadow_report,erp_access_snapshot,erp_effective_capabilities,erp_record_shadow_event' then
    raise exception 'ERP_0021P_SERVICE_EXECUTE_SET %', coalesce(v_list, '');
  end if;

  select string_agg(p.proname::text, ',') into v_bad
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
     and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'ERP_0021P_PUBLIC_EXECUTE %', v_bad;
  end if;

  select string_agg(c.relname::text, ',') into v_bad
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname like 'erp\_%' and c.relkind = 'r'
     and (pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  if v_bad is not null then
    raise exception 'ERP_0021P_TABLE_PRIVILEGES %', v_bad;
  end if;

  select string_agg(c.relname::text, ',') into v_bad
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname like 'erp\_%' and c.relkind = 'S'
     and (pg_catalog.has_sequence_privilege('service_role', c.oid, 'USAGE,SELECT,UPDATE')
          or pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
          or pg_catalog.has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE'));
  if v_bad is not null then
    raise exception 'ERP_0021P_SEQUENCE_PRIVILEGES %', v_bad;
  end if;

  select string_agg(c.relname::text, ',') into v_bad
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname like 'erp\_%' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'ERP_0021P_RLS %', v_bad;
  end if;

  select string_agg(p.proname::text, ',') into v_bad
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
     and p.proname not in ('erp_actor_status_v1', 'erp_trg_immutable')
     and pg_catalog.pg_get_userbyid(p.proowner) <> 'erp_definer';
  if v_bad is not null then
    raise exception 'ERP_0021P_FUNCTION_OWNERS %', v_bad;
  end if;

  if (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
       where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) <> 'postgres' then
    raise exception 'ERP_0021P_INTERFACE_OWNER';
  end if;

  select s.is_active, s.is_owner into v_active, v_owner from public.erp_actor_status_v1(gen_random_uuid()) s;
  if v_active or v_owner then
    raise exception 'ERP_0021P_INTERFACE_NOT_DEFAULT_DENY';
  end if;
end
$epost$;

-- <<< 0021P ENGINE BODY

-- T01: قبل المحوّل الواجهة بترفض الكل، والإدارة مقفولة (45300) وبتتسجّل.
do $zt01$
declare
  fx record;
  r jsonb;
  v_n0 bigint;
  v_n1 bigint;
begin
  select * into fx from pg_temp.zt_fx;
  r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.owner_a));
  perform pg_temp.zt('T01a interface default-deny before adapter', (r ->> 'active') = 'false' and (r ->> 'owner') = 'false', r::text);
  select count(*) into v_n0 from public.erp_access_audit;
  r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 0)',
                          fx.owner_a, gen_random_uuid(), gen_random_uuid(), 'erp.access.view'));
  select count(*) into v_n1 from public.erp_access_audit;
  perform pg_temp.zt('T01b management fails closed before adapter (45300, audited)', r ->> 'code' = '45300' and v_n1 = v_n0 + 1, r::text);
end
$zt01$;

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
  if pg_catalog.to_regrole('zell_erp_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_erp\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace and c.relname like 'zell\_erp\_%')
     or exists (select 1 from public.erp_capabilities c where c.key like 'zell.%') then
    raise exception 'ZELL_0021P_ALREADY_PRESENT';
  end if;
  select pg_catalog.btrim(pg_catalog.lower(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g'))) into v_src
    from pg_catalog.pg_proc p where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure;
  if v_src <> 'select false, false;'
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
          where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) <> 'postgres' then
    raise exception 'ZELL_0021P_INTERFACE_NOT_DEFAULT';
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

do $zt$
declare
  fx record;
  r jsonb;
  r2 jsonb;
  v_cmd uuid;
  v_n0 bigint;
  v_n1 bigint;
  v_e text;
  v_ci boolean := pg_catalog.current_setting('zell.ptest_profile', true) = 'ci';
  v_preset jsonb;
  v_bad text;
  v_list text;
  v_guard0 integer;
  v_seeded bigint;
begin
  select * into fx from pg_temp.zt_fx;
  select to_jsonb(array_agg(i.capability_key order by i.capability_key)) into v_preset
    from public.erp_preset_items i where i.preset_key = 'zell.admin_today';

  -- T02 الواجهة
  perform pg_temp.zt('T02a interface owned by zell_erp_definer',
    (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) = 'zell_erp_definer', null);
  r := pg_temp.as_role('zell_erp_definer', format('select to_jsonb(s) from public.erp_actor_status_v1(%L::uuid) s', fx.owner_a));
  perform pg_temp.zt('T02b interface owner -> (true,true)', r = '{"is_active": true, "is_owner": true}'::jsonb, r::text);
  r := pg_temp.as_role('zell_erp_definer', format('select to_jsonb(s) from public.erp_actor_status_v1(%L::uuid) s', gen_random_uuid()));
  perform pg_temp.zt('T02c interface unknown -> (false,false)', r = '{"is_active": false, "is_owner": false}'::jsonb, r::text);
  r := pg_temp.as_role('erp_definer', 'select to_jsonb(public.erp_actor_status_contract_version())');
  perform pg_temp.zt('T02d contract version 1', r = '1'::jsonb, r::text);

  -- T03 العدّاد
  select g.active_owner_count into v_guard0 from public.zell_erp_owner_guard g where g.id = 1;
  perform pg_temp.zt('T03 guard equals active owners',
    v_guard0 = (select count(*)::integer from public.admin_users a where a.role = 'owner' and a.is_active), v_guard0::text);

  -- T04 تجاوز المالك
  r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.owner_a));
  perform pg_temp.zt('T04 owner bypass: all 29 capabilities',
    (r ->> 'owner') = 'true' and jsonb_array_length(r -> 'capabilities') = 29, r::text);

  -- T05 المنح الصريح للأدمن الموجودين
  select count(*) into v_seeded from public.erp_access_audit a where a.source = 'migration';
  perform pg_temp.zt('T05a one migration audit row per active admin',
    v_seeded = (select count(*) from public.admin_users a where a.role = 'admin' and a.is_active), v_seeded::text);
  if fx.admin_x is null then
    perform pg_temp.zt_skip('T05b admin effective = preset', 'no active admin');
  else
    r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T05b admin effective = preset (22)',
      (r ->> 'owner') = 'false' and r -> 'capabilities' = v_preset and (r ->> 'version') = '1', r::text);
  end if;

  -- T06..T19 الإدارة على أدمن
  if fx.admin_x is null then
    perform pg_temp.zt_skip('T06-T19 management on admin target', 'no active admin');
  else
    v_cmd := gen_random_uuid();
    r := pg_temp.svc(format('select public.erp_access_revoke(%L::uuid, %L::uuid, %L::uuid, %L, 1, %L)',
                            fx.owner_a, v_cmd, fx.admin_x, 'zell.telegram.test', 'ptest'));
    perform pg_temp.zt('T06 revoke ok, version 2', (r ->> 'ok') = 'true' and (r ->> 'version') = '2'
      and not (r -> 'capabilities' ? 'zell.telegram.test'), r::text);

    select count(*) into v_n0 from public.erp_access_audit;
    r2 := pg_temp.svc(format('select public.erp_access_revoke(%L::uuid, %L::uuid, %L::uuid, %L, 1, %L)',
                             fx.owner_a, v_cmd, fx.admin_x, 'zell.telegram.test', 'ptest'));
    select count(*) into v_n1 from public.erp_access_audit;
    perform pg_temp.zt('T07 replay: same result, no new audit row',
      r2 = r || '{"replayed": true}'::jsonb and v_n1 = v_n0, r2::text);

    r2 := pg_temp.svc(format('select public.erp_access_revoke(%L::uuid, %L::uuid, %L::uuid, %L, 1, %L)',
                             fx.owner_a, v_cmd, fx.admin_x, 'zell.storefront.revalidate', 'ptest'));
    select count(*) into v_n1 from public.erp_access_audit;
    perform pg_temp.zt('T08 same command, different meaning -> 45307, no audit row',
      r2 ->> 'code' = '45307' and v_n1 = v_n0, r2::text);

    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 2)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.telegram.test'));
    perform pg_temp.zt('T09 grant back ok, version 3', (r ->> 'ok') = 'true' and (r ->> 'version') = '3', r::text);

    v_cmd := gen_random_uuid();
    select count(*) into v_n0 from public.erp_access_audit;
    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 1)',
                            fx.owner_a, v_cmd, fx.admin_x, 'zell.telegram.test'));
    select count(*) into v_n1 from public.erp_access_audit;
    perform pg_temp.zt('T10a stale version -> 45306, audited', r ->> 'code' = '45306' and v_n1 = v_n0 + 1, r::text);
    perform pg_temp.zt('T10b denied audit row is minimal',
      exists (select 1 from public.erp_access_audit a where a.command_id = v_cmd and a.outcome = 'denied'
                 and a.before_keys is null and a.after_keys is null and a.reason is null
                 and a.code = '45306' and a.subject_key = 'zell.telegram.test'), null);
    r2 := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 1)',
                             fx.owner_a, v_cmd, fx.admin_x, 'zell.telegram.test'));
    select count(*) into v_n0 from public.erp_access_audit;
    perform pg_temp.zt('T10c denial replay: same code, no new audit row',
      r2 ->> 'code' = '45306' and (r2 ->> 'replayed') = 'true' and v_n0 = v_n1, r2::text);

    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 3)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.coupons.edit'));
    perform pg_temp.zt('T11 owner-class capability not grantable -> 45302', r ->> 'code' = '45302', r::text);

    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 3)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.nope.cap'));
    perform pg_temp.zt('T12 unknown capability -> 45304', r ->> 'code' = '45304', r::text);

    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 0)',
                            fx.admin_x, gen_random_uuid(), fx.owner_a, 'zell.telegram.test'));
    perform pg_temp.zt('T15 non-owner actor -> 45300', r ->> 'code' = '45300', r::text);

    r := pg_temp.svc(format('select public.erp_access_apply_preset(%L::uuid, %L::uuid, %L::uuid, %L, 3)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.nope'));
    perform pg_temp.zt('T17 unknown preset -> 45304', r ->> 'code' = '45304', r::text);

    r := pg_temp.svc(format('select public.erp_access_revoke_all(%L::uuid, %L::uuid, %L::uuid, 3, %L)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'ptest'));
    r2 := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T18 revoke_all: version 4, admin active with no capabilities',
      (r ->> 'ok') = 'true' and (r ->> 'version') = '4' and (r2 ->> 'active') = 'true'
      and jsonb_array_length(r2 -> 'capabilities') = 0, r::text || ' ' || r2::text);

    r := pg_temp.svc(format('select public.erp_access_apply_preset(%L::uuid, %L::uuid, %L::uuid, %L, 4)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.admin_today'));
    r2 := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T19 apply preset: version 5, effective = preset',
      (r ->> 'ok') = 'true' and (r ->> 'version') = '5' and r2 -> 'capabilities' = v_preset, r::text);

    select count(*) into v_n0 from public.erp_access_audit;
    r := pg_temp.svc(format('select public.erp_access_revoke(%L::uuid, %L::uuid, %L::uuid, %L, 5, null)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'zell.telegram.test'));
    select count(*) into v_n1 from public.erp_access_audit;
    perform pg_temp.zt('T20 revoke without reason -> 45313 raised, no audit row', r ->> '_error' = '45313' and v_n1 = v_n0, r::text);

    -- T22 إيقاف وتشغيل أدمن
    r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, false, %L)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'ptest'));
    r2 := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T22a suspend admin: ok, effective inactive',
      (r ->> 'ok') = 'true' and (r ->> 'isActive') = 'false' and (r2 ->> 'active') = 'false', r::text || ' ' || r2::text);
    perform pg_temp.zt('T22b admin_users log has app actor',
      exists (select 1 from public.zell_erp_admin_users_log l
               where l.user_id = fx.admin_x and l.app_actor = fx.owner_a and l.new_is_active = false), null);
    r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, true, %L)',
                            fx.owner_a, gen_random_uuid(), fx.admin_x, 'ptest'));
    r2 := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T22c reactivate admin: effective back to preset',
      (r ->> 'ok') = 'true' and (r2 ->> 'active') = 'true' and r2 -> 'capabilities' = v_preset, r::text);

    r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, false, %L)',
                            fx.admin_x, gen_random_uuid(), fx.owner_a, 'ptest'));
    perform pg_temp.zt('T25 non-owner cannot suspend -> 45300', r ->> 'code' = '45300', r::text);

    r := pg_temp.svc(format('select public.erp_access_snapshot(%L::uuid)', fx.admin_x));
    r2 := pg_temp.svc(format('select public.zell_erp_access_parity(%L::uuid)', fx.admin_x));
    perform pg_temp.zt('T32 reads require erp.access.view (admin -> 45300)',
      r ->> '_error' = '45300' and r2 ->> '_error' = '45300', r::text || ' ' || r2::text);
  end if;

  -- T13 / T24 مالك تاني
  if fx.owner_b is null then
    perform pg_temp.zt_skip('T13 grant to owner -> 45308', 'single active owner');
    perform pg_temp.zt_skip('T24 owner suspends another owner', 'single active owner');
  else
    r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 0)',
                            fx.owner_a, gen_random_uuid(), fx.owner_b, 'zell.telegram.test'));
    perform pg_temp.zt('T13 grant to owner -> 45308', r ->> 'code' = '45308', r::text);
    r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, false, %L)',
                            fx.owner_a, gen_random_uuid(), fx.owner_b, 'ptest'));
    perform pg_temp.zt('T24a owner suspends another owner: ok, guard consistent',
      (r ->> 'ok') = 'true' and (select g.active_owner_count from public.zell_erp_owner_guard g where g.id = 1) = v_guard0 - 1, r::text);
    r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, true, %L)',
                            fx.owner_a, gen_random_uuid(), fx.owner_b, 'ptest'));
    perform pg_temp.zt('T24b reactivate owner: guard back', (r ->> 'ok') = 'true'
      and (select g.active_owner_count from public.zell_erp_owner_guard g where g.id = 1) = v_guard0, r::text);
  end if;

  -- T14 / T16 / T21 / T23
  r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 0)',
                          fx.owner_a, gen_random_uuid(), fx.owner_a, 'zell.telegram.test'));
  perform pg_temp.zt('T14 self change -> 45301', r ->> 'code' = '45301', r::text);
  r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, %L::uuid, %L::uuid, %L, 0)',
                          fx.owner_a, gen_random_uuid(), gen_random_uuid(), 'zell.telegram.test'));
  perform pg_temp.zt('T16 unknown target -> 45305', r ->> 'code' = '45305', r::text);
  r := pg_temp.svc(format('select public.erp_access_grant(%L::uuid, null, %L::uuid, %L, 0)',
                          fx.owner_a, gen_random_uuid(), 'zell.telegram.test'));
  perform pg_temp.zt('T21 null command id -> 45313 raised', r ->> '_error' = '45313', r::text);
  r := pg_temp.svc(format('select public.zell_erp_set_user_active(%L::uuid, %L::uuid, %L::uuid, false, %L)',
                          fx.owner_a, gen_random_uuid(), fx.owner_a, 'ptest'));
  perform pg_temp.zt('T23 self suspend -> 45301', r ->> 'code' = '45301', r::text);

  -- T26..T30 الحماية في الداتابيز (كـ postgres، وكل حاجة بترجع)
  v_e := pg_temp.pg_err('update public.admin_users set is_active = false where role = ''owner''');
  perform pg_temp.zt('T26 deactivating every owner -> 45303', v_e = '45303', v_e);
  v_e := pg_temp.pg_err(format('update public.admin_users set user_id = %L where user_id = %L', gen_random_uuid(), fx.owner_a));
  perform pg_temp.zt('T27 change user_id -> 45310', v_e = '45310', v_e);
  v_e := pg_temp.pg_err('update public.zell_erp_owner_guard set active_owner_count = 99 where id = 1');
  perform pg_temp.zt('T28 direct counter update -> 45312', v_e = '45312', v_e);
  if v_ci then
    v_e := pg_temp.pg_err('truncate public.admin_users');
    perform pg_temp.zt('T29 truncate admin_users -> 45311', v_e = '45311', v_e);
  else
    perform pg_temp.zt_skip('T29 truncate admin_users', 'ci profile only (ACCESS EXCLUSIVE lock)');
  end if;
  v_e := pg_temp.pg_err('update public.erp_access_audit set reason = ''x''');
  perform pg_temp.zt('T30a audit update -> 45315', v_e = '45315', v_e);
  v_e := pg_temp.pg_err('delete from public.erp_access_audit');
  perform pg_temp.zt('T30b audit delete -> 45315', v_e = '45315', v_e);
  v_e := pg_temp.pg_err('truncate public.erp_access_audit');
  perform pg_temp.zt('T30c audit truncate -> 45315', v_e = '45315', v_e);
  v_e := pg_temp.pg_err('delete from public.erp_commands');
  perform pg_temp.zt('T30d commands delete -> 45315', v_e = '45315', v_e);
  v_e := pg_temp.pg_err('truncate public.erp_user_grants');
  perform pg_temp.zt('T30e grants truncate -> 45315', v_e = '45315', v_e);
  v_e := pg_temp.pg_err('truncate public.zell_erp_admin_users_log');
  perform pg_temp.zt('T30f admin_users log truncate -> 45315', v_e = '45315', v_e);

  -- T31 مفيش مفاتيح تكلفة في أي قراءة
  v_list := '';
  r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  r := pg_temp.svc(format('select public.erp_access_snapshot(%L::uuid)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  r := pg_temp.svc(format('select public.erp_access_audit_page(%L::uuid, null, 200)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  r := pg_temp.svc(format('select public.zell_erp_access_users(%L::uuid)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  r := pg_temp.svc(format('select public.zell_erp_access_parity(%L::uuid)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  r := pg_temp.svc(format('select public.erp_access_shadow_report(%L::uuid, null)', fx.owner_a));
  v_list := v_list || coalesce(pg_temp.bad_keys(r), '') || coalesce(r ->> '_error', '');
  perform pg_temp.zt('T31 no cost/money keys in any read output', v_list = '', v_list);

  -- T33 أحداث الـ shadow (best-effort)
  r := pg_temp.svc(format('select to_jsonb(true) from (select public.erp_record_shadow_event(%L::uuid, %L, %L, %L)) s',
                          fx.owner_a, '/orders', 'zell.orders.view', 'legacy_allow_new_deny'));
  r := pg_temp.svc(format('select to_jsonb(true) from (select public.erp_record_shadow_event(%L::uuid, %L, %L, %L)) s',
                          fx.owner_a, '/orders', 'zell.orders.view', 'legacy_allow_new_deny'));
  r := pg_temp.svc(format('select public.erp_access_shadow_report(%L::uuid, null)', fx.owner_a));
  perform pg_temp.zt('T33a shadow event deduplicated per day (hits=2)',
    jsonb_array_length(r -> 'items') = 1 and (r -> 'items' -> 0 ->> 'hits') = '2', r::text);
  r := pg_temp.svc(format('select to_jsonb(true) from (select public.erp_record_shadow_event(%L::uuid, %L, %L, %L)) s',
                          fx.owner_a, '/orders', 'zell.orders.view', 'nope'));
  perform pg_temp.zt('T33b shadow event with bad kind -> 45313', r ->> '_error' = '45313', r::text);

  -- T34 المطابقة نضيفة
  r := pg_temp.svc(format('select public.zell_erp_access_parity(%L::uuid)', fx.owner_a));
  perform pg_temp.zt('T34 parity clean', (r ->> 'clean') = 'true', r::text);

  -- T35 الصلاحيات
  select string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
     and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
  perform pg_temp.zt('T35a service_role EXECUTE set is exact',
    v_list = 'erp_access_apply_preset,erp_access_audit_page,erp_access_grant,erp_access_revoke,erp_access_revoke_all,erp_access_shadow_report,erp_access_snapshot,erp_effective_capabilities,erp_record_shadow_event,zell_erp_access_parity,zell_erp_access_users,zell_erp_set_user_active', v_list);
  select string_agg(c.relname::text, ',') into v_list
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (c.relname like 'erp\_%' or c.relname like 'zell\_erp\_%')
     and (pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  perform pg_temp.zt('T35b no table privileges for service_role/anon/authenticated', v_list is null, v_list);
  perform pg_temp.zt('T35c zell_erp_definer has no privilege on admin_users',
    not pg_catalog.has_table_privilege('zell_erp_definer', 'public.admin_users', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), null);

  -- T36 upsert من غير تغيير مابيتحسبش مرتين (ci بس: ممكن admin_users الحقيقي فيه أعمدة إجبارية تانية)
  if v_ci then
    v_e := pg_temp.pg_err(format('insert into public.admin_users (user_id, role, is_active) values (%L, ''owner'', true) '
                                 || 'on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active', fx.owner_a));
    perform pg_temp.zt('T36 no-op upsert not double counted', v_e = 'none'
      and (select g.active_owner_count from public.zell_erp_owner_guard g where g.id = 1) = v_guard0, v_e);
  else
    perform pg_temp.zt_skip('T36 no-op upsert', 'ci profile only');
  end if;

  -- T37 الواجهة لو رجّعت شكل غلط: الكل مرفوض (45309)
  execute 'grant create on schema public to zell_erp_definer';
  execute 'set local role zell_erp_definer';
  execute 'create or replace function public.erp_actor_status_v1(p_user uuid) returns table (is_active boolean, is_owner boolean) '
       || 'language sql stable security definer set search_path = '''' as $b$ select true, true union all select true, true; $b$';
  execute 'reset role';
  r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.owner_a));
  perform pg_temp.zt('T37 broken interface shape -> 45309 (fails closed)', r ->> '_error' = '45309', r::text);
  execute 'set local role zell_erp_definer';
  execute 'create or replace function public.erp_actor_status_v1(p_user uuid) returns table (is_active boolean, is_owner boolean) '
       || 'language sql stable security definer set search_path = '''' as $b$ select s.is_active, s.is_owner from public.zell_erp_admin_status(p_user) s; $b$';
  execute 'reset role';
  execute 'revoke create on schema public from zell_erp_definer';
  r := pg_temp.svc(format('select public.erp_effective_capabilities(%L::uuid)', fx.owner_a));
  perform pg_temp.zt('T37b interface restored', (r ->> 'owner') = 'true', r::text);

  -- T38 كل سطور الرفض بأعمدة ثابتة
  perform pg_temp.zt('T38 all denied audit rows are minimal',
    not exists (select 1 from public.erp_access_audit a
                 where a.outcome = 'denied'
                   and (a.before_keys is not null or a.after_keys is not null or a.reason is not null
                        or a.code is null or char_length(coalesce(a.subject_key, '')) > 64)), null);
end
$zt$;

do $zend$
declare
  v_pass integer;
  v_fail integer;
  v_skip integer;
  v_fails text;
  v_skips text;
begin
  select count(*) filter (where z.outcome = 'pass'), count(*) filter (where z.outcome = 'fail'),
         count(*) filter (where z.outcome = 'skip')
    into v_pass, v_fail, v_skip
    from pg_temp.zt_results z;
  select string_agg(z.name || ' :: ' || z.detail, ' | ' order by z.n) into v_fails from pg_temp.zt_results z where z.outcome = 'fail';
  select string_agg(z.name, ' | ' order by z.n) into v_skips from pg_temp.zt_results z where z.outcome = 'skip';
  raise exception 'ZELL_0021P_PTEST_RESULT profile=% pass=% fail=% skip=% failures=[%] skips=[%]',
    pg_catalog.current_setting('zell.ptest_profile', true), v_pass, v_fail, v_skip,
    coalesce(v_fails, ''), coalesce(v_skips, '');
end
$zend$;

rollback;
