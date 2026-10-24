-- backend/db/ci/platform_default_privileges.sql — CI ONLY.
-- Simulates the CURRENT default privileges of schema public seen in step 0 (2026-10-24): objects created by
-- postgres are granted to anon / authenticated / service_role. NOT a recommended setting: the baseline neither
-- repeats nor fixes it (contract §9-2); fixing it is a separate security task. Run by the CI superuser.
begin;
do $g$ begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then raise exception 'ZELL_DEFAULT_PRIVS_NOT_SCRATCH'; end if;
end $g$;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
commit;
