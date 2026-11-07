-- 0027 DEFAULT-PRIVILEGES — اختبار قبل التطبيق (smoke على Production) لـ 0027_default_privileges.sql
--
-- • قبل التطبيق بس (الصفوف = لقطة العقد §١ بالحرف)، وإلا ZELL_0027_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. مفيش كتابة بيانات. كائنات تجربة zell_dp_probe_* (جدول وsequence ودالة)
--   بتتعمل قبل الجسم وبعده في public وبتترجع مع المعاملة، وبصمة صلاحيات الكائنات الموجودة (public وstorage ودوال postgres)
--   بتتحسب قبل الجسم وبعده (العقد §٦-٣).
-- • الأقفال والحدود: lock_timeout 5s · statement_timeout 30s · idle_in_transaction_session_timeout 15s من أول سطر بعد begin (قبل الحارس
--   وأول create). كتابة قصيرة في pg_default_acl، وإنشاء كائنات تجربة في public.
-- • المتوقع: PASS بـ 7 نجاح و 0 فشل.

begin;
-- الحدود قبل أي حارس أو DDL:
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0027';
set local search_path = pg_catalog, pg_temp;

do $zguard$
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
    raise exception 'ZELL_0027_PTEST_PRE_APPLY_ONLY' using detail = pg_catalog.left(coalesce(v_now, '(null)'), 2000);
  end if;
  perform pg_catalog.set_config('zell.pt0027_fp', pg_catalog.md5(pg_catalog.concat_ws('|',
      (select coalesce(pg_catalog.string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || pg_catalog.pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, ''),
                       ',' order by n.nspname collate "C", c.relname collate "C", c.relkind::text collate "C"), '')
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'zell\_dp\_probe%'),
      (select coalesce(pg_catalog.string_agg(p.oid::regprocedure::text || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, ''),
                       ',' order by p.oid::regprocedure::text collate "C"), '')
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where (n.nspname in ('public', 'storage') or p.proowner = 'postgres'::regrole) and p.proname not like 'zell\_dp\_probe%'),
      (select coalesce(pg_catalog.string_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || a.attacl::text,
                       ',' order by n.nspname collate "C", c.relname collate "C", a.attname collate "C"), '')
         from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'storage') and a.attnum > 0 and not a.attisdropped and a.attacl is not null
          and c.relname not like 'zell\_dp\_probe%'))), true);
end
$zguard$;

-- كائنات تجربة قبل الجسم (بالصلاحيات الافتراضية الحالية)
create table public.zell_dp_probe_t0 (id integer);
create sequence public.zell_dp_probe_s0;
create function public.zell_dp_probe_f0() returns integer language sql as 'select 1';

create temporary table zt_results (n serial, id text, outcome text, detail text) on commit drop;

do $zpre$
declare
  v_ok boolean;
begin
  v_ok := pg_catalog.has_table_privilege('anon', 'public.zell_dp_probe_t0', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.zell_dp_probe_t0', 'SELECT')
    and pg_catalog.has_sequence_privilege('anon', 'public.zell_dp_probe_s0', 'USAGE')
    and pg_catalog.has_function_privilege('anon', 'public.zell_dp_probe_f0()', 'EXECUTE')
    and exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) x
                 where p.oid = 'public.zell_dp_probe_f0()'::regprocedure and x.grantee = 0);
  insert into pg_temp.zt_results (id, outcome, detail) values ('T01', case when v_ok then 'pass' else 'fail' end,
    'before the body: new objects get anon / authenticated and PUBLIC EXECUTE (the probe tells old from new)');
end
$zpre$;

-- >>> 0027 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '15s';

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
    raise exception 'ZELL_0027_BASELINE_DRIFT' using detail = pg_catalog.left(coalesce(v_now, '(null)'), 2000);
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
    raise exception 'ZELL_0027_POST_SHAPE' using detail = pg_catalog.left(coalesce(v_now, '(null)'), 2000);
  end if;
end
$dppost$;
-- <<< 0027 BODY

-- كائنات تجربة بعد الجسم
create table public.zell_dp_probe_t1 (id integer);
create sequence public.zell_dp_probe_s1;
create function public.zell_dp_probe_f1() returns integer language sql as 'select 1';

do $zchk$
declare
  v_ok boolean;
begin
  v_ok := (select coalesce(pg_catalog.string_agg(s.k || ' = ' || s.v, ' ; ' order by s.k collate "C"), '')
     from (select pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
                  d.defaclacl::text as v
             from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace) as s) = (select pg_catalog.string_agg(e.k || ' = ' || e.v, ' ; ' order by e.k collate "C")
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
  insert into pg_temp.zt_results (id, outcome, detail) values ('T02', case when v_ok then 'pass' else 'fail' end,
    'pg_default_acl = expected after 0027 (25 rows, letter for letter)');

  v_ok := not pg_catalog.has_table_privilege('anon', 'public.zell_dp_probe_t1', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.zell_dp_probe_t1', 'SELECT')
    and not pg_catalog.has_table_privilege('anon', 'public.zell_dp_probe_t1', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.zell_dp_probe_t1', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.zell_dp_probe_t1', 'INSERT');
  insert into pg_temp.zt_results (id, outcome, detail) values ('T03', case when v_ok then 'pass' else 'fail' end,
    'new table: no anon / authenticated, service_role kept');

  v_ok := not pg_catalog.has_sequence_privilege('anon', 'public.zell_dp_probe_s1', 'USAGE')
    and not pg_catalog.has_sequence_privilege('authenticated', 'public.zell_dp_probe_s1', 'USAGE')
    and pg_catalog.has_sequence_privilege('service_role', 'public.zell_dp_probe_s1', 'USAGE');
  insert into pg_temp.zt_results (id, outcome, detail) values ('T04', case when v_ok then 'pass' else 'fail' end,
    'new sequence: no anon / authenticated, service_role kept');

  v_ok := not pg_catalog.has_function_privilege('anon', 'public.zell_dp_probe_f1()', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.zell_dp_probe_f1()', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.zell_dp_probe_f1()', 'EXECUTE')
    and not exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) x
                     where p.oid = 'public.zell_dp_probe_f1()'::regprocedure and x.grantee = 0);
  insert into pg_temp.zt_results (id, outcome, detail) values ('T05', case when v_ok then 'pass' else 'fail' end,
    'new function: no anon / authenticated, no PUBLIC EXECUTE, service_role kept');

  v_ok := pg_catalog.current_setting('zell.pt0027_fp', true) = pg_catalog.md5(pg_catalog.concat_ws('|',
      (select coalesce(pg_catalog.string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || pg_catalog.pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, ''),
                       ',' order by n.nspname collate "C", c.relname collate "C", c.relkind::text collate "C"), '')
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'zell\_dp\_probe%'),
      (select coalesce(pg_catalog.string_agg(p.oid::regprocedure::text || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, ''),
                       ',' order by p.oid::regprocedure::text collate "C"), '')
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where (n.nspname in ('public', 'storage') or p.proowner = 'postgres'::regrole) and p.proname not like 'zell\_dp\_probe%'),
      (select coalesce(pg_catalog.string_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || a.attacl::text,
                       ',' order by n.nspname collate "C", c.relname collate "C", a.attname collate "C"), '')
         from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'storage') and a.attnum > 0 and not a.attisdropped and a.attacl is not null
          and c.relname not like 'zell\_dp\_probe%')));
  insert into pg_temp.zt_results (id, outcome, detail) values ('T06', case when v_ok then 'pass' else 'fail' end,
    'privileges of existing objects (public, storage, postgres functions) unchanged by the body');

  v_ok := pg_catalog.has_table_privilege('anon', 'public.zell_dp_probe_t0', 'SELECT')
    and pg_catalog.has_sequence_privilege('anon', 'public.zell_dp_probe_s0', 'USAGE')
    and pg_catalog.has_function_privilege('anon', 'public.zell_dp_probe_f0()', 'EXECUTE');
  insert into pg_temp.zt_results (id, outcome, detail) values ('T07', case when v_ok then 'pass' else 'fail' end,
    'objects created before the body keep their privileges (the change is for new objects only)');
end
$zchk$;

select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where r.outcome = 'fail') = 0 and pg_catalog.count(*) = 7 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where r.outcome = 'pass') || ' fail=' || pg_catalog.count(*) filter (where r.outcome = 'fail') as detail
          from pg_temp.zt_results r
        union all
        select r.n, r.id, r.outcome, r.detail from pg_temp.zt_results r) s
 order by s.n;
rollback;
