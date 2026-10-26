-- 0022 PRODUCT-DELETE — الرجوع لـ 0022_product_delete.sql في معاملة واحدة.
-- بيرفض لو فيه أي صف storage_orphans بسبب product_deleted (ZELL_0022_RB_HAS_DELETES): بعد أول حذف مفيش رجوع للقيد،
-- والتصحيح للأمام بس. المنتجات المحذوفة مابترجعش غير بالـ backup.
-- الترتيب: revert كود اللوحة الأول، وبعدين الملف ده.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pdrb$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0022_RB_WRONG_CALLER';
  end if;
  if pg_catalog.to_regrole('zell_catalog_definer') is null
     or pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamptz)') is null then
    raise exception 'ZELL_0022_RB_NOT_APPLIED';
  end if;
end
$pdrb$;

lock table public.storage_orphans in share row exclusive mode;

do $pdrbdata$
begin
  if exists (select 1 from public.storage_orphans o where o.reason = 'product_deleted') then
    raise exception 'ZELL_0022_RB_HAS_DELETES';
  end if;
end
$pdrbdata$;

drop trigger zell_catalog_home_products_guard on public.settings;

set local role zell_catalog_definer;
drop function public.zell_product_delete(integer, timestamptz);
drop function public.zell_product_delete_preview(integer);
drop function public.zell_catalog_trg_home_products_guard();
reset role;

set local role zell_inventory_definer;
drop function public.zell_inv_product_stock_ref_exists(integer);
reset role;
revoke execute on function public.zell_inv_product_has_stock_refs(integer) from zell_inventory_definer;

set local role zell_order_definer;
revoke execute on function public.zell_order_actor(boolean), public.zell_order_claims_actor() from zell_catalog_definer;
reset role;
revoke execute on function public.zell_order_admin_role(uuid) from zell_catalog_definer;

alter table public.storage_orphans drop constraint storage_orphans_reason_check;
alter table public.storage_orphans add constraint storage_orphans_reason_check
  check (reason = any (array['insert_failed', 'delete_failed', 'replaced', 'removed']));

drop policy zell_catalog_definer_select on public.products;
drop policy zell_catalog_definer_lock on public.products;
drop policy zell_catalog_definer_delete on public.products;
drop policy zell_catalog_definer_select on public.product_images;
drop policy zell_catalog_definer_lock on public.product_images;
drop policy zell_catalog_definer_select on public.product_widths;
drop policy zell_catalog_definer_lock on public.product_widths;
drop policy zell_catalog_definer_select on public.product_addons;
drop policy zell_catalog_definer_lock on public.product_addons;
drop policy zell_catalog_definer_select on public.product_collections;
drop policy zell_catalog_definer_lock on public.product_collections;
drop policy zell_catalog_definer_select on public.order_items;
drop policy zell_catalog_definer_select on public.settings;
drop policy zell_catalog_definer_update on public.settings;
drop policy zell_catalog_definer_select on public.storage_orphans;
drop policy zell_catalog_definer_lock on public.storage_orphans;
drop policy zell_catalog_definer_insert on public.storage_orphans;

revoke all on table public.products, public.product_images, public.product_widths, public.product_addons,
  public.product_collections, public.order_items, public.settings, public.storage_orphans from zell_catalog_definer;
revoke all on sequence public.storage_orphans_id_seq from zell_catalog_definer;
revoke all on schema public from zell_catalog_definer;
drop role zell_catalog_definer;

do $pdrbpost$
begin
  if pg_catalog.to_regrole('zell_catalog_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('zell_product_delete', 'zell_product_delete_preview',
                                     'zell_inv_product_stock_ref_exists', 'zell_catalog_trg_home_products_guard'))
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'zell_catalog_home_products_guard')
     or exists (select 1 from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%')
     or pg_catalog.has_function_privilege('zell_inventory_definer', 'public.zell_inv_product_has_stock_refs(integer)', 'EXECUTE')
     or (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')
        is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text])))' then
    raise exception 'ZELL_0022_RB_POST_LEFTOVERS';
  end if;
end
$pdrbpost$;

commit;
