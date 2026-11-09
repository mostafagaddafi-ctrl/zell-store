-- =====================================================================
-- backend/db/baseline/b4_shipping_disabled_governorates.sql — GOVERNORATES-BOOTSTRAP (docs/contracts/GOVERNORATES-BOOTSTRAP.md §١)
-- and BASELINE-OUTSIDE §١١-6. CI ONLY.
-- Draws settings.shipping_disabled_governorates, created outside the migration files. Production has the key (existence read
-- 2026-11-07 21:20:34Z, DEFAULT-PRIVILEGES §١); its value was NOT read. The value here is SYNTHETIC: '[]' (no governorate
-- disabled), the shape zell_save_shipping requires (jsonb array). Not Production data.
-- NEVER applied to Production: the guard refuses without zell.ci_scratch=on.
-- Place: right after b0 (schema.sql creates settings and the other three shipping keys), before 0002 and 0006b.
-- =====================================================================
begin;

do $guard$
begin
  -- (a) disposable CI database only (zell.ci_scratch is set by backend/db/ci/build_from_scratch.sh). Production = refused.
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_BASELINE_NOT_SCRATCH: B4 is a CI-only baseline file (settings key shipping_disabled_governorates); never apply it to Production';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_BASELINE_B4_WRONG_ROLE: current_user=%', current_user;
  end if;
  -- (b) required: public.settings and the other three shipping keys (schema.sql)
  if pg_catalog.to_regclass('public.settings') is null then
    raise exception 'ZELL_BASELINE_B4_REQUIRED_MISSING: public.settings';
  end if;
  if (select pg_catalog.count(*) from public.settings s
       where s.key in ('shipping_rates', 'shipping_default_piastres', 'free_shipping_threshold_piastres')) <> 3 then
    raise exception 'ZELL_BASELINE_B4_REQUIRED_MISSING: shipping_rates / shipping_default_piastres / free_shipping_threshold_piastres';
  end if;
  -- (c) nothing this file creates may already exist
  if exists (select 1 from public.settings s where s.key = 'shipping_disabled_governorates') then
    raise exception 'ZELL_BASELINE_B4_ALREADY_PRESENT';
  end if;
end
$guard$;

insert into public.settings (key, value) values ('shipping_disabled_governorates', '[]'::jsonb);

-- postflight: exactly one row with the synthetic value, or the whole transaction rolls back.
do $post$
begin
  if (select pg_catalog.count(*) from public.settings s
       where s.key = 'shipping_disabled_governorates' and s.value = '[]'::jsonb) <> 1 then
    raise exception 'ZELL_BASELINE_B4_POST_SHAPE';
  end if;
end
$post$;

commit;
