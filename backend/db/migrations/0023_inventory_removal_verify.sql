-- 0023 INVENTORY-REMOVAL — التحقق بعد التطبيق (قراءة بس) لـ 0023_inventory_removal.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • فحوص المخزون القديمة (0020 · 0020-S) وأجزاء verify 0022 الخاصة بدالة المخزون بتفضل تاريخية ومابتتعدّلش؛ دي بتفحص الشكل الجديد بس.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (4 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with checks(id, name, ok, detail) as (
  select 'V01', 'inventory gone: role · 10 tables · 4 sequences · zell_inv_* · zinv policies · products trigger', pg_catalog.to_regrole('zell_inventory_definer') is null
      and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
      and not exists (select 1 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
      and not exists (select 1 from pg_catalog.pg_policies p where p.schemaname = 'public' and p.policyname like 'zinv\_%')
      and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.products'::regclass and t.tgname like 'zinv%'), null::text
  union all
  select 'V02', 'product delete functions: md5 84b80a92 / 39cf41ed · owner zell_catalog_definer · security definer · config · EXECUTE authenticated only', coalesce((select pg_catalog.md5(p.prosrc) = '84b80a92c3c413433a71d80300bd5418' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef and p.provolatile = 'v'
              and pg_catalog.cardinality(p.proconfig) = 2 and 'search_path=""' = any(p.proconfig) and 'lock_timeout=3s' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)'))
      and (select pg_catalog.md5(p.prosrc) = '39cf41edb6e8a5fcee5ea9e35081a0b5' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef and p.provolatile = 's'
              and pg_catalog.cardinality(p.proconfig) = 1 and 'search_path=""' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)'))
      and pg_catalog.has_function_privilege('authenticated', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', 'public.zell_product_delete_preview(integer)', 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE') and not pg_catalog.has_function_privilege('anon', 'public.zell_product_delete_preview(integer)', 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE') and not pg_catalog.has_function_privilege('service_role', 'public.zell_product_delete_preview(integer)', 'EXECUTE'), false), null
  union all
  select 'V03', 'no function in public references an inventory table, and no function in any schema calls a zell_inv_* name', not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\m(inventory_locations|suppliers|purchase_docs|purchase_doc_lines|purchase_doc_charges|opening_stock_docs|opening_stock_lines|stock_lots|inventory_commands|inventory_audit_log)\M')
      and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) and p.prosrc ~* '\mzell_inv_'), null
  union all
  select 'V04', 'no leftover grants to the removed role (shared dependencies on a missing role)',
         not exists (select 1 from pg_catalog.pg_shdepend d where d.refclassid = 'pg_catalog.pg_authid'::regclass
                      and not exists (select 1 from pg_catalog.pg_roles r where r.oid = d.refobjid)), null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select pg_catalog.count(*) from checks) = 4 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
