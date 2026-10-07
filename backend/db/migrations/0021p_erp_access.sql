-- 0021-P — الصلاحيات: المحرك العام (erp_*)
--
-- العقد المعتمد: مسودة ٤ + Delta مسودة ٥ + قرارات المراجع بعد الـ Spike (head 8260b53).
--   • المحرك مابيعرفش أي تطبيق: مفيش أي إشارة لجداول أو حالات تطبيق هنا. الربط كله في ملف المحوّل.
--   • الهوية من واجهة ثابتة بنسخة: erp_actor_status_v1(uuid) -> (is_active, is_owner). المحرك بيعملها هنا بس
--     (CREATE من غير OR REPLACE) بجسم بيرفض الكل (false, false)، والمحوّل بيستبدل الجسم بس. أي migration محرك
--     بعد كده ممنوع يلمسها (فحص CI: backend/db/ci/0021p_boundaries.sh).
--   • تجاوز المالك صريح: المالك الشغال عنده كل صلاحية معروفة. غيره لازم منح صريح لصلاحية «تشغيل» أو «بيع» بس.
--   • الإدارة (منح · سحب · قالب · سحب الكل) owner-only، ومقفولة لو المحرك أو السجل مش متاح: مفيش تغيير من غير
--     سطر سجل في نفس المعاملة. الرفض المتوقع جوه الدالة بيرجع كنتيجة ويتسجّل بأعمدة ثابتة بس.
--   • idempotency: command_id إجباري، وأول نتيجة نهائية (نجاح أو رفض). نفس الرقم وبصمة مختلفة = 45307 من غير سطر.
--     في REPEATABLE READ / SERIALIZABLE ممكن ترجع 40001؛ الإعادة بنفس command_id آمنة، والتطبيق بيحددها
--     بعدد صغير ولو التعارض استمر بيظهر للمستخدم (قرار المراجع ١).
--   • الدور erp_definer (NOLOGIN · NOBYPASSRLS · NOINHERIT) مالك الدوال. الجداول مالكها postgres، وRLS + policy
--     للدور بس. service_role: EXECUTE على ٩ دوال عامة بس، وصفر على الجداول.
--   • الأكواد: 45300 ممنوع · 45301 تغيير النفس · 45302 مش قابل للمنح · 45304 مش معروف · 45305 المستخدم مش موجود
--     أو موقوف · 45306 تعارض نسخة · 45307 أمر متكرر بمعنى مختلف · 45308 منح لمالك · 45309 الواجهة رجّعت شكل
--     مش متوقع · 45313 مدخلات غلط (من غير سطر سجل) · 45315 سجل مايتعدّلش. (45303/45310/45311/45312/45314 في المحوّل.)
--
-- الترتيب: الملف ده ← 0021p_zell_erp_access.sql (نفس الجلسة أو بعده مباشرة).
-- الرجوع: 0021p_access_rollback.sql · قبل التطبيق: 0021p_access_ptest.sql · بعد التطبيق: 0021p_access_verify.sql
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، وبعد قراءة نسخة PostgreSQL الحية بموافقة منفصلة.

begin;
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
commit;
