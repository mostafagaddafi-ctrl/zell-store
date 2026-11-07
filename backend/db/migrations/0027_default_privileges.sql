-- 0027 DEFAULT-PRIVILEGES — الكائنات الجديدة اللي بيعملها postgres في public مقفولة افتراضيًا قدام anon وauthenticated،
-- والدوال الجديدة اللي بيعملها postgres من غير EXECUTE لـ PUBLIC (SQL بس).
--
-- العقد: docs/contracts/DEFAULT-PRIVILEGES.md (#228، مقبول على fb24fbd).
--   • preflight: صفوف pg_default_acl كلها = لقطة §١ بالحرف (24 صف، ومفيش صف عام)، وإلا ZELL_0027_BASELINE_DRIFT قبل أي تغيير.
--   • الجسم: 4 سطور ALTER DEFAULT PRIVILEGES (§٢). مابيلمسش أي كائن موجود، ولا صفوف أدوار المنصة.
--   • postflight: الصفوف = النتيجة المتوقعة (25 صف: الصفوف 1–3 من غير anon وauthenticated + صف عام للدوال {postgres=X/postgres})، وإلا ZELL_0027_POST_SHAPE.
-- الرجوع: 0027_default_privileges_rollback.sql · التحقق: 0027_default_privileges_verify.sql · الاختبار قبل التطبيق: 0027_default_privileges_ptest.sql ·
-- الأثر: 0027_default_privileges_impact.sql · CI: backend/db/ci/0027_sql_ci.sh
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0027-default-privileges';
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، وكل خطوة بأمر لوحدها (العقد §٧).

begin;
-- >>> 0027 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · صفوف pg_default_acl كلها = لقطة العقد §١ بالحرف (24 صف، ومفيش صف عام).
--     أي اختلاف = وقف قبل أي تغيير (ZELL_0027_BASELINE_DRIFT، والقيمة الفعلية في detail).
do $dppre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_now text;
  v_exp text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0027_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0027_APPROVAL_MISSING';
  end if;
  v_now := (select coalesce(pg_catalog.string_agg(s.k || ' = ' || s.v, ' ; ' order by s.k collate "C"), '')
     from (select pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
                  d.defaclacl::text as v
             from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace) as s);
  v_exp := (select pg_catalog.string_agg(e.k || ' = ' || e.v, ' ; ' order by e.k collate "C")
     from (values
       ('postgres | public | S', '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}'),
       ('postgres | public | f', '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
       ('postgres | public | r', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
       ('postgres | storage | S', '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}'),
       ('postgres | storage | f', '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
       ('postgres | storage | r', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
       ('supabase_admin | extensions | S', '{postgres=r*w*U*/supabase_admin}'),
       ('supabase_admin | extensions | f', '{postgres=X*/supabase_admin}'),
       ('supabase_admin | extensions | r', '{postgres=a*r*w*d*D*x*t*m*/supabase_admin}'),
       ('supabase_admin | graphql | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | graphql | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | graphql | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | graphql_public | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | graphql_public | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | graphql_public | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | public | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | public | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | public | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | realtime | S', '{postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}'),
       ('supabase_admin | realtime | f', '{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}'),
       ('supabase_admin | realtime | r', '{postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}'),
       ('supabase_auth_admin | auth | S', '{postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}'),
       ('supabase_auth_admin | auth | f', '{postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}'),
       ('supabase_auth_admin | auth | r', '{postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}')
     ) as e(k, v));
  if v_now is distinct from v_exp then
    raise exception 'ZELL_0027_BASELINE_DRIFT' using detail = coalesce(v_now, '(null)');
  end if;
end
$dppre$;

-- (1) التغيير (العقد §٢). مابيلمسش أي كائن موجود.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- (2) postflight: الصفوف = النتيجة المتوقعة (25 صف) بالحرف، وإلا ZELL_0027_POST_SHAPE والمعاملة كلها بترجع.
do $dppost$
declare
  v_now text;
  v_exp text;
begin
  v_now := (select coalesce(pg_catalog.string_agg(s.k || ' = ' || s.v, ' ; ' order by s.k collate "C"), '')
     from (select pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
                  d.defaclacl::text as v
             from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace) as s);
  v_exp := (select pg_catalog.string_agg(e.k || ' = ' || e.v, ' ; ' order by e.k collate "C")
     from (values
       ('postgres | public | S', '{postgres=rwU/postgres,service_role=rwU/postgres}'),
       ('postgres | public | f', '{postgres=X/postgres,service_role=X/postgres}'),
       ('postgres | public | r', '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
       ('postgres | storage | S', '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}'),
       ('postgres | storage | f', '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
       ('postgres | storage | r', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
       ('supabase_admin | extensions | S', '{postgres=r*w*U*/supabase_admin}'),
       ('supabase_admin | extensions | f', '{postgres=X*/supabase_admin}'),
       ('supabase_admin | extensions | r', '{postgres=a*r*w*d*D*x*t*m*/supabase_admin}'),
       ('supabase_admin | graphql | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | graphql | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | graphql | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | graphql_public | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | graphql_public | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | graphql_public | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | public | S', '{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}'),
       ('supabase_admin | public | f', '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'),
       ('supabase_admin | public | r', '{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}'),
       ('supabase_admin | realtime | S', '{postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}'),
       ('supabase_admin | realtime | f', '{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}'),
       ('supabase_admin | realtime | r', '{postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}'),
       ('supabase_auth_admin | auth | S', '{postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}'),
       ('supabase_auth_admin | auth | f', '{postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}'),
       ('supabase_auth_admin | auth | r', '{postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}'),
       ('postgres | (all schemas) | f', '{postgres=X/postgres}')
     ) as e(k, v));
  if v_now is distinct from v_exp then
    raise exception 'ZELL_0027_POST_SHAPE' using detail = coalesce(v_now, '(null)');
  end if;
end
$dppost$;
-- <<< 0027 BODY
commit;
