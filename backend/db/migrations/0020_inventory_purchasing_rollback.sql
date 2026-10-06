-- 0020 — الرجوع (rollback) لـ 0020_inventory_purchasing.sql
--
-- (أ) قبل وجود بيانات بس: بيتأكد إن 0020 متطبّق بالكامل، وإن مفيش مورد ولا مستند ولا بند ولا lot ولا command
--     ولا audit، والمواقع = MAIN بس (مسموح اسمه يكون اتعدل). غير كده بيقف بـ ZELL_0020_ROLLBACK_HAS_DATA من غير أي تغيير.
--     الدوال المملوكة لـ zell_inventory_definer (31 = 23 RPC + 8 دوال مساعدة) بتتمسح تحت SET LOCAL ROLE،
--     والمملوكة لـ postgres (4 دوال مساعدة + 8 دوال triggers) بتتمسح كـ postgres. بعدين DROP ROLE.
-- (ب) بعد وجود بيانات: الملف ده بيرفض. مفيش مسار حذف في الريبو. فيه قسم «تجميد» متعلّق في الآخر (بموافقة بس).
-- ⚠ بيتشغّل على Production بموافقة صريحة بس. البروفة الكاملة للملف ده جوه 0020_inventory_purchasing_ptest.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '50s';

do $zrb_pre$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020_WRONG_CALLER';
  end if;
  if pg_catalog.to_regrole('zell_inventory_definer') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 43
     or (select count(*) from pg_catalog.pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
            and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')) <> 10 then
    raise exception 'ZELL_0020_ROLLBACK_NOT_FULLY_APPLIED';
  end if;
  if exists (select 1 from public.suppliers) or exists (select 1 from public.purchase_docs)
     or exists (select 1 from public.purchase_doc_lines) or exists (select 1 from public.purchase_doc_charges)
     or exists (select 1 from public.opening_stock_docs) or exists (select 1 from public.opening_stock_lines)
     or exists (select 1 from public.stock_lots) or exists (select 1 from public.inventory_commands)
     or exists (select 1 from public.inventory_audit_log)
     or (select count(*) from public.inventory_locations) <> 1
     or not exists (select 1 from public.inventory_locations l where l.code = 'MAIN' and l.is_default and l.is_active) then
    raise exception 'ZELL_0020_ROLLBACK_HAS_DATA';
  end if;
end
$zrb_pre$;

create temporary view zell_0020rb_fp_now as
select
  (select count(*) from public.orders) as orders_n,
  (select count(*) from public.order_items) as order_items_n,
  (select count(*) from public.products) as products_n,
  (select count(*) from public.product_widths) as product_widths_n,
  (select count(*) from public.product_addons) as product_addons_n,
  (select count(*) from public.coupons) as coupons_n,
  (select count(*) from public.settings) as settings_n,
  (select count(*) from public.admin_users) as admin_users_n,
  (select coalesce(sum(o.total_piastres), 0) from public.orders o) as orders_total,
  (select md5(coalesce(string_agg(p.id || ':' || p.sale_unit || ':' || p.price_per_meter_piastres || ':' || p.width_cm, ',' order by p.id), ''))
     from public.products p) as products_md5,
  (select md5(coalesce(string_agg(s.key || '=' || s.value::text, ',' order by s.key), ''))
     from public.settings s) as settings_md5,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text), ''))
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('zell_create_order', 'zell_get_order_receipt', 'zell_preview_coupon',
                        'zell_set_product_widths', 'zell_set_product_addons', 'zell_orders_cancelled_final')) as functions_md5;
create temporary table zell_0020rb_fp_before on commit drop as select * from zell_0020rb_fp_now;

drop trigger zinv_products_sale_unit on public.products;
alter table public.purchase_doc_lines drop constraint purchase_doc_lines_product_fk;
alter table public.opening_stock_lines drop constraint opening_stock_lines_product_fk;
alter table public.stock_lots drop constraint stock_lots_product_fk;

-- الدوال المملوكة لـ zell_inventory_definer: 23 RPC + 8 دوال مساعدة = 31 (تحت SET LOCAL ROLE — مفيش INHERIT)
set local role zell_inventory_definer;
drop function public.zell_inv_create_location(uuid, uuid, text, text);
drop function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean);
drop function public.zell_inv_create_supplier(uuid, uuid, text, text, text);
drop function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean);
drop function public.zell_inv_create_purchase(uuid, uuid, jsonb);
drop function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb);
drop function public.zell_inv_post_purchase(uuid, uuid, bigint, integer);
drop function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_create_opening(uuid, uuid, jsonb);
drop function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb);
drop function public.zell_inv_post_opening(uuid, uuid, bigint, integer);
drop function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_list_locations(uuid, boolean, integer, bigint);
drop function public.zell_inv_list_suppliers(uuid, boolean, integer, text);
drop function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint);
drop function public.zell_inv_get_purchase(uuid, bigint);
drop function public.zell_inv_preview_purchase(uuid, jsonb);
drop function public.zell_inv_list_openings(uuid, text, integer, bigint);
drop function public.zell_inv_get_opening(uuid, bigint);
drop function public.zell_inv_preview_opening(uuid, jsonb);
drop function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint);
drop function public.zell_inv_width_allowed(integer, integer[], integer);
drop function public.zell_inv_allocate_lr(bigint, bigint[]);
drop function public.zell_inv_normalize_purchase(jsonb);
drop function public.zell_inv_normalize_opening(jsonb);
drop function public.zell_inv_command_check(uuid, uuid, text, text);
drop function public.zell_inv_doc_void_blockers(text, bigint);
drop function public.zell_inv_unknown_lot_references();
drop function public.zell_inv_void_contract_version();
reset role;

drop table public.stock_lots;
drop table public.purchase_doc_lines;
drop table public.purchase_doc_charges;
drop table public.opening_stock_lines;
drop table public.purchase_docs;
drop table public.opening_stock_docs;
drop table public.suppliers;
drop table public.inventory_locations;
drop table public.inventory_audit_log;
drop table public.inventory_commands;
drop sequence public.purchase_doc_no_seq;
drop sequence public.opening_doc_no_seq;
drop sequence public.roll_lot_seq;
drop sequence public.batch_lot_seq;

-- الدوال المملوكة لـ postgres: 4 دوال مساعدة (3 مسموحة للدور + has_stock_refs) + 8 دوال triggers
drop function public.zell_inv_assert_owner(uuid);
drop function public.zell_inv_lock_products(integer[]);
drop function public.zell_inv_read_products(integer[]);
drop function public.zell_inv_product_has_stock_refs(integer);
drop function public.zell_inv_trg_no_delete();
drop function public.zell_inv_trg_no_truncate();
drop function public.zell_inv_trg_doc_guard();
drop function public.zell_inv_trg_child_insert_guard();
drop function public.zell_inv_trg_append_only();
drop function public.zell_inv_trg_lot_update_guard();
drop function public.zell_inv_trg_master_guard();
drop function public.zell_inv_trg_products_sale_unit();

revoke usage on schema public from zell_inventory_definer;
drop role zell_inventory_definer;

do $zrb_post$
begin
  if (select row(b.*)::text from pg_temp.zell_0020rb_fp_before b)
     is distinct from (select row(n.*)::text from pg_temp.zell_0020rb_fp_now n) then
    raise exception 'ZELL_0020_ROLLBACK_FINGERPRINT_CHANGED';
  end if;
  if pg_catalog.to_regrole('zell_inventory_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace
                   and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
     or (select coalesce(string_agg(g.tgname::text, ',' order by g.tgname), '')
           from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
          where c.relnamespace = 'public'::regnamespace and not g.tgisinternal) <> 'orders_cancelled_final' then
    raise exception 'ZELL_0020_ROLLBACK_INCOMPLETE';
  end if;
end
$zrb_post$;

drop view pg_temp.zell_0020rb_fp_now;
commit;

-- ───────────────────────────────────────────────────────────────────────────────
-- (ب) تجميد قابل للرجوع لو فيه بيانات — متعلّق عن قصد، ومايتشغلش غير بموافقة صريحة.
-- بيوقف اللوحة عن نداء الـ23 RPC، والبيانات بتفضل. الرجوع بنفس الطريقة بـ grant execute ... to service_role.
-- begin;
-- set local role zell_inventory_definer;
-- revoke execute on function public.zell_inv_create_location(uuid, uuid, text, text) from service_role;
-- revoke execute on function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) from service_role;
-- revoke execute on function public.zell_inv_create_supplier(uuid, uuid, text, text, text) from service_role;
-- revoke execute on function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) from service_role;
-- revoke execute on function public.zell_inv_create_purchase(uuid, uuid, jsonb) from service_role;
-- revoke execute on function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) from service_role;
-- revoke execute on function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) from service_role;
-- revoke execute on function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) from service_role;
-- revoke execute on function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) from service_role;
-- revoke execute on function public.zell_inv_create_opening(uuid, uuid, jsonb) from service_role;
-- revoke execute on function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) from service_role;
-- revoke execute on function public.zell_inv_post_opening(uuid, uuid, bigint, integer) from service_role;
-- revoke execute on function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) from service_role;
-- revoke execute on function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) from service_role;
-- revoke execute on function public.zell_inv_list_locations(uuid, boolean, integer, bigint) from service_role;
-- revoke execute on function public.zell_inv_list_suppliers(uuid, boolean, integer, text) from service_role;
-- revoke execute on function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) from service_role;
-- revoke execute on function public.zell_inv_get_purchase(uuid, bigint) from service_role;
-- revoke execute on function public.zell_inv_preview_purchase(uuid, jsonb) from service_role;
-- revoke execute on function public.zell_inv_list_openings(uuid, text, integer, bigint) from service_role;
-- revoke execute on function public.zell_inv_get_opening(uuid, bigint) from service_role;
-- revoke execute on function public.zell_inv_preview_opening(uuid, jsonb) from service_role;
-- revoke execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) from service_role;
-- reset role;
-- commit;
