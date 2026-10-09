-- 0020-S — هوية الجلسة لدوال المخزون (PR-1: SQL إضافة بس)
--
-- العقد: docs/contracts/0020-S.md (معتمد، #108). القرارات في §٩ منه.
--   • 23 دالة جديدة zell_inv_session_<x> لكل zell_inv_<x> عامة، بنفس المعاملات ناقص p_actor (أسماء مختلفة، مفيش overload).
--     كل واحدة بتجيب الممثل من الجلسة (zell_inv_claims_actor) وبتنادي الدالة القديمة بيه. مفيش أي منطق متكرر.
--   • zell_inv_claims_actor(): sub من request.jwt.claims بشرط role = authenticated، نفس منطق zell_erp_trusted_actor
--     من غير ما تناديها (مفيش أي اعتماد على 0021-P). داخلية: مالهاش EXECUTE لأي دور غير مالكها.
--   • فحص المالك زي النهارده: zell_inv_assert_owner جوه الدالة القديمة (admin_users). من غير هوية أو مش مالك = 45200.
--   • EXECUTE على الـ 23 الجديدة لـ authenticated بس. الدوال القديمة وصلاحياتها (service_role) زي ما هي بالظبط (PR-3 لوحده).
--   • المالك zell_inventory_definer: CREATE تحت SET LOCAL ROLE (زي 0020، بروتوكول 04-DB-SAFETY).
--   • أكواد الـ preflight والـ postflight: ZELL_0020S_* (رسايل قصيرة).
--
-- • ملفي 0020 القديمين اتعدّلوا في نفس الـ PR: 0020_inventory_purchasing_verify.sql صالح قبل وبعد الملف ده (وبيكتب 0020s=applied)،
--   و 0020_inventory_purchasing_rollback.sql بيرفض بـ ZELL_0020_ROLLBACK_0020S_FIRST طول ما الملف ده متطبّق.
--   من غيره سلوكهم زي القديم بالحرف (CI S17). التحقق بعد التطبيق: 0020s_inv_session_verify.sql.
-- الرجوع: 0020s_inv_session_rollback.sql · الاختبار قبل التطبيق: 0020s_inv_session_ptest.sql · CI: backend/db/ci/0020s_sql_ci.sh
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد backup، وقت نشاط قليل. لو مالقاش قفل في 5 ثواني بيفشل كله بأمان.

begin;
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
commit;
