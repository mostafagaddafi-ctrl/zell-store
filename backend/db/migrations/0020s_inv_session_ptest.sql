-- 0020-S — اختبار قبل التطبيق (pre-apply ptest) لـ 0020s_inv_session.sql
--
-- • قبل التطبيق بس (لو متطبّق بيقف بـ ZELL_0020S_PTEST_PRE_APPLY_ONLY). بعد التطبيق: 0020s_inv_session_verify.sql.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، ومفيش COMMIT في النص (الـ CI بيفحص الجمل بـ 0021p_txn_shape.py).
-- • النتيجة صفوف في SELECT واحد في الآخر (صف الملخص الأول، وبعده صف لكل اختبار)، مش exception طويل (درس 0021-P).
-- • جسم الـ migration منسوخ بالحرف بين علامات >>> و <<< (الـ CI بيقارن الـ md5 في كل تشغيل).
-- • النداءات زي PostgREST بالظبط: دور authenticated + request.jwt.claims (جلسة مُحاكاة). الطريق القديم: service_role + p_actor.
-- • ملفين تشغيل: production (الافتراضي) و ci. الـ skip المتوقع في production: T02 دايمًا (CI بس)، و R04 لو مفيش أدمن شغال.
--   ci: ولا واحد. أي skip تاني = FAIL.
-- • الأثر على Production: كل الكتابة جوه المعاملة وبترجع، بس الـ sequences بتتقدم (rollback مابيرجّعهاش). profile production
--   بيستخدم مستندات صغيرة (سطر واحد) بس، والعدد بالظبط في وصف الـ PR (الـ CI بيقيسه في S5c). مستند الـ 100 سطر (T02) في ci بس.
-- • statement_timeout: القيمة المعتمدة لدور authenticated = 8s. T01 بيقرا القيمة من catalog بس ويتأكد إنها مش أقل
--   (مش متحطوطة = من غير حد). اختبار الأداء تحت الحد ده في CI (T02 و S16).
-- ⚠ تشغيله على Production محتاج موافقة منفصلة.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local zell.ptest_profile = 'production';

do $zguard$
begin
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'zell\_inv\_session\_%' or p.proname = 'zell_inv_claims_actor')) then
    raise exception 'ZELL_0020S_PTEST_PRE_APPLY_ONLY';
  end if;
  if pg_catalog.current_setting('zell.ptest_profile', true) not in ('production', 'ci') then
    raise exception 'ZELL_0020S_PTEST_PROFILE';
  end if;
  if not pg_catalog.pg_has_role('postgres', 'authenticated', 'SET') or not pg_catalog.pg_has_role('postgres', 'anon', 'SET')
     or not pg_catalog.pg_has_role('postgres', 'service_role', 'SET') then
    raise exception 'ZELL_0020S_PTEST_CALLER_MODEL';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zt_fx (owner_id uuid, admin_id uuid, piece_id integer, main_id bigint, today text) on commit drop;
create temporary table zt_expect (expected text[], owners_active integer, admins_active integer) on commit drop;
create temporary table zt_cmds (id uuid primary key) on commit drop;
create temporary table zt_timing (auth_timeout text, service_timeout text, preview_ms integer, post_ms integer) on commit drop;
insert into pg_temp.zt_timing values (null, null, null, null);

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end,
          left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_skip(p_name text, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, 'skip', left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values ('ABORT_' || p_block, 'ABORT_' || p_block || ' block raised an unexpected error', 'fail',
          left(coalesce(p_state, '') || ' ' || coalesce(p_message, ''), 400));
$f$;

-- نداء زي PostgREST: claims نص خام ('' = من غير جلسة) + دور الداتابيز. أي خطأ بيرجع {_error, _message}.
create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated')
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    execute 'set local role ' || quote_ident(p_db_role);
    execute p_sql into r;
    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claims', '', true);
  exception when others then
    return jsonb_build_object('_error', sqlstate, '_message', left(sqlerrm, 200));
  end;
  return r;
end
$f$;

create function pg_temp.ok(p jsonb)
returns boolean language sql as $f$
  select p is not null and not (jsonb_typeof(p) = 'object' and p ? '_error');
$f$;

create function pg_temp.oc()
returns text language sql as $f$
  select jsonb_build_object('sub', f.owner_id, 'role', 'authenticated')::text from pg_temp.zt_fx f;
$f$;

-- الـ fixtures: من الصفوف الموجودة (owner/admin بأقدم created_at · أول منتج بالقطعة · MAIN).
do $zfx$
declare
  v_ci boolean := pg_catalog.current_setting('zell.ptest_profile', true) = 'ci';
  v_o uuid;
  v_a uuid;
  v_p integer;
  v_m bigint;
  v_no integer;
  v_na integer;
begin
  select count(*) filter (where u.role = 'owner' and u.is_active), count(*) filter (where u.role = 'admin' and u.is_active)
    into v_no, v_na from public.admin_users u;
  select u.user_id into v_o from public.admin_users u where u.role = 'owner' and u.is_active order by u.created_at, u.user_id limit 1;
  select u.user_id into v_a from public.admin_users u where u.role = 'admin' and u.is_active order by u.created_at, u.user_id limit 1;
  select p.id into v_p from public.products p where p.sale_unit = 'piece' order by p.id limit 1;
  select l.id into v_m from public.inventory_locations l where l.code = 'MAIN';
  if v_o is null or v_p is null or v_m is null then
    raise exception 'ZELL_0020S_PTEST_FIXTURE';
  end if;
  insert into pg_temp.zt_fx values (v_o, v_a, v_p, v_m, to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD'));
  insert into pg_temp.zt_expect values (case when v_ci then array[]::text[] when v_a is null then array['R04', 'T02'] else array['T02'] end, v_no, v_na);
end
$zfx$;

-- >>> 0020S BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) خريطة الدوال: لكل دالة عامة قديمة، الدالة الجديدة بنفس المعاملات ناقص p_actor (أسماء مختلفة، مفيش overload).
create temporary table zell_0020s_map (
  old_name text primary key,
  new_name text not null unique,
  old_sig  text not null,
  new_sig  text not null
) on commit drop;

insert into pg_temp.zell_0020s_map (old_name, new_name, old_sig, new_sig) values
  ('zell_inv_create_location', 'zell_inv_session_create_location', 'public.zell_inv_create_location(uuid, uuid, text, text)', 'public.zell_inv_session_create_location(uuid, text, text)'),
  ('zell_inv_update_location', 'zell_inv_session_update_location', 'public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)', 'public.zell_inv_session_update_location(uuid, bigint, integer, text, boolean)'),
  ('zell_inv_create_supplier', 'zell_inv_session_create_supplier', 'public.zell_inv_create_supplier(uuid, uuid, text, text, text)', 'public.zell_inv_session_create_supplier(uuid, text, text, text)'),
  ('zell_inv_update_supplier', 'zell_inv_session_update_supplier', 'public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)', 'public.zell_inv_session_update_supplier(uuid, bigint, integer, text, text, text, boolean)'),
  ('zell_inv_create_purchase', 'zell_inv_session_create_purchase', 'public.zell_inv_create_purchase(uuid, uuid, jsonb)', 'public.zell_inv_session_create_purchase(uuid, jsonb)'),
  ('zell_inv_update_purchase', 'zell_inv_session_update_purchase', 'public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)', 'public.zell_inv_session_update_purchase(uuid, bigint, integer, jsonb)'),
  ('zell_inv_post_purchase', 'zell_inv_session_post_purchase', 'public.zell_inv_post_purchase(uuid, uuid, bigint, integer)', 'public.zell_inv_session_post_purchase(uuid, bigint, integer)'),
  ('zell_inv_discard_purchase', 'zell_inv_session_discard_purchase', 'public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_discard_purchase(uuid, bigint, integer, text)'),
  ('zell_inv_void_purchase', 'zell_inv_session_void_purchase', 'public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_void_purchase(uuid, bigint, integer, text)'),
  ('zell_inv_create_opening', 'zell_inv_session_create_opening', 'public.zell_inv_create_opening(uuid, uuid, jsonb)', 'public.zell_inv_session_create_opening(uuid, jsonb)'),
  ('zell_inv_update_opening', 'zell_inv_session_update_opening', 'public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)', 'public.zell_inv_session_update_opening(uuid, bigint, integer, jsonb)'),
  ('zell_inv_post_opening', 'zell_inv_session_post_opening', 'public.zell_inv_post_opening(uuid, uuid, bigint, integer)', 'public.zell_inv_session_post_opening(uuid, bigint, integer)'),
  ('zell_inv_discard_opening', 'zell_inv_session_discard_opening', 'public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_discard_opening(uuid, bigint, integer, text)'),
  ('zell_inv_void_opening', 'zell_inv_session_void_opening', 'public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_void_opening(uuid, bigint, integer, text)'),
  ('zell_inv_list_locations', 'zell_inv_session_list_locations', 'public.zell_inv_list_locations(uuid, boolean, integer, bigint)', 'public.zell_inv_session_list_locations(boolean, integer, bigint)'),
  ('zell_inv_list_suppliers', 'zell_inv_session_list_suppliers', 'public.zell_inv_list_suppliers(uuid, boolean, integer, text)', 'public.zell_inv_session_list_suppliers(boolean, integer, text)'),
  ('zell_inv_list_purchases', 'zell_inv_session_list_purchases', 'public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)', 'public.zell_inv_session_list_purchases(text, bigint, integer, bigint)'),
  ('zell_inv_get_purchase', 'zell_inv_session_get_purchase', 'public.zell_inv_get_purchase(uuid, bigint)', 'public.zell_inv_session_get_purchase(bigint)'),
  ('zell_inv_preview_purchase', 'zell_inv_session_preview_purchase', 'public.zell_inv_preview_purchase(uuid, jsonb)', 'public.zell_inv_session_preview_purchase(jsonb)'),
  ('zell_inv_list_openings', 'zell_inv_session_list_openings', 'public.zell_inv_list_openings(uuid, text, integer, bigint)', 'public.zell_inv_session_list_openings(text, integer, bigint)'),
  ('zell_inv_get_opening', 'zell_inv_session_get_opening', 'public.zell_inv_get_opening(uuid, bigint)', 'public.zell_inv_session_get_opening(bigint)'),
  ('zell_inv_preview_opening', 'zell_inv_session_preview_opening', 'public.zell_inv_preview_opening(uuid, jsonb)', 'public.zell_inv_session_preview_opening(jsonb)'),
  ('zell_inv_list_lots', 'zell_inv_session_list_lots', 'public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)', 'public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint)');

-- بصمة دوال 0020 القديمة (43): التوقيع + md5 الجسم + المالك + الـ ACL + الأمان + التقلب + الإعدادات.
create or replace function pg_temp.zell_0020s_old_fp()
returns text
language sql
stable
as $f$
  select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || p.proowner::regrole::text
                                 || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || p.provolatile::text
                                 || ':' || coalesce(p.proconfig::text, ''), ',' order by p.oid::regprocedure::text), ''))
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
     and p.proname not like 'zell\_inv\_session\_%' and p.proname <> 'zell_inv_claims_actor';
$f$;

-- (1) preflight
do $zs_pre$
declare
  v_n integer;
  v_bad text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020S_WRONG_CALLER';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0020S_SERVER_VERSION';
  end if;
  if pg_catalog.to_regrole('zell_inventory_definer') is null or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('service_role') is null then
    raise exception 'ZELL_0020S_ROLES_MISSING';
  end if;
  if not pg_catalog.pg_has_role('postgres', 'zell_inventory_definer', 'SET') then
    raise exception 'ZELL_0020S_DEFINER_SET';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'zell\_inv\_session\_%' or p.proname = 'zell_inv_claims_actor')) then
    raise exception 'ZELL_0020S_ALREADY_APPLIED';
  end if;
  select count(*) into v_n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%';
  if v_n <> 43 then
    raise exception 'ZELL_0020S_0020_SHAPE';
  end if;
  -- الـ 23 القديمة: موجودة، مالكها الدور، definer، بترجّع jsonb، و EXECUTE لـ service_role بس (قبل PR-3).
  select string_agg(m.old_name, ',') into v_bad
    from pg_temp.zell_0020s_map m
   where pg_catalog.to_regprocedure(m.old_sig) is null
      or not exists (select 1 from pg_catalog.pg_proc p
                      where p.oid = pg_catalog.to_regprocedure(m.old_sig)
                        and p.proowner = 'zell_inventory_definer'::regrole and p.prosecdef
                        and p.prorettype = 'jsonb'::regtype and not p.proretset
                        and pg_catalog.pg_get_function_identity_arguments(p.oid) like 'p_actor uuid%')
      or not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE');
  if v_bad is not null then
    raise exception 'ZELL_0020S_0020_FUNCTIONS %', left(v_bad, 120);
  end if;
end
$zs_pre$;

create temporary table zell_0020s_fp_before (fp text not null) on commit drop;
insert into pg_temp.zell_0020s_fp_before (fp) values (pg_temp.zell_0020s_old_fp());

-- (2) الدوال: CREATE كـ zell_inventory_definer (SET LOCAL ROLE، زي 0020) ← سحب الكل ← EXECUTE لـ authenticated.
grant create on schema public to zell_inventory_definer;
set local role zell_inventory_definer;

-- الهوية: sub من JWT الجلسة بشرط role = authenticated، وإلا NULL (والدالة القديمة بترفض NULL بـ 45200).
-- نفس منطق zell_erp_trusted_actor (0021-P) من غير ما تناديها، علشان rollback 0021-P مايأثرش هنا.
-- داخلية: invoker، ومالهاش EXECUTE لأي دور غير مالكها.
create function public.zell_inv_claims_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $fn$
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

-- الدوال الرفيعة: الممثل من الجلسة ← الدالة القديمة بنفس الترتيب. مفيش أي منطق تاني.
create function public.zell_inv_session_create_location(p_command_id uuid, p_code text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_create_location(public.zell_inv_claims_actor(), p_command_id, p_code, p_name);
end
$fn$;

create function public.zell_inv_session_update_location(p_command_id uuid, p_location_id bigint,
                                                        p_expected_version integer, p_name text, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_update_location(public.zell_inv_claims_actor(), p_command_id, p_location_id,
                                         p_expected_version, p_name, p_is_active);
end
$fn$;

create function public.zell_inv_session_create_supplier(p_command_id uuid, p_name text, p_phone text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_create_supplier(public.zell_inv_claims_actor(), p_command_id, p_name, p_phone, p_note);
end
$fn$;

create function public.zell_inv_session_update_supplier(p_command_id uuid, p_supplier_id bigint, p_expected_version integer,
                                                        p_name text, p_phone text, p_note text, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_update_supplier(public.zell_inv_claims_actor(), p_command_id, p_supplier_id, p_expected_version,
                                         p_name, p_phone, p_note, p_is_active);
end
$fn$;

create function public.zell_inv_session_create_purchase(p_command_id uuid, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_create_purchase(public.zell_inv_claims_actor(), p_command_id, p_doc);
end
$fn$;

create function public.zell_inv_session_update_purchase(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_update_purchase(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_doc);
end
$fn$;

create function public.zell_inv_session_post_purchase(p_command_id uuid, p_doc_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_post_purchase(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version);
end
$fn$;

create function public.zell_inv_session_discard_purchase(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_discard_purchase(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_reason);
end
$fn$;

create function public.zell_inv_session_void_purchase(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_void_purchase(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_reason);
end
$fn$;

create function public.zell_inv_session_create_opening(p_command_id uuid, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_create_opening(public.zell_inv_claims_actor(), p_command_id, p_doc);
end
$fn$;

create function public.zell_inv_session_update_opening(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_update_opening(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_doc);
end
$fn$;

create function public.zell_inv_session_post_opening(p_command_id uuid, p_doc_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_post_opening(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version);
end
$fn$;

create function public.zell_inv_session_discard_opening(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_discard_opening(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_reason);
end
$fn$;

create function public.zell_inv_session_void_opening(p_command_id uuid, p_doc_id bigint, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_void_opening(public.zell_inv_claims_actor(), p_command_id, p_doc_id, p_expected_version, p_reason);
end
$fn$;

create function public.zell_inv_session_list_locations(p_include_inactive boolean, p_limit integer, p_after_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_list_locations(public.zell_inv_claims_actor(), p_include_inactive, p_limit, p_after_id);
end
$fn$;

create function public.zell_inv_session_list_suppliers(p_include_inactive boolean, p_limit integer, p_after_name_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_list_suppliers(public.zell_inv_claims_actor(), p_include_inactive, p_limit, p_after_name_key);
end
$fn$;

create function public.zell_inv_session_list_purchases(p_status text, p_supplier_id bigint, p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_list_purchases(public.zell_inv_claims_actor(), p_status, p_supplier_id, p_limit, p_before_id);
end
$fn$;

create function public.zell_inv_session_get_purchase(p_doc_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_get_purchase(public.zell_inv_claims_actor(), p_doc_id);
end
$fn$;

create function public.zell_inv_session_preview_purchase(p_doc jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_preview_purchase(public.zell_inv_claims_actor(), p_doc);
end
$fn$;

create function public.zell_inv_session_list_openings(p_status text, p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_list_openings(public.zell_inv_claims_actor(), p_status, p_limit, p_before_id);
end
$fn$;

create function public.zell_inv_session_get_opening(p_doc_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_get_opening(public.zell_inv_claims_actor(), p_doc_id);
end
$fn$;

create function public.zell_inv_session_preview_opening(p_doc jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_preview_opening(public.zell_inv_claims_actor(), p_doc);
end
$fn$;

create function public.zell_inv_session_list_lots(p_status text, p_product_id integer, p_location_id bigint,
                                                  p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return public.zell_inv_list_lots(public.zell_inv_claims_actor(), p_status, p_product_id, p_location_id, p_limit, p_before_id);
end
$fn$;

revoke all on function public.zell_inv_claims_actor() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_create_location(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_update_location(uuid, bigint, integer, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_create_supplier(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_update_supplier(uuid, bigint, integer, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_create_purchase(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_update_purchase(uuid, bigint, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_post_purchase(uuid, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_discard_purchase(uuid, bigint, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_void_purchase(uuid, bigint, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_create_opening(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_update_opening(uuid, bigint, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_post_opening(uuid, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_discard_opening(uuid, bigint, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_void_opening(uuid, bigint, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_list_locations(boolean, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_list_suppliers(boolean, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_list_purchases(text, bigint, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_get_purchase(bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_preview_purchase(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_list_openings(text, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_get_opening(bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_preview_opening(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint) from public, anon, authenticated, service_role;

grant execute on function public.zell_inv_session_create_location(uuid, text, text) to authenticated;
grant execute on function public.zell_inv_session_update_location(uuid, bigint, integer, text, boolean) to authenticated;
grant execute on function public.zell_inv_session_create_supplier(uuid, text, text, text) to authenticated;
grant execute on function public.zell_inv_session_update_supplier(uuid, bigint, integer, text, text, text, boolean) to authenticated;
grant execute on function public.zell_inv_session_create_purchase(uuid, jsonb) to authenticated;
grant execute on function public.zell_inv_session_update_purchase(uuid, bigint, integer, jsonb) to authenticated;
grant execute on function public.zell_inv_session_post_purchase(uuid, bigint, integer) to authenticated;
grant execute on function public.zell_inv_session_discard_purchase(uuid, bigint, integer, text) to authenticated;
grant execute on function public.zell_inv_session_void_purchase(uuid, bigint, integer, text) to authenticated;
grant execute on function public.zell_inv_session_create_opening(uuid, jsonb) to authenticated;
grant execute on function public.zell_inv_session_update_opening(uuid, bigint, integer, jsonb) to authenticated;
grant execute on function public.zell_inv_session_post_opening(uuid, bigint, integer) to authenticated;
grant execute on function public.zell_inv_session_discard_opening(uuid, bigint, integer, text) to authenticated;
grant execute on function public.zell_inv_session_void_opening(uuid, bigint, integer, text) to authenticated;
grant execute on function public.zell_inv_session_list_locations(boolean, integer, bigint) to authenticated;
grant execute on function public.zell_inv_session_list_suppliers(boolean, integer, text) to authenticated;
grant execute on function public.zell_inv_session_list_purchases(text, bigint, integer, bigint) to authenticated;
grant execute on function public.zell_inv_session_get_purchase(bigint) to authenticated;
grant execute on function public.zell_inv_session_preview_purchase(jsonb) to authenticated;
grant execute on function public.zell_inv_session_list_openings(text, integer, bigint) to authenticated;
grant execute on function public.zell_inv_session_get_opening(bigint) to authenticated;
grant execute on function public.zell_inv_session_preview_opening(jsonb) to authenticated;
grant execute on function public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint) to authenticated;

reset role;
revoke create on schema public from zell_inventory_definer;

-- (3) postflight (أي فشل = المعاملة كلها بترجع)
do $zs_post$
declare
  v_bad text;
  v_definer oid := 'zell_inventory_definer'::regrole;
  v_auth oid := 'authenticated'::regrole;
  v_claims oid := pg_catalog.to_regprocedure('public.zell_inv_claims_actor()');
begin
  -- (a) الدوال القديمة (43) زي ما هي بالظبط
  if (select b.fp from pg_temp.zell_0020s_fp_before b) is distinct from pg_temp.zell_0020s_old_fp() then
    raise exception 'ZELL_0020S_OLD_CHANGED';
  end if;

  -- (b) العدد ومفيش overload
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') <> 23
     or v_claims is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 67 then
    raise exception 'ZELL_0020S_FUNCTION_COUNT';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
              group by p.proname having count(*) > 1) then
    raise exception 'ZELL_0020S_OVERLOAD';
  end if;

  -- (c) شكل كل دالة جديدة: المالك · definer · search_path · التقلب = القديمة · نفس المعاملات ناقص p_actor ·
  --     الجسم بينادي القديمة بالممثل من الجلسة · مفيش أي erp_
  select string_agg(m.new_name, ',') into v_bad
    from pg_temp.zell_0020s_map m
   where not exists (
     select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_proc o on o.oid = pg_catalog.to_regprocedure(m.old_sig)
      where p.oid = pg_catalog.to_regprocedure(m.new_sig)
        and p.proname = m.new_name
        and p.proowner = v_definer and p.prosecdef
        and p.provolatile = o.provolatile
        and p.prorettype = 'jsonb'::regtype and not p.proretset
        and p.proconfig = array['search_path=""']::text[]
        and pg_catalog.pg_get_function_identity_arguments(p.oid)
            = pg_catalog.regexp_replace(pg_catalog.pg_get_function_identity_arguments(o.oid), '^p_actor uuid(, )?', '')
        and pg_catalog.strpos(p.prosrc, 'public.' || m.old_name || '(public.zell_inv_claims_actor()') > 0
        and p.prosrc !~ 'erp_');
  if v_bad is not null then
    raise exception 'ZELL_0020S_FUNCTION_SHAPE %', left(v_bad, 120);
  end if;

  -- (d) الـ ACL: المباشر = المالك + authenticated (EXECUTE بس)، والفعلي: authenticated أيوه، anon و service_role لأ
  select string_agg(m.new_name, ',') into v_bad
    from pg_temp.zell_0020s_map m
   where (select p.proacl from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure(m.new_sig)) is null
      or (select array_agg(distinct a.grantee order by a.grantee)
            from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
           where p.oid = pg_catalog.to_regprocedure(m.new_sig))
         is distinct from (select array_agg(g order by g) from unnest(array[v_definer, v_auth]) g)
      or exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                  where p.oid = pg_catalog.to_regprocedure(m.new_sig) and a.privilege_type <> 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE');
  if v_bad is not null then
    raise exception 'ZELL_0020S_ACL %', left(v_bad, 120);
  end if;

  -- (e) دالة الهوية: داخلية (invoker · stable · search_path) ومالهاش EXECUTE لأي دور غير مالكها
  if not exists (select 1 from pg_catalog.pg_proc p
                  where p.oid = v_claims and p.proowner = v_definer and not p.prosecdef and p.provolatile = 's'
                    and p.prorettype = 'uuid'::regtype and p.proconfig = array['search_path=""']::text[]
                    and p.proacl is not null and p.prosrc !~ 'erp_')
     or (select array_agg(distinct a.grantee) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
          where p.oid = v_claims) is distinct from array[v_definer]
     or pg_catalog.has_function_privilege('authenticated', v_claims, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_claims, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_claims, 'EXECUTE') then
    raise exception 'ZELL_0020S_CLAIMS_ACTOR_SHAPE';
  end if;

  -- (f) الـ schema: CREATE الفعلي للدور false
  if pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0020S_SCHEMA_CREATE';
  end if;
end
$zs_post$;

notify pgrst, 'reload schema';
-- <<< 0020S BODY

-- ── C: الـ catalog بعد الجسم ──
do $zC$
declare
  v_n integer;
begin
  perform pg_temp.zt('C01 23 zell_inv_session_* + zell_inv_claims_actor, zell_inv_% = 67, no overload',
    (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') = 23
    and pg_catalog.to_regprocedure('public.zell_inv_claims_actor()') is not null
    and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') = 67
    and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                     group by p.proname having count(*) > 1), '');
  select count(*) into v_n
    from pg_temp.zell_0020s_map m
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(m.new_sig)
    join pg_catalog.pg_proc o on o.oid = pg_catalog.to_regprocedure(m.old_sig)
   where p.proowner = 'zell_inventory_definer'::regrole and p.prosecdef and p.provolatile = o.provolatile
     and pg_catalog.pg_get_function_identity_arguments(p.oid)
         = pg_catalog.regexp_replace(pg_catalog.pg_get_function_identity_arguments(o.oid), '^p_actor uuid(, )?', '');
  perform pg_temp.zt('C02 each session fn: owner definer, security definer, volatility = old, args = old minus p_actor', v_n = 23, v_n::text);
  select count(*) into v_n
    from pg_temp.zell_0020s_map m
   where pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
     and not pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
     and not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
     and pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE');
  perform pg_temp.zt('C03 EXECUTE: session = authenticated only; old = service_role only (unchanged)', v_n = 23, v_n::text);
  perform pg_temp.zt('C04 old 0020 functions fingerprint unchanged',
    (select b.fp from pg_temp.zell_0020s_fp_before b) = pg_temp.zell_0020s_old_fp(), '');
exception when others then
  perform pg_temp.zt_block_fail('C', sqlstate, sqlerrm);
end
$zC$;

-- ── R: الرفض لكل دالة من الـ 23 (معاملات NULL؛ فحص المالك أول حاجة في كل دالة قديمة) ──
do $zR$
declare
  v_owner uuid;
  v_admin uuid;
  m record;
  r jsonb;
  b1 text := ''; b2 text := ''; b3 text := ''; b4 text := ''; b5 text := ''; b6 text := ''; b7 text := ''; b9 text := '';
  c_owner text;
  c_owner_anon text;
  c_admin text;
begin
  select f.owner_id, f.admin_id into v_owner, v_admin from pg_temp.zt_fx f;
  c_owner := pg_temp.oc();
  c_owner_anon := jsonb_build_object('sub', v_owner, 'role', 'anon')::text;
  c_admin := case when v_admin is null then null else jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text end;
  for m in
    select z.old_name,
           'select public.' || z.new_name || '(' || coalesce((
              select string_agg('null::' || pg_catalog.format_type(u.t, null), ', ' order by u.o)
                from pg_catalog.pg_proc p cross join lateral unnest(p.proargtypes::oid[]) with ordinality as u(t, o)
               where p.oid = pg_catalog.to_regprocedure(z.new_sig)), '') || ')' as call_new,
           'select public.' || z.old_name || '(' || coalesce((
              select string_agg('null::' || pg_catalog.format_type(u.t, null), ', ' order by u.o)
                from pg_catalog.pg_proc p cross join lateral unnest(p.proargtypes::oid[]) with ordinality as u(t, o)
               where p.oid = pg_catalog.to_regprocedure(z.old_sig)), '') || ')' as call_old
      from pg_temp.zell_0020s_map z
     order by z.old_name
  loop
    r := pg_temp.as_user('', m.call_new);
    if r ->> '_error' is distinct from '45200' then b1 := b1 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    r := pg_temp.as_user('{"role":"authenticated"}', m.call_new);
    if r ->> '_error' is distinct from '45200' then b2 := b2 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    r := pg_temp.as_user(c_owner_anon, m.call_new);
    if r ->> '_error' is distinct from '45200' then b3 := b3 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    if c_admin is not null then
      r := pg_temp.as_user(c_admin, m.call_new);
      if r ->> '_error' is distinct from '45200' then b4 := b4 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    end if;
    r := pg_temp.as_user('not-json', m.call_new);
    if r ->> '_error' is distinct from '45200' then b5 := b5 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    r := pg_temp.as_user('', m.call_new, 'service_role');
    if r ->> '_error' is distinct from '42501' then b6 := b6 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    r := pg_temp.as_user('', m.call_new, 'anon');
    if r ->> '_error' is distinct from '42501' then b7 := b7 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
    r := pg_temp.as_user(c_owner, m.call_old);
    if r ->> '_error' is distinct from '42501' then b9 := b9 || m.old_name || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
  end loop;
  perform pg_temp.zt('R01 no session (authenticated, no claims) -> 45200 on all 23', b1 = '', b1);
  perform pg_temp.zt('R02 claims without sub -> 45200 on all 23', b2 = '', b2);
  perform pg_temp.zt('R03 owner sub with claim role anon -> 45200 on all 23', b3 = '', b3);
  if c_admin is null then
    perform pg_temp.zt_skip('R04 active admin (not owner) -> 45200 on all 23', 'no active admin');
  else
    perform pg_temp.zt('R04 active admin (not owner) -> 45200 on all 23', b4 = '', b4);
  end if;
  perform pg_temp.zt('R05 malformed claims -> 45200 on all 23', b5 = '', b5);
  perform pg_temp.zt('R06 service_role on session functions -> 42501 on all 23', b6 = '', b6);
  perform pg_temp.zt('R07 anon on session functions -> 42501 on all 23', b7 = '', b7);
  r := pg_temp.as_user(c_owner, 'select to_jsonb(public.zell_inv_claims_actor())');
  b1 := coalesce(r ->> '_error', 'ok');
  r := pg_temp.as_user('', 'select to_jsonb(public.zell_inv_claims_actor())', 'service_role');
  b2 := coalesce(r ->> '_error', 'ok');
  r := pg_temp.as_user('', 'select to_jsonb(public.zell_inv_claims_actor())', 'anon');
  b3 := coalesce(r ->> '_error', 'ok');
  perform pg_temp.zt('R08 zell_inv_claims_actor() not callable by authenticated / service_role / anon -> 42501',
    b1 = '42501' and b2 = '42501' and b3 = '42501', b1 || ' ' || b2 || ' ' || b3);
  perform pg_temp.zt('R09 old functions with owner session as authenticated -> 42501 on all 23 (unchanged)', b9 = '', b9);
exception when others then
  perform pg_temp.zt_block_fail('R', sqlstate, sqlerrm);
end
$zR$;

-- ── O1: المواقع — إنشاء بالجلسة · إعادة نفس الأمر بالطريق القديم · نفس الأمر بمحتوى مختلف · تعديل ──
do $zO1$
declare
  v_o uuid := (select f.owner_id from pg_temp.zt_fx f);
  v_c text := pg_temp.oc();
  v_cmd uuid := gen_random_uuid();
  v_new jsonb;
  v_old jsonb;
  v_x jsonb;
  v_id bigint;
  v_ver integer;
begin
  insert into pg_temp.zt_cmds values (v_cmd);
  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_location(%L::uuid, %L, %L)', v_cmd, 'ZT0020S', 'موقع اختبار 0020S'));
  perform pg_temp.zt('O01 owner session create_location -> ok', pg_temp.ok(v_new) and v_new ? 'locationId', v_new::text);
  v_old := pg_temp.as_user('', format('select public.zell_inv_create_location(%L::uuid, %L::uuid, %L, %L)', v_o, v_cmd, 'ZT0020S', 'موقع اختبار 0020S'), 'service_role');
  perform pg_temp.zt('O02 same command via old path (service_role + p_actor) -> replayed, same result',
    pg_temp.ok(v_old) and v_old ->> 'replayed' = 'true' and (v_old - 'replayed') = v_new,
    coalesce(v_old::text, 'null') || ' / ' || coalesce(v_new::text, 'null'));
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_location(%L::uuid, %L, %L)', v_cmd, 'ZT0020S', 'اسم تاني'));
  perform pg_temp.zt('O03 same command, different payload via session -> 45212', v_x ->> '_error' = '45212', v_x::text);
  v_id := (v_new ->> 'locationId')::bigint;
  select l.version into v_ver from public.inventory_locations l where l.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_update_location(%L::uuid, %s, %s, %L, true)', v_cmd, v_id, v_ver, 'موقع اختبار 0020S ٢'));
  perform pg_temp.zt('O04 owner session update_location -> ok', pg_temp.ok(v_x) and v_x ? 'version', v_x::text);
exception when others then
  perform pg_temp.zt_block_fail('O1', sqlstate, sqlerrm);
end
$zO1$;

-- ── O2: الموردين — إنشاء بالطريق القديم ثم إعادة نفس الأمر بالجلسة · تعديل بالجلسة ──
do $zO2$
declare
  v_o uuid := (select f.owner_id from pg_temp.zt_fx f);
  v_c text := pg_temp.oc();
  v_cmd uuid := gen_random_uuid();
  v_new jsonb;
  v_old jsonb;
  v_x jsonb;
  v_id bigint;
  v_ver integer;
begin
  insert into pg_temp.zt_cmds values (v_cmd);
  v_old := pg_temp.as_user('', format('select public.zell_inv_create_supplier(%L::uuid, %L::uuid, %L, null, null)', v_o, v_cmd, 'مورد اختبار 0020S'), 'service_role');
  perform pg_temp.zt('O05 old path create_supplier (service_role + p_actor) -> ok', pg_temp.ok(v_old) and v_old ? 'supplierId', v_old::text);
  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_supplier(%L::uuid, %L, null, null)', v_cmd, 'مورد اختبار 0020S'));
  perform pg_temp.zt('O06 same command via session -> replayed, same result',
    pg_temp.ok(v_new) and v_new ->> 'replayed' = 'true' and (v_new - 'replayed') = v_old,
    coalesce(v_new::text, 'null') || ' / ' || coalesce(v_old::text, 'null'));
  v_id := (v_old ->> 'supplierId')::bigint;
  select s.version into v_ver from public.suppliers s where s.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_update_supplier(%L::uuid, %s, %s, %L, null, null, true)', v_cmd, v_id, v_ver, 'مورد اختبار 0020S ٢'));
  perform pg_temp.zt('O07 owner session update_supplier -> ok', pg_temp.ok(v_x) and v_x ? 'version', v_x::text);
exception when others then
  perform pg_temp.zt_block_fail('O2', sqlstate, sqlerrm);
end
$zO2$;

-- ── O3: الشراء — معاينة (تطابق) · إنشاء · قراية (تطابق) · تعديل · ترحيل · إلغاء · ومسودة تانية تتمسح ──
do $zO3$
declare
  v_o uuid;
  v_c text := pg_temp.oc();
  v_piece integer;
  v_main bigint;
  v_today text;
  v_doc jsonb;
  v_cmd uuid;
  v_new jsonb;
  v_old jsonb;
  v_x jsonb;
  v_id bigint;
  v_ver integer;
begin
  select f.owner_id, f.piece_id, f.main_id, f.today into v_o, v_piece, v_main, v_today from pg_temp.zt_fx f;
  v_doc := jsonb_build_object('locationId', v_main, 'docDate', v_today,
             'lines', jsonb_build_array(jsonb_build_object('kind', 'batch', 'productId', v_piece, 'quantity', 1, 'lineTotalPiastres', 100)));
  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_preview_purchase(%L::jsonb)', v_doc));
  v_old := pg_temp.as_user('', format('select public.zell_inv_preview_purchase(%L::uuid, %L::jsonb)', v_o, v_doc), 'service_role');
  perform pg_temp.zt('O08 preview_purchase: session = old', pg_temp.ok(v_new) and v_new = v_old, left(coalesce(v_new::text, 'null'), 200));

  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_purchase(%L::uuid, %L::jsonb)', v_cmd, v_doc));
  perform pg_temp.zt('O09 owner session create_purchase -> draft', pg_temp.ok(v_x) and v_x ->> 'status' = 'draft', v_x::text);
  v_id := (v_x ->> 'docId')::bigint;

  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_get_purchase(%s)', v_id));
  v_old := pg_temp.as_user('', format('select public.zell_inv_get_purchase(%L::uuid, %s)', v_o, v_id), 'service_role');
  perform pg_temp.zt('O10 get_purchase: session = old', pg_temp.ok(v_new) and v_new = v_old, left(coalesce(v_new::text, 'null'), 200));

  select d.version into v_ver from public.purchase_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_update_purchase(%L::uuid, %s, %s, %L::jsonb)', v_cmd, v_id, v_ver,
           jsonb_set(v_doc, '{lines,0,quantity}', '2'::jsonb)));
  perform pg_temp.zt('O11 owner session update_purchase -> ok', pg_temp.ok(v_x), v_x::text);

  select d.version into v_ver from public.purchase_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_post_purchase(%L::uuid, %s, %s)', v_cmd, v_id, v_ver));
  perform pg_temp.zt('O12 owner session post_purchase -> posted', pg_temp.ok(v_x) and v_x ->> 'status' = 'posted', left(v_x::text, 300));

  select d.version into v_ver from public.purchase_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_void_purchase(%L::uuid, %s, %s, %L)', v_cmd, v_id, v_ver, 'اختبار 0020S'));
  perform pg_temp.zt('O13 owner session void_purchase -> voided', pg_temp.ok(v_x) and v_x ->> 'status' = 'voided', left(v_x::text, 300));

  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_purchase(%L::uuid, %L::jsonb)', v_cmd, v_doc));
  v_id := (v_x ->> 'docId')::bigint;
  select d.version into v_ver from public.purchase_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_discard_purchase(%L::uuid, %s, %s, %L)', v_cmd, v_id, v_ver, 'اختبار 0020S'));
  perform pg_temp.zt('O14 owner session discard_purchase (second draft) -> discarded', pg_temp.ok(v_x) and v_x ->> 'status' = 'discarded', left(v_x::text, 300));
exception when others then
  perform pg_temp.zt_block_fail('O3', sqlstate, sqlerrm);
end
$zO3$;

-- ── O4: أول المدة — نفس الدورة ──
do $zO4$
declare
  v_o uuid;
  v_c text := pg_temp.oc();
  v_piece integer;
  v_main bigint;
  v_today text;
  v_doc jsonb;
  v_cmd uuid;
  v_new jsonb;
  v_old jsonb;
  v_x jsonb;
  v_id bigint;
  v_ver integer;
begin
  select f.owner_id, f.piece_id, f.main_id, f.today into v_o, v_piece, v_main, v_today from pg_temp.zt_fx f;
  v_doc := jsonb_build_object('locationId', v_main, 'asOfDate', v_today,
             'lines', jsonb_build_array(jsonb_build_object('kind', 'batch', 'productId', v_piece, 'quantity', 1,
                                                           'lineTotalPiastres', 100, 'costIsEstimated', false)));
  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_preview_opening(%L::jsonb)', v_doc));
  v_old := pg_temp.as_user('', format('select public.zell_inv_preview_opening(%L::uuid, %L::jsonb)', v_o, v_doc), 'service_role');
  perform pg_temp.zt('O15 preview_opening: session = old', pg_temp.ok(v_new) and v_new = v_old, left(coalesce(v_new::text, 'null'), 200));

  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_opening(%L::uuid, %L::jsonb)', v_cmd, v_doc));
  perform pg_temp.zt('O16 owner session create_opening -> draft', pg_temp.ok(v_x) and v_x ->> 'status' = 'draft', v_x::text);
  v_id := (v_x ->> 'docId')::bigint;

  v_new := pg_temp.as_user(v_c, format('select public.zell_inv_session_get_opening(%s)', v_id));
  v_old := pg_temp.as_user('', format('select public.zell_inv_get_opening(%L::uuid, %s)', v_o, v_id), 'service_role');
  perform pg_temp.zt('O17 get_opening: session = old', pg_temp.ok(v_new) and v_new = v_old, left(coalesce(v_new::text, 'null'), 200));

  select d.version into v_ver from public.opening_stock_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_update_opening(%L::uuid, %s, %s, %L::jsonb)', v_cmd, v_id, v_ver,
           jsonb_set(v_doc, '{lines,0,quantity}', '2'::jsonb)));
  perform pg_temp.zt('O18 owner session update_opening -> ok', pg_temp.ok(v_x), v_x::text);

  select d.version into v_ver from public.opening_stock_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_post_opening(%L::uuid, %s, %s)', v_cmd, v_id, v_ver));
  perform pg_temp.zt('O19 owner session post_opening -> posted', pg_temp.ok(v_x) and v_x ->> 'status' = 'posted', left(v_x::text, 300));

  select d.version into v_ver from public.opening_stock_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_void_opening(%L::uuid, %s, %s, %L)', v_cmd, v_id, v_ver, 'اختبار 0020S'));
  perform pg_temp.zt('O20 owner session void_opening -> voided', pg_temp.ok(v_x) and v_x ->> 'status' = 'voided', left(v_x::text, 300));

  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_opening(%L::uuid, %L::jsonb)', v_cmd, v_doc));
  v_id := (v_x ->> 'docId')::bigint;
  select d.version into v_ver from public.opening_stock_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_discard_opening(%L::uuid, %s, %s, %L)', v_cmd, v_id, v_ver, 'اختبار 0020S'));
  perform pg_temp.zt('O21 owner session discard_opening (second draft) -> discarded', pg_temp.ok(v_x) and v_x ->> 'status' = 'discarded', left(v_x::text, 300));
exception when others then
  perform pg_temp.zt_block_fail('O4', sqlstate, sqlerrm);
end
$zO4$;

-- ── O5: القوايم الخمسة — الجلسة = الطريق القديم ──
do $zO5$
declare
  v_o uuid := (select f.owner_id from pg_temp.zt_fx f);
  v_c text := pg_temp.oc();
  v_bad text := '';
  v_new jsonb;
  v_old jsonb;
  m record;
begin
  for m in
    select * from (values
      ('list_locations', 'true, 50, null'),
      ('list_suppliers', 'true, 50, null'),
      ('list_purchases', 'null, null, 50, null'),
      ('list_openings', 'null, 50, null'),
      ('list_lots', '''active'', null, null, 50, null')) as v(fn, args)
  loop
    v_new := pg_temp.as_user(v_c, 'select public.zell_inv_session_' || m.fn || '(' || m.args || ')');
    v_old := pg_temp.as_user('', format('select public.zell_inv_%s(%L::uuid, %s)', m.fn, v_o, m.args), 'service_role');
    if not (pg_temp.ok(v_new) and v_new = v_old) then
      v_bad := v_bad || m.fn || '=' || left(coalesce(v_new ->> '_error', v_new::text, 'null'), 40) || ' ';
    end if;
  end loop;
  perform pg_temp.zt('O22 five list functions: session = old (owner)', v_bad = '', v_bad);
exception when others then
  perform pg_temp.zt_block_fail('O5', sqlstate, sqlerrm);
end
$zO5$;

-- ── O6: الممثل في inventory_commands و inventory_audit_log = sub الجلسة ──
do $zO6$
declare
  v_o uuid := (select f.owner_id from pg_temp.zt_fx f);
  v_cmds integer;
  v_cmds_other integer;
  v_audit integer;
  v_audit_other integer;
begin
  select count(*), count(*) filter (where c.actor_user_id <> v_o) into v_cmds, v_cmds_other
    from public.inventory_commands c where c.command_id in (select z.id from pg_temp.zt_cmds z);
  select count(*), count(*) filter (where a.actor_user_id <> v_o) into v_audit, v_audit_other
    from public.inventory_audit_log a where a.command_id in (select z.id from pg_temp.zt_cmds z);
  perform pg_temp.zt('O23 commands and audit rows from these tests: actor = session sub (owner) only',
    v_cmds >= 15 and v_cmds_other = 0 and v_audit >= 15 and v_audit_other = 0,
    'commands=' || v_cmds || ' other=' || v_cmds_other || ' audit=' || v_audit || ' other=' || v_audit_other);
exception when others then
  perform pg_temp.zt_block_fail('O6', sqlstate, sqlerrm);
end
$zO6$;

-- ── T: statement_timeout للأدوار + زمن مستند كبير (100 سطر) بالجلسة ──
do $zT$
declare
  v_auth text;
  v_srv text;
  v_lim numeric;
  v_c text := pg_temp.oc();
  v_piece integer;
  v_main bigint;
  v_today text;
  v_doc jsonb;
  v_cmd uuid;
  v_x jsonb;
  v_id bigint;
  v_ver integer;
  t0 timestamptz;
  v_prev integer;
  v_post integer;
begin
  select substring(c from '^statement_timeout=(.*)$') into v_auth
    from pg_catalog.pg_roles r cross join lateral unnest(coalesce(r.rolconfig, '{}'::text[])) c
   where r.rolname = 'authenticated' and c like 'statement\_timeout=%' limit 1;
  select substring(c from '^statement_timeout=(.*)$') into v_srv
    from pg_catalog.pg_roles r cross join lateral unnest(coalesce(r.rolconfig, '{}'::text[])) c
   where r.rolname = 'service_role' and c like 'statement\_timeout=%' limit 1;
  begin
    v_lim := case when v_auth is null then null
                  when v_auth ~ '^[0-9]+$' then v_auth::numeric
                  else extract(epoch from v_auth::interval) * 1000 end;
  exception when others then
    v_lim := null;
  end;
  -- القيمة المعتمدة لدور authenticated = 8s (8000ms). مش متحطوطة = من غير حد.
  perform pg_temp.zt('T01 authenticated statement_timeout not below approved 8s (read from catalog)',
    v_auth is null or (v_lim is not null and (v_lim = 0 or v_lim >= 8000)),
    'authenticated=' || coalesce(v_auth, 'unset') || ' service_role=' || coalesce(v_srv, 'unset') || ' approved_min=8s');
  update pg_temp.zt_timing set auth_timeout = v_auth, service_timeout = v_srv;
  -- مستند الـ 100 سطر في ci بس (Production: مستندات صغيرة بس، علشان الـ sequences).
  if pg_catalog.current_setting('zell.ptest_profile', true) <> 'ci' then
    perform pg_temp.zt_skip('T02 big purchase (100 lines) via session: preview + post within half of authenticated timeout', 'CI only');
    return;
  end if;

  select f.piece_id, f.main_id, f.today into v_piece, v_main, v_today from pg_temp.zt_fx f;
  v_doc := jsonb_build_object('locationId', v_main, 'docDate', v_today, 'supplierDiscountPiastres', 37,
             'lines', (select jsonb_agg(jsonb_build_object('kind', 'batch', 'productId', v_piece, 'quantity', 1, 'lineTotalPiastres', 100))
                         from generate_series(1, 100)));
  t0 := clock_timestamp();
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_preview_purchase(%L::jsonb)', v_doc));
  v_prev := (extract(epoch from clock_timestamp() - t0) * 1000)::integer;
  if not pg_temp.ok(v_x) then
    perform pg_temp.zt('T02 big purchase (100 lines) via session: preview + post within half of authenticated timeout', false, 'preview ' || v_x::text);
    return;
  end if;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_purchase(%L::uuid, %L::jsonb)', v_cmd, v_doc));
  v_id := (v_x ->> 'docId')::bigint;
  select d.version into v_ver from public.purchase_docs d where d.id = v_id;
  v_cmd := gen_random_uuid();
  insert into pg_temp.zt_cmds values (v_cmd);
  t0 := clock_timestamp();
  v_x := pg_temp.as_user(v_c, format('select public.zell_inv_session_post_purchase(%L::uuid, %s, %s)', v_cmd, v_id, v_ver));
  v_post := (extract(epoch from clock_timestamp() - t0) * 1000)::integer;
  update pg_temp.zt_timing set auth_timeout = v_auth, service_timeout = v_srv, preview_ms = v_prev, post_ms = v_post;
  perform pg_temp.zt('T02 big purchase (100 lines) via session: preview + post within half of authenticated timeout',
    pg_temp.ok(v_x) and v_x ->> 'status' = 'posted'
      and greatest(v_prev, v_post) < coalesce(v_lim / 2, 25000),
    'preview_ms=' || v_prev || ' post_ms=' || coalesce(v_post::text, 'null') || ' limit_ms=' || coalesce((v_lim / 2)::text, '25000 (unset)')
      || ' ' || left(coalesce(v_x ->> '_error', ''), 40));
exception when others then
  perform pg_temp.zt_block_fail('T', sqlstate, sqlerrm);
end
$zT$;

-- النتيجة: صف ملخص (ord = 0) وبعده صف لكل اختبار. verdict = PASS بس لو fail = 0 والـ skips = المتوقعة بالظبط.
-- أعمدة psql -tA: 1 ord · 2 kind · 7 profile · 8 pass · 9 fail · 10 skip · 11 verdict · 12 active_owners · 13 active_admins
--   14 expected_skips · 15 actual_skips · 16 auth_timeout · 17 service_timeout · 18 big_preview_ms · 19 big_post_ms
with r as (
  select * from pg_temp.zt_results
), c as (
  select count(*) filter (where r.outcome = 'pass') as pass_n,
         count(*) filter (where r.outcome = 'fail') as fail_n,
         count(*) filter (where r.outcome = 'skip') as skip_n
    from r
), a as (
  select array(select r.id from r where r.outcome = 'skip' order by r.id collate "C") as actual
), e as (
  select x.expected, x.owners_active, x.admins_active from pg_temp.zt_expect x
), t as (
  select * from pg_temp.zt_timing
)
select 0::integer as ord,
       'summary'::text as kind,
       null::text as test_id,
       null::text as test_name,
       null::text as outcome,
       null::text as detail,
       pg_catalog.current_setting('zell.ptest_profile', true) as profile,
       c.pass_n as pass,
       c.fail_n as fail,
       c.skip_n as skip,
       case when c.fail_n = 0 and c.pass_n > 0 and a.actual = e.expected then 'PASS' else 'FAIL' end as verdict,
       e.owners_active as active_owners,
       e.admins_active as active_admins,
       array_to_string(e.expected, ',') as expected_skips,
       array_to_string(a.actual, ',') as actual_skips,
       t.auth_timeout,
       t.service_timeout,
       t.preview_ms as big_preview_ms,
       t.post_ms as big_post_ms
  from c, a, e, t
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail,
       null::text, null::bigint, null::bigint, null::bigint, null::text, null::integer, null::integer, null::text, null::text,
       null::text, null::text, null::integer, null::integer
  from r
order by 1;

rollback;
