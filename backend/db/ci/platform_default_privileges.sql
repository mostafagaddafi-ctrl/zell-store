-- backend/db/ci/platform_default_privileges.sql — CI ONLY.
-- Simulates the CURRENT default privileges (pg_default_acl) seen on Production: all 24 rows of the read in
-- docs/contracts/DEFAULT-PRIVILEGES.md §١ (2026-11-07 21:20:34Z), letter for letter, grant options included, so the 0027 guard
-- runs in CI exactly as on Production (contract §٦-٤). It also matches BASELINE step 0 (2026-10-24) for postgres in public.
-- NOT a recommended setting: the baseline neither repeats nor fixes it (BASELINE-OUTSIDE §9-2); 0027 changes the postgres/public part.
-- Platform roles and schemas the shim does not create (supabase_auth_admin, dashboard_user, graphql, graphql_public, realtime) are created
-- here only if missing, empty, for these rows only. Run by the CI superuser (CI_SUPERUSER = supabase_admin), after platform_shim.sql.
begin;
do $g$
begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then raise exception 'ZELL_DEFAULT_PRIVS_NOT_SCRATCH'; end if;
  if not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then raise exception 'ZELL_DEFAULT_PRIVS_NEEDS_CI_SUPERUSER'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin')) <> 5 then
    raise exception 'ZELL_DEFAULT_PRIVS_ROLES_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_default_acl) then raise exception 'ZELL_DEFAULT_PRIVS_NOT_FRESH'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then execute 'create role supabase_auth_admin nologin'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'dashboard_user') then execute 'create role dashboard_user nologin'; end if;
end
$g$;
create schema if not exists graphql;
create schema if not exists graphql_public;
create schema if not exists realtime;

-- postgres in public and storage (rows 1–6)
alter default privileges for role postgres in schema public  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public  grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on tables    to postgres, anon, authenticated, service_role;

-- supabase_admin (rows 7–21)
alter default privileges for role supabase_admin in schema extensions grant all on sequences to postgres with grant option;
alter default privileges for role supabase_admin in schema extensions grant all on functions to postgres with grant option;
alter default privileges for role supabase_admin in schema extensions grant all on tables    to postgres with grant option;
alter default privileges for role supabase_admin in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema graphql grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema graphql_public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema graphql_public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema graphql_public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema realtime grant all on sequences to postgres, dashboard_user;
alter default privileges for role supabase_admin in schema realtime grant all on functions to postgres, dashboard_user;
alter default privileges for role supabase_admin in schema realtime grant insert, select on tables to postgres with grant option;
alter default privileges for role supabase_admin in schema realtime grant update, delete, truncate, references, trigger, maintain on tables to postgres;
alter default privileges for role supabase_admin in schema realtime grant all on tables to dashboard_user;

-- supabase_auth_admin in auth (rows 22–24)
alter default privileges for role supabase_auth_admin in schema auth grant all on sequences to postgres, dashboard_user;
alter default privileges for role supabase_auth_admin in schema auth grant all on functions to postgres, dashboard_user;
alter default privileges for role supabase_auth_admin in schema auth grant all on tables    to postgres, dashboard_user;

do $v$
begin
  if (select pg_catalog.count(*) from pg_catalog.pg_default_acl) <> 24 then raise exception 'ZELL_DEFAULT_PRIVS_ROW_COUNT'; end if;
end
$v$;
commit;
