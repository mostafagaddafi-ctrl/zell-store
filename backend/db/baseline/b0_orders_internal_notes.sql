-- =====================================================================
-- backend/db/baseline/b0_orders_internal_notes.sql — BASELINE-OUTSIDE (docs/contracts/BASELINE-OUTSIDE.md §١١). CI ONLY.
-- Draws orders.internal_notes + orders_internal_notes_length, created outside the migration files.
-- Source: Production design read of orders / order_items (2026-10-24 18:36:19Z), copied as read: column type / NOT NULL /
-- default as read, constraint = pg_get_constraintdef. Live column position 16 (no fake columns to mimic the stored number).
-- Its column privilege (UPDATE to zell_order_definer) comes from 0021a_a1_order_cycle.sql (grant update (...)); not repeated here.
-- No improvement, no behaviour change. NEVER applied to Production: the guard refuses without zell.ci_scratch=on.
-- Place: right after schema.sql (orders ends at updated_at, column 15), before 0006a adds the next orders columns (0005b is
-- excluded from the build list: never run on Production, contract §١١-5).
-- =====================================================================
begin;

do $guard$
declare
  v text;
begin
  -- (a) disposable CI database only (zell.ci_scratch is set by backend/db/ci/build_from_scratch.sh). Production = refused.
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_BASELINE_NOT_SCRATCH: B0 is a CI-only baseline file (orders internal notes); never apply it to Production';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_BASELINE_B0_WRONG_ROLE: current_user=%', current_user;
  end if;
  if pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('authenticated') is null or pg_catalog.to_regrole('service_role') is null then
    raise exception 'ZELL_BASELINE_B0_REQUIRED_MISSING: platform roles anon / authenticated / service_role';
  end if;

  -- (b) nothing this file creates may already exist
  if exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.orders')
             and a.attname = 'internal_notes' and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_constraint c where c.connamespace = 'public'::regnamespace
                and c.conname = 'orders_internal_notes_length') then
    raise exception 'ZELL_BASELINE_B0_ALREADY_PRESENT';
  end if;
  -- (c) required: orders from schema.sql, ending exactly at updated_at (live position 16 depends on it)
  select pg_catalog.string_agg(a.attnum || ':' || a.attname, ',' order by a.attnum) into v
    from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.orders') and a.attnum > 0;
  if v is distinct from '1:id,2:order_number,3:status,4:customer_name,5:customer_phone,6:governorate,7:address,8:notes,9:subtotal_piastres,10:shipping_piastres,11:total_piastres,12:notified_at,13:notify_error,14:created_at,15:updated_at' then
    raise exception 'ZELL_BASELINE_B0_REQUIRED_MISSING: public.orders columns = %', v;
  end if;
end
$guard$;

alter table public.orders add column internal_notes text;
alter table public.orders add constraint orders_internal_notes_length CHECK (((internal_notes IS NULL) OR (char_length(internal_notes) <= 2000)));

do $verify$
begin
  if (select pg_catalog.count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass
        and a.attnum > 0 and not a.attisdropped and a.attnum <= (select b.attnum from pg_catalog.pg_attribute b
          where b.attrelid = 'public.orders'::regclass and b.attname = 'internal_notes')) <> 16 then
    raise exception 'ZELL_BASELINE_B0_POSITION';
  end if;
  if (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
        where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_internal_notes_length') is distinct from 'CHECK (((internal_notes IS NULL) OR (char_length(internal_notes) <= 2000)))' then
    raise exception 'ZELL_BASELINE_B0_CONSTRAINT';
  end if;
end
$verify$;

commit;
