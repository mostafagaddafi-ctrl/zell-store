-- =====================================================================
-- backend/db/ci/platform_shim.sql — BASELINE-OUTSIDE §4-2, §9-5. CI ONLY, disposable PostgreSQL 17.
-- Run once by the CI superuser (CI_SUPERUSER, default supabase_admin) on the freshly created build database,
-- BEFORE any file of build_from_scratch.list. NOT Supabase — a minimal simulation. Limits:
--   * roles: postgres = LOGIN CREATEROLE BYPASSRLS, NOT superuser (same properties as Production step 0);
--     anon / authenticated / service_role / authenticator with Production memberships (postgres has them
--     WITH ADMIN OPTION). No PostgREST / GoTrue / Storage API behind them.
--   * auth: auth.users (id, email, created_at) + auth.uid() / auth.role() / auth.jwt() from request.jwt.*.
--   * storage: storage.buckets / storage.objects table shapes only; postgres may read/insert buckets (0002).
--   * schema extensions is created BEFORE pgcrypto (and any extension).
-- Any failure here = platform requirement failure = stop and report (no skipping, no extra simulation).
-- =====================================================================
begin;

do $g$
begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_SHIM_NOT_SCRATCH';
  end if;
  if not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'ZELL_SHIM_NEEDS_CI_SUPERUSER: %', current_user;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator')) then
    raise exception 'ZELL_SHIM_NOT_FRESH_CLUSTER';
  end if;
end
$g$;

-- (1) extensions first, then pgcrypto inside it.
create schema extensions;
create extension pgcrypto with schema extensions;

-- (2) roles (properties as read in step 0).
-- password 'ci' = throwaway CI container password (same as backend/db/ci/0021p_sql_ci.sh); never a real credential.
create role postgres login createrole bypassrls nosuperuser password 'ci';
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password 'ci';
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role, authenticator to postgres with admin option;

-- (3) the build database and schema public belong to postgres (like Supabase).
do $o$ begin execute pg_catalog.format('alter database %I owner to postgres', pg_catalog.current_database()); end $o$;
alter schema public owner to postgres;
revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- (4) auth (minimum).
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant usage on schema auth to postgres, anon, authenticated, service_role;
grant select, insert, update, delete, references on auth.users to postgres;
grant execute on function auth.uid(), auth.role(), auth.jwt() to postgres, anon, authenticated, service_role;

-- (5) storage (minimum).
create schema storage;
create table storage.buckets (id text primary key, name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to postgres, service_role;

do $v$
begin
  if not exists (select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
                 where e.extname = 'pgcrypto' and n.nspname = 'extensions') then
    raise exception 'ZELL_SHIM_PGCRYPTO_NOT_IN_EXTENSIONS';
  end if;
  if (select rolsuper or not rolcreaterole or not rolbypassrls from pg_catalog.pg_roles where rolname = 'postgres') then
    raise exception 'ZELL_SHIM_POSTGRES_ROLE_SHAPE';
  end if;
end
$v$;

commit;
