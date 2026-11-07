-- 0027 DEFAULT-PRIVILEGES — التحقق بعد التطبيق (read only، في أي وقت). العقد §٦.
-- المتوقع بعد 0027: PASS بـ 5 نجاح و 0 فشل. قبل 0027 أو بعد الرجوع: FAIL (V01 وV02 وV04) من غير أخطاء تنفيذ.

begin;
set transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local search_path = pg_catalog, pg_temp;
with cur as (
  select pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
         d.defaclacl::text as v
    from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
), want_in(k, v) as (values
  ('postgres | public | S', '{postgres=rwU/postgres,service_role=rwU/postgres}'),
  ('postgres | public | f', '{postgres=X/postgres,service_role=X/postgres}'),
  ('postgres | public | r', '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
), want_out(k, v) as (values
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
), checks as (
  select 1 as n, 'V01'::text as id,
         (select coalesce(pg_catalog.string_agg(c.k || ' = ' || c.v, ' ; ' order by c.k collate "C"), '') from cur c where c.k like 'postgres | public | %')
         = (select pg_catalog.string_agg(w.k || ' = ' || w.v, ' ; ' order by w.k collate "C") from want_in w) as ok,
         'postgres | public (S f r) = expected after 0027 (no anon / authenticated)'::text as detail
  union all
  select 2, 'V02',
         (select pg_catalog.count(*) from cur c where c.k like '% | (all schemas) | %') = 1
         and exists (select 1 from cur c where c.k = 'postgres | (all schemas) | f' and c.v = '{postgres=X/postgres}'),
         'one global row: postgres | (all schemas) | f = {postgres=X/postgres} (no PUBLIC EXECUTE)'
  union all
  select 3, 'V03',
         (select coalesce(pg_catalog.string_agg(c.k || ' = ' || c.v, ' ; ' order by c.k collate "C"), '') from cur c
           where c.k not like 'postgres | public | %' and c.k not like '% | (all schemas) | %')
         = (select pg_catalog.string_agg(w.k || ' = ' || w.v, ' ; ' order by w.k collate "C") from want_out w),
         'rows 4–24 (outside the scope) = contract §١, letter for letter'
  union all
  select 4, 'V04', (select pg_catalog.count(*) from cur) = 25, 'pg_default_acl has 25 rows'
  union all
  select 5, 'V05',
         (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relname like 'zell\_dp\_probe%')
         + (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.proname like 'zell\_dp\_probe%')
         + (select pg_catalog.count(*) from pg_catalog.pg_namespace s where s.nspname like 'zell\_dp\_probe%') = 0,
         'no zell_dp_probe objects left'
)
select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where not k.ok) = 0 and pg_catalog.count(*) = 5 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where k.ok) || ' fail=' || pg_catalog.count(*) filter (where not k.ok) as detail
          from checks k
        union all
        select k.n, k.id, case when k.ok then 'pass' else 'fail' end, k.detail from checks k) s
 order by s.n;
rollback;
