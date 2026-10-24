-- =====================================================================
-- backend/db/baseline/b1_products_columns.sql — BASELINE-OUTSIDE (docs/contracts/BASELINE-OUTSIDE.md §١٠). CI ONLY.
-- Draws what was created outside the migration files: zell_valid_benefits + six products columns + product_images.fit
-- + products_benefits_shape · products_short_benefit_length · product_images_fit_check.
-- Source: Production catalog reads (step 0, 2026-10-24 13:54:58Z; columns read, 2026-10-24 17:22:31Z), copied as read —
-- function text = pg_get_functiondef, constraints = pg_get_constraintdef, column types/defaults/NOT NULL as read.
-- No improvement, no behaviour change. NEVER applied to Production: the guard below refuses without zell.ci_scratch=on.
-- Place (build_from_scratch.list): after 0012, before 0013 — products must end at updated_at (column 14) so the new
-- columns land at 15..20 like Production (0013 then adds lock_width at 21); product_images.fit lands at 16 (last).
-- =====================================================================
begin;

do $guard$
declare
  v text;
begin
  -- (a) disposable CI database only (zell.ci_scratch is set by backend/db/ci/build_from_scratch.sh). Production = refused.
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_BASELINE_NOT_SCRATCH: B1 is a CI-only baseline file (products content columns); never apply it to Production';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_BASELINE_B1_WRONG_ROLE: current_user=%', current_user;
  end if;
  if pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('authenticated') is null or pg_catalog.to_regrole('service_role') is null then
    raise exception 'ZELL_BASELINE_B1_REQUIRED_MISSING: platform roles anon / authenticated / service_role';
  end if;

  -- (b) nothing this file creates may already exist
  if exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_valid_benefits')
     or exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.products')
                and a.attname in ('brand', 'images', 'before_image', 'after_image', 'short_benefit', 'benefits') and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.product_images')
                and a.attname = 'fit' and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_constraint c where c.connamespace = 'public'::regnamespace
                and c.conname in ('product_images_fit_check', 'products_benefits_shape', 'products_short_benefit_length')) then
    raise exception 'ZELL_BASELINE_B1_ALREADY_PRESENT';
  end if;
  -- (c) required from earlier stages, with the exact column numbers (the read positions depend on them)
  select pg_catalog.string_agg(a.attnum || ':' || a.attname, ',' order by a.attnum) into v
    from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.products') and a.attnum > 0;
  if v is distinct from '1:id,2:name_ar,3:name_en,4:description_ar,5:image_url,6:price_per_meter_piastres,7:width_cm,8:min_length_cm,9:step_cm,10:max_length_cm,11:is_active,12:sort_order,13:created_at,14:updated_at' then
    raise exception 'ZELL_BASELINE_B1_REQUIRED_MISSING: public.products columns = %', v;
  end if;
  select pg_catalog.string_agg(a.attnum || ':' || a.attname, ',' order by a.attnum) into v
    from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.product_images') and a.attnum > 0;
  if v is distinct from '1:id,2:product_id,3:bucket,4:object_path,5:kind,6:alt_text,7:sort_order,8:is_primary,9:width_px,10:height_px,11:bytes,12:content_type,13:checksum,14:created_at,15:updated_at' then
    raise exception 'ZELL_BASELINE_B1_REQUIRED_MISSING: public.product_images columns = %', v;
  end if;
end
$guard$;

-- (1) zell_valid_benefits — text as read (pg_get_functiondef), owner and EXECUTE as read.
CREATE OR REPLACE FUNCTION public.zell_valid_benefits(value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select
    pg_catalog.jsonb_typeof(value) = 'array'
    and pg_catalog.jsonb_array_length(value) <= 6
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(value) item
      where pg_catalog.jsonb_typeof(item) <> 'string'
         or pg_catalog.char_length(item #>> '{}') > 140
         or pg_catalog.btrim(item #>> '{}') = ''
    )
$function$
;
alter function public.zell_valid_benefits(value jsonb) owner to postgres;
revoke all on function public.zell_valid_benefits(value jsonb) from public, anon, authenticated, service_role;
grant execute on function public.zell_valid_benefits(value jsonb) to service_role;

-- (2) products columns 15..20, in the read order.
alter table public.products add column brand text;
alter table public.products add column images jsonb default '[]'::jsonb not null;
alter table public.products add column before_image text;
alter table public.products add column after_image text;
alter table public.products add column short_benefit text;
alter table public.products add column benefits jsonb default '[]'::jsonb not null;

-- (3) product_images.fit (column 16).
alter table public.product_images add column fit text default 'contain'::text not null;

-- (4) constraints, definitions as read.
alter table public.product_images add constraint product_images_fit_check CHECK ((fit = ANY (ARRAY['cover'::text, 'contain'::text])));
alter table public.products add constraint products_benefits_shape CHECK (public.zell_valid_benefits(benefits));
alter table public.products add constraint products_short_benefit_length CHECK (((short_benefit IS NULL) OR (char_length(short_benefit) <= 180)));

-- (5) postflight
do $verify$
declare
  v text;
begin
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_valid_benefits(jsonb)')) is distinct from 'b029fb93e948751756c7b312a51c5370' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_valid_benefits';
  end if;
  select pg_catalog.string_agg(a.attnum || ':' || a.attname, ',' order by a.attnum) into v
    from pg_catalog.pg_attribute a where a.attrelid = 'public.products'::regclass and a.attnum > 14 and not a.attisdropped;
  if v is distinct from '15:brand,16:images,17:before_image,18:after_image,19:short_benefit,20:benefits' then
    raise exception 'ZELL_BASELINE_B1_POSITIONS: products %', v;
  end if;
  if (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = 'public.product_images'::regclass and a.attname = 'fit') <> 16 then
    raise exception 'ZELL_BASELINE_B1_POSITIONS: product_images.fit';
  end if;
end
$verify$;

commit;
