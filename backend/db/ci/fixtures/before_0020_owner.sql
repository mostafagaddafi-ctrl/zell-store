-- =====================================================================
-- backend/db/ci/fixtures/before_0020_owner.sql — CI ONLY (contract §4-3). Synthetic active owner.
-- Why: 0020 (and 0021p_zell_erp_access) refuse to run without an active owner row in admin_users.
-- Fixed UUID and an @example.invalid address; no real account.
-- =====================================================================
begin;

do $g$
begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_FIXTURE_NOT_SCRATCH';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_FIXTURE_WRONG_ROLE: %', current_user;
  end if;
  if pg_catalog.to_regclass('public.admin_users') is null or pg_catalog.to_regclass('auth.users') is null then
    raise exception 'ZELL_FIXTURE_OWNER_PREREQ_MISSING';
  end if;
  if exists (select 1 from public.admin_users) then
    raise exception 'ZELL_FIXTURE_OWNER_ALREADY_PRESENT';
  end if;
end
$g$;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'ci-owner@example.invalid');
insert into public.admin_users (user_id, role, is_active) values ('00000000-0000-4000-8000-0000000000a1', 'owner', true);

commit;
