-- =====================================================================
-- backend/db/ci/baseline_smoke.sql — CI ONLY (contract §5, §١١). Isolated smoke calls of the six baseline functions
-- as service_role (the role the admin app uses), inside ONE transaction that is ROLLED BACK.
-- Proves only that no table / helper / privilege is missing. NOT a business-logic test.
-- Inputs are the current values read just before (identity, shipping, product order).
-- Bootstrap gap (§١١): settings key shipping_disabled_governorates is created by no file (Production has it). ONLY inside this
-- rolled-back transaction, a synthetic '[]' row is inserted when (and only when) the key is absent; the echo line reports it.
-- The build itself, the baseline files and every fixture stay without it.
-- =====================================================================
begin;
do $g$ begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then raise exception 'ZELL_SMOKE_NOT_SCRATCH'; end if;
  if current_user <> 'postgres' then raise exception 'ZELL_SMOKE_WRONG_ROLE: %', current_user; end if;
end $g$;

select not exists (select 1 from public.settings where key = 'shipping_disabled_governorates') as synthetic_ship_row \gset
insert into public.settings (key, value)
select 'shipping_disabled_governorates', '[]'::jsonb
where not exists (select 1 from public.settings where key = 'shipping_disabled_governorates');

select pg_catalog.min(id) as pid from public.products \gset
insert into public.product_images (product_id, object_path, kind, sort_order)
values (:pid, 'ci-smoke/a.jpg', 'gallery', 0), (:pid, 'ci-smoke/b.jpg', 'gallery', 1);
select pg_catalog.min(id) as img_a, pg_catalog.max(id) as img_b, pg_catalog.count(*) as n_img
  from public.product_images where product_id = :pid and kind = 'gallery' \gset
select pg_catalog.array_agg(id order by sort_order, id)::text as pids, pg_catalog.count(*) as n_products from public.products \gset
select pg_catalog.max(updated_at)::text as id_stamp,
       pg_catalog.max(value #>> '{}') filter (where key = 'store_name') as v_store,
       coalesce(pg_catalog.max(value #>> '{}') filter (where key = 'offer_text'), '') as v_offer,
       coalesce(pg_catalog.max(value #>> '{}') filter (where key = 'whatsapp_number'), '') as v_wa_number,
       coalesce(pg_catalog.max(value #>> '{}') filter (where key = 'whatsapp_message'), '') as v_wa_message
  from public.settings where key in ('store_name', 'offer_text', 'whatsapp_number', 'whatsapp_message') \gset
select pg_catalog.max(updated_at)::text as ship_stamp,
       pg_catalog.max(value::text) filter (where key = 'shipping_rates') as v_rates,
       pg_catalog.max(value::text) filter (where key = 'shipping_default_piastres') as v_default,
       pg_catalog.max(value::text) filter (where key = 'free_shipping_threshold_piastres') as v_threshold,
       pg_catalog.max(value::text) filter (where key = 'shipping_disabled_governorates') as v_disabled,
       pg_catalog.count(*) as n_ship_keys
  from public.settings where key in ('shipping_rates', 'shipping_default_piastres', 'free_shipping_threshold_piastres', 'shipping_disabled_governorates') \gset

set local role service_role;
select public.zell_valid_benefits('["فايدة تجريبية"]'::jsonb) as s1 \gset
select public.zell_reorder_products(:'pids'::integer[]) as s2 \gset
select public.zell_reorder_product_images(:pid, array[:img_b, :img_a]::bigint[]) as s3 \gset
select (public.zell_set_primary_product_image(:pid, :img_b) is not null) as s4 \gset
select (public.zell_save_identity(:'id_stamp'::timestamptz, :'v_store', :'v_offer', :'v_wa_number', :'v_wa_message') is not null) as s5 \gset
select (public.zell_save_shipping(:'ship_stamp'::timestamptz, :'v_rates'::jsonb, (:'v_default')::integer, (:'v_threshold')::integer, :'v_disabled'::jsonb) is not null) as s6 \gset
reset role;
rollback;
select not exists (select 1 from public.settings where key = 'shipping_disabled_governorates' and :'synthetic_ship_row'::boolean) as rolled_back \gset
\echo ZELL_SMOKE valid_benefits=:s1 reorder_products=:s2/:n_products reorder_images=:s3/:n_img set_primary=:s4 save_identity=:s5 save_shipping=:s6 ship_keys=:n_ship_keys synthetic_ship_row=:synthetic_ship_row synthetic_row_rolled_back=:rolled_back
