-- =====================================================================
-- backend/db/baseline/b2_admin_functions.sql — BASELINE-OUTSIDE (docs/contracts/BASELINE-OUTSIDE.md §١٠). CI ONLY.
-- Draws the five admin RPC functions created outside the migration files:
--   zell_save_shipping · zell_save_identity · zell_reorder_products · zell_reorder_product_images · zell_set_primary_product_image
-- Text = pg_get_functiondef as read in step 0 (2026-10-24 13:54:58Z); owner and EXECUTE privileges as read.
-- No improvement, no behaviour change. NEVER applied to Production: the guard refuses without zell.ci_scratch=on.
-- Place: right after b1 (zell_set_primary_product_image writes product_images.fit), before 0013.
-- =====================================================================
begin;

do $guard$
declare
  v text;
begin
  -- (a) disposable CI database only (zell.ci_scratch is set by backend/db/ci/build_from_scratch.sh). Production = refused.
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_BASELINE_NOT_SCRATCH: B2 is a CI-only baseline file (admin RPC functions); never apply it to Production';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_BASELINE_B2_WRONG_ROLE: current_user=%', current_user;
  end if;
  if pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('authenticated') is null or pg_catalog.to_regrole('service_role') is null then
    raise exception 'ZELL_BASELINE_B2_REQUIRED_MISSING: platform roles anon / authenticated / service_role';
  end if;

  -- (b) nothing this file creates may already exist (any overload)
  if exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('zell_save_shipping', 'zell_save_identity', 'zell_reorder_products', 'zell_reorder_product_images', 'zell_set_primary_product_image')) then
    raise exception 'ZELL_BASELINE_B2_ALREADY_PRESENT';
  end if;
  -- (c) required: b1 done, and the tables/columns the bodies use
  if pg_catalog.to_regprocedure('public.zell_valid_benefits(jsonb)') is null then
    raise exception 'ZELL_BASELINE_B2_REQUIRED_MISSING: b1 (zell_valid_benefits)';
  end if;
  select pg_catalog.count(*)::text into v from pg_catalog.pg_attribute a where not a.attisdropped and a.attnum > 0 and (
       (a.attrelid = pg_catalog.to_regclass('public.settings') and a.attname in ('key', 'value', 'updated_at'))
    or (a.attrelid = pg_catalog.to_regclass('public.products') and a.attname in ('id', 'sort_order', 'updated_at'))
    or (a.attrelid = pg_catalog.to_regclass('public.product_images') and a.attname in ('id', 'product_id', 'kind', 'sort_order', 'is_primary', 'fit', 'updated_at')));
  if v is distinct from '13' then
    raise exception 'ZELL_BASELINE_B2_REQUIRED_MISSING: settings / products / product_images columns (% of 13)', v;
  end if;
end
$guard$;

-- zell_save_shipping
CREATE OR REPLACE FUNCTION public.zell_save_shipping(p_expected_updated_at timestamp with time zone, p_rates jsonb, p_default_piastres integer, p_free_threshold_piastres integer, p_disabled jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_version timestamptz; new_version timestamptz := now(); updated_count integer;
begin
  with locked as (
    select updated_at from public.settings
    where key in ('shipping_rates','shipping_default_piastres','free_shipping_threshold_piastres','shipping_disabled_governorates')
    for update
  ) select max(updated_at) into current_version from locked;
  if current_version is null or pg_catalog.date_trunc('milliseconds', current_version) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then return null; end if;
  if pg_catalog.jsonb_typeof(p_rates)<>'object' or pg_catalog.jsonb_typeof(p_disabled)<>'array'
     or p_default_piastres<0 or p_free_threshold_piastres<0 then raise exception 'ZELL_INVALID_SHIPPING'; end if;
  update public.settings s set value=v.value, updated_at=new_version
  from (values
    ('shipping_rates'::text,p_rates),
    ('shipping_default_piastres',pg_catalog.to_jsonb(p_default_piastres)),
    ('free_shipping_threshold_piastres',pg_catalog.to_jsonb(p_free_threshold_piastres)),
    ('shipping_disabled_governorates',p_disabled)
  ) v(key,value) where s.key=v.key;
  get diagnostics updated_count=row_count;
  if updated_count<>4 then raise exception 'ZELL_SHIPPING_KEYS_MISSING'; end if;
  return new_version;
end; $function$
;
alter function public.zell_save_shipping(p_expected_updated_at timestamp with time zone, p_rates jsonb, p_default_piastres integer, p_free_threshold_piastres integer, p_disabled jsonb) owner to postgres;
revoke all on function public.zell_save_shipping(p_expected_updated_at timestamp with time zone, p_rates jsonb, p_default_piastres integer, p_free_threshold_piastres integer, p_disabled jsonb) from public, anon, authenticated, service_role;
grant execute on function public.zell_save_shipping(p_expected_updated_at timestamp with time zone, p_rates jsonb, p_default_piastres integer, p_free_threshold_piastres integer, p_disabled jsonb) to service_role;

-- zell_save_identity
CREATE OR REPLACE FUNCTION public.zell_save_identity(p_expected_updated_at timestamp with time zone, p_store_name text, p_offer_text text, p_whatsapp_number text, p_whatsapp_message text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_version timestamptz; new_version timestamptz:=now(); updated_count integer;
begin
  with locked as (
    select updated_at from public.settings
    where key in ('store_name','offer_text','whatsapp_number','whatsapp_message')
    for update
  ) select max(updated_at) into current_version from locked;
  if current_version is null or pg_catalog.date_trunc('milliseconds', current_version) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then return null; end if;
  if pg_catalog.btrim(p_store_name)='' or pg_catalog.char_length(p_store_name)>120
     or pg_catalog.char_length(p_offer_text)>240 or pg_catalog.char_length(p_whatsapp_number)>20
     or pg_catalog.char_length(p_whatsapp_message)>500 then raise exception 'ZELL_INVALID_IDENTITY'; end if;
  update public.settings s set value=v.value, updated_at=new_version
  from (values
    ('store_name'::text,pg_catalog.to_jsonb(pg_catalog.btrim(p_store_name))),
    ('offer_text',pg_catalog.to_jsonb(pg_catalog.btrim(p_offer_text))),
    ('whatsapp_number',pg_catalog.to_jsonb(pg_catalog.btrim(p_whatsapp_number))),
    ('whatsapp_message',pg_catalog.to_jsonb(pg_catalog.btrim(p_whatsapp_message)))
  ) v(key,value) where s.key=v.key;
  get diagnostics updated_count=row_count;
  if updated_count<>4 then raise exception 'ZELL_IDENTITY_KEYS_MISSING'; end if;
  return new_version;
end; $function$
;
alter function public.zell_save_identity(p_expected_updated_at timestamp with time zone, p_store_name text, p_offer_text text, p_whatsapp_number text, p_whatsapp_message text) owner to postgres;
revoke all on function public.zell_save_identity(p_expected_updated_at timestamp with time zone, p_store_name text, p_offer_text text, p_whatsapp_number text, p_whatsapp_message text) from public, anon, authenticated, service_role;
grant execute on function public.zell_save_identity(p_expected_updated_at timestamp with time zone, p_store_name text, p_offer_text text, p_whatsapp_number text, p_whatsapp_message text) to service_role;

-- zell_reorder_products
CREATE OR REPLACE FUNCTION public.zell_reorder_products(p_ids integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actual_count integer;
  updated_count integer;
begin
  if p_ids is null or pg_catalog.array_length(p_ids, 1) is null then raise exception 'ZELL_INVALID_ORDER'; end if;
  if (select count(distinct id) from pg_catalog.unnest(p_ids) id) <> pg_catalog.array_length(p_ids, 1) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;
  select count(*) into actual_count from public.products;
  if actual_count <> pg_catalog.array_length(p_ids, 1)
     or exists(select 1 from public.products p where not (p.id = any(p_ids))) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;

  update public.products p
  set sort_order = o.ord, updated_at = now()
  from pg_catalog.unnest(p_ids) with ordinality o(id, ord)
  where p.id = o.id;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$
;
alter function public.zell_reorder_products(p_ids integer[]) owner to postgres;
revoke all on function public.zell_reorder_products(p_ids integer[]) from public, anon, authenticated, service_role;
grant execute on function public.zell_reorder_products(p_ids integer[]) to service_role;

-- zell_reorder_product_images
CREATE OR REPLACE FUNCTION public.zell_reorder_product_images(p_product_id integer, p_image_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actual_count integer;
  updated_count integer;
begin
  if p_image_ids is null or pg_catalog.array_length(p_image_ids, 1) is null then raise exception 'ZELL_INVALID_ORDER'; end if;
  if (select count(distinct id) from pg_catalog.unnest(p_image_ids) id) <> pg_catalog.array_length(p_image_ids, 1) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;
  select count(*) into actual_count
  from public.product_images where product_id = p_product_id and kind = 'gallery';
  if actual_count <> pg_catalog.array_length(p_image_ids, 1)
     or exists(
       select 1 from public.product_images pi
       where pi.product_id = p_product_id and pi.kind = 'gallery' and not (pi.id = any(p_image_ids))
     ) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;

  update public.product_images pi
  set sort_order = o.ord - 1, updated_at = now()
  from pg_catalog.unnest(p_image_ids) with ordinality o(id, ord)
  where pi.id = o.id and pi.product_id = p_product_id and pi.kind = 'gallery';
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$
;
alter function public.zell_reorder_product_images(p_product_id integer, p_image_ids bigint[]) owner to postgres;
revoke all on function public.zell_reorder_product_images(p_product_id integer, p_image_ids bigint[]) from public, anon, authenticated, service_role;
grant execute on function public.zell_reorder_product_images(p_product_id integer, p_image_ids bigint[]) to service_role;

-- zell_set_primary_product_image
CREATE OR REPLACE FUNCTION public.zell_set_primary_product_image(p_product_id integer, p_image_id bigint)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  changed_at timestamptz;
begin
  perform 1
  from public.product_images
  where product_id = p_product_id and kind = 'gallery'
  for update;

  if not exists (
    select 1 from public.product_images
    where id = p_image_id and product_id = p_product_id and kind = 'gallery'
  ) then
    return null;
  end if;

  update public.product_images
  set is_primary = false, fit = 'contain', updated_at = now()
  where product_id = p_product_id and is_primary and id <> p_image_id;

  update public.product_images
  set is_primary = true, fit = 'cover', updated_at = now()
  where id = p_image_id and product_id = p_product_id and kind = 'gallery'
  returning updated_at into changed_at;

  return changed_at;
end;
$function$
;
alter function public.zell_set_primary_product_image(p_product_id integer, p_image_id bigint) owner to postgres;
revoke all on function public.zell_set_primary_product_image(p_product_id integer, p_image_id bigint) from public, anon, authenticated, service_role;
grant execute on function public.zell_set_primary_product_image(p_product_id integer, p_image_id bigint) to service_role;

do $verify$
begin
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_save_shipping(timestamp with time zone, jsonb, integer, integer, jsonb)')) is distinct from '0b736a0c14a59b9ab7e9db5026278a55' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_save_shipping';
  end if;
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_save_identity(timestamp with time zone, text, text, text, text)')) is distinct from '0ae2f42d5af0d03b535810090b249b39' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_save_identity';
  end if;
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_reorder_products(integer[])')) is distinct from 'ef79a5356681e54415bd179067dae2d3' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_reorder_products';
  end if;
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_reorder_product_images(integer, bigint[])')) is distinct from '5a72d3dad0748e4196bc3964b9dc3ab3' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_reorder_product_images';
  end if;
  if (select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.zell_set_primary_product_image(integer, bigint)')) is distinct from '9e2759ce136b8d5dd4e472c3d6419cdf' then
    raise exception 'ZELL_BASELINE_DEF_MISMATCH: zell_set_primary_product_image';
  end if;
end
$verify$;

commit;
