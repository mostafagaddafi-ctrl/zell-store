-- =====================================================================
-- backend/db/baseline/b3_admin_users.sql — BASELINE-OUTSIDE (docs/contracts/BASELINE-OUTSIDE.md §١، §١٠). CI ONLY.
-- Draws public.admin_users (created outside the migration files): columns, constraints, owner, RLS (FORCE off) and
-- privileges as read in step 0 (2026-10-24 13:54:58Z). CREATE TABLE without IF NOT EXISTS on purpose.
-- Its 4 triggers and the log table come from 0021p_zell_erp_access.sql (not repeated here); no policies (as read).
-- No improvement, no behaviour change. NEVER applied to Production: the guard refuses without zell.ci_scratch=on.
-- Place: after 0019, before 0020 (first file that requires admin_users and an active owner).
-- =====================================================================
begin;

do $guard$
declare
  v text;
begin
  -- (a) disposable CI database only (zell.ci_scratch is set by backend/db/ci/build_from_scratch.sh). Production = refused.
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_BASELINE_NOT_SCRATCH: B3 is a CI-only baseline file (admin_users table); never apply it to Production';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_BASELINE_B3_WRONG_ROLE: current_user=%', current_user;
  end if;
  if pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('authenticated') is null or pg_catalog.to_regrole('service_role') is null then
    raise exception 'ZELL_BASELINE_B3_REQUIRED_MISSING: platform roles anon / authenticated / service_role';
  end if;

  -- (b) nothing this file creates may already exist
  if pg_catalog.to_regclass('public.admin_users') is not null
     or exists (select 1 from pg_catalog.pg_constraint c where c.connamespace = 'public'::regnamespace
                and c.conname in ('admin_users_pkey', 'admin_users_role_check', 'admin_users_user_id_fkey')) then
    raise exception 'ZELL_BASELINE_B3_ALREADY_PRESENT';
  end if;
  -- (c) required: auth.users(id uuid) as primary key (platform), referenced by the foreign key
  if pg_catalog.to_regclass('auth.users') is null or not exists (
       select 1 from pg_catalog.pg_index i join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = pg_catalog.to_regclass('auth.users') and i.indisprimary and i.indnatts = 1 and a.attname = 'id'
          and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'uuid') then
    raise exception 'ZELL_BASELINE_B3_REQUIRED_MISSING: auth.users(id uuid primary key)';
  end if;
end
$guard$;

create table public.admin_users (
  user_id uuid not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint admin_users_pkey PRIMARY KEY (user_id),
  constraint admin_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text]))),
  constraint admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.admin_users owner to postgres;
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.admin_users to service_role;

do $verify$
begin
  if (select pg_catalog.string_agg(c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' order by c.conname)
        from pg_catalog.pg_constraint c where c.conrelid = 'public.admin_users'::regclass)
     is distinct from 'admin_users_pkey=PRIMARY KEY (user_id) | admin_users_role_check=CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text]))) | admin_users_user_id_fkey=FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE' then
    raise exception 'ZELL_BASELINE_B3_CONSTRAINTS';
  end if;
  if (select c.relforcerowsecurity or not c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.admin_users'::regclass) then
    raise exception 'ZELL_BASELINE_B3_RLS';
  end if;
end
$verify$;

commit;
