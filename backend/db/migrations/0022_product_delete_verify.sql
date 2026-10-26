-- 0022 PRODUCT-DELETE — التحقق بعد التطبيق (قراءة بس) لـ 0022_product_delete.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • بيشتغل في أي وقت بعد التطبيق (قبل أو بعد أي حذف).
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (8 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn as (
  select p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner,
         (select array_agg(distinct pg_catalog.pg_get_userbyid(a.grantee)::text order by pg_catalog.pg_get_userbyid(a.grantee)::text)
            from pg_catalog.aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE') as grantees
    from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamptz)'),
                   pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)'),
                   pg_catalog.to_regprocedure('public.zell_catalog_trg_home_products_guard()'),
                   pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)'),
                   pg_catalog.to_regprocedure('public.zell_inv_product_has_stock_refs(integer)'))
), pol(tbl, name, cmd) as (
  values ('products', 'zell_catalog_definer_select', 'SELECT'), ('products', 'zell_catalog_definer_lock', 'UPDATE'),
         ('products', 'zell_catalog_definer_delete', 'DELETE'),
         ('product_images', 'zell_catalog_definer_select', 'SELECT'), ('product_images', 'zell_catalog_definer_lock', 'UPDATE'),
         ('product_widths', 'zell_catalog_definer_select', 'SELECT'), ('product_widths', 'zell_catalog_definer_lock', 'UPDATE'),
         ('product_addons', 'zell_catalog_definer_select', 'SELECT'), ('product_addons', 'zell_catalog_definer_lock', 'UPDATE'),
         ('product_collections', 'zell_catalog_definer_select', 'SELECT'), ('product_collections', 'zell_catalog_definer_lock', 'UPDATE'),
         ('order_items', 'zell_catalog_definer_select', 'SELECT'),
         ('settings', 'zell_catalog_definer_select', 'SELECT'), ('settings', 'zell_catalog_definer_update', 'UPDATE'),
         ('storage_orphans', 'zell_catalog_definer_select', 'SELECT'), ('storage_orphans', 'zell_catalog_definer_lock', 'UPDATE'),
         ('storage_orphans', 'zell_catalog_definer_insert', 'INSERT')
), checks(id, name, ok, detail) as (
  select 'V01', 'role zell_catalog_definer: NOLOGIN NOINHERIT NOBYPASSRLS, member of nothing, postgres membership SET only',
         exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer'
                    and not r.rolcanlogin and not r.rolinherit and not r.rolbypassrls and not r.rolsuper
                    and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication)
         and exists (select 1 from pg_catalog.pg_auth_members m
                      where m.roleid = pg_catalog.to_regrole('zell_catalog_definer') and m.member = 'postgres'::regrole and m.set_option)
         and not exists (select 1 from pg_catalog.pg_auth_members m
                          where m.roleid = pg_catalog.to_regrole('zell_catalog_definer')
                            and (m.inherit_option or m.member <> 'postgres'::regrole))
         and not exists (select 1 from pg_catalog.pg_auth_members m where m.member = pg_catalog.to_regrole('zell_catalog_definer')),
         null
  union all
  select 'V02', 'functions: owners, SECURITY DEFINER, volatility, search_path = '''' (+ lock_timeout 3s on delete)',
         (select count(*) from fn) = 5
         and exists (select 1 from fn where proname = 'zell_product_delete' and owner = 'zell_catalog_definer' and prosecdef
                        and provolatile = 'v' and proconfig = array['search_path=""', 'lock_timeout=3s'])
         and exists (select 1 from fn where proname = 'zell_product_delete_preview' and owner = 'zell_catalog_definer' and prosecdef
                        and provolatile = 's' and proconfig = array['search_path=""'])
         and exists (select 1 from fn where proname = 'zell_catalog_trg_home_products_guard' and owner = 'zell_catalog_definer'
                        and prosecdef and proconfig = array['search_path=""'])
         and exists (select 1 from fn where proname = 'zell_inv_product_stock_ref_exists' and owner = 'zell_inventory_definer'
                        and prosecdef and provolatile = 's' and proconfig = array['search_path=""'])
         and exists (select 1 from fn where proname = 'zell_inv_product_has_stock_refs' and owner = 'postgres' and not prosecdef),
         (select string_agg(proname || ':' || owner, ',' order by proname) from fn)
  union all
  select 'V03', 'EXECUTE exactly: delete/preview {owner, authenticated} · guard {owner} · wrapper {owner, zell_catalog_definer} · helper {postgres, zell_inventory_definer} · identity to zell_catalog_definer',
         (select grantees from fn where proname = 'zell_product_delete') = array['authenticated', 'zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_product_delete_preview') = array['authenticated', 'zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_catalog_trg_home_products_guard') = array['zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_inv_product_stock_ref_exists') = array['zell_catalog_definer', 'zell_inventory_definer']
         and (select grantees from fn where proname = 'zell_inv_product_has_stock_refs') = array['postgres', 'zell_inventory_definer']
         and pg_catalog.has_function_privilege('zell_catalog_definer', 'public.zell_order_actor(boolean)', 'EXECUTE')
         and pg_catalog.has_function_privilege('zell_catalog_definer', 'public.zell_order_claims_actor()', 'EXECUTE')
         and pg_catalog.has_function_privilege('zell_catalog_definer', 'public.zell_order_admin_role(uuid)', 'EXECUTE'),
         (select string_agg(proname || '=' || coalesce(array_to_string(grantees, '+'), '-'), ' ' order by proname) from fn)
  union all
  select 'V04', 'policies: exactly the 17 zell_catalog_definer_* (table, name, command), role zell_catalog_definer only',
         (select count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%') = 17
         and (select count(*) from pol
               join pg_catalog.pg_policies p
                 on p.schemaname = 'public' and p.tablename = pol.tbl and p.policyname = pol.name and p.cmd = pol.cmd
                and p.roles = array['zell_catalog_definer']::name[]) = 17,
         (select 'found=' || count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%')
  union all
  select 'V05', 'least privilege: column grants only (no name/price read, no is_active write), nothing on orders, no insert/delete outside the contract',
         pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'id', 'SELECT')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'name_ar', 'SELECT')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'is_active', 'UPDATE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.products', 'SELECT,INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
         and pg_catalog.has_table_privilege('zell_catalog_definer', 'public.products', 'DELETE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.order_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.order_items', 'order_id', 'SELECT')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.settings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.settings', 'key', 'UPDATE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.storage_orphans', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.storage_orphans', 'reason', 'UPDATE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_any_column_privilege('zell_catalog_definer', 'public.orders', 'SELECT,INSERT,UPDATE')
         and pg_catalog.has_sequence_privilege('zell_catalog_definer', 'public.storage_orphans_id_seq', 'USAGE')
         and not pg_catalog.has_sequence_privilege('zell_catalog_definer', 'public.storage_orphans_id_seq', 'UPDATE'),
         null
  union all
  select 'V06', 'trigger zell_catalog_home_products_guard: BEFORE INSERT OR UPDATE OF value, FOR EACH ROW, WHEN key = home_products, enabled',
         exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.settings'::regclass and t.tgname = 'zell_catalog_home_products_guard'
                    and t.tgenabled = 'O' and not t.tgisinternal
                    and t.tgfoid = pg_catalog.to_regprocedure('public.zell_catalog_trg_home_products_guard()')
                    and pg_catalog.pg_get_triggerdef(t.oid) ~ '^CREATE TRIGGER zell_catalog_home_products_guard BEFORE INSERT OR UPDATE OF value ON public\.settings FOR EACH ROW WHEN \(\(new\.key = ''home_products''::text\)\) EXECUTE FUNCTION (public\.)?zell_catalog_trg_home_products_guard\(\)$'),
         (select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t
           where t.tgrelid = 'public.settings'::regclass and t.tgname = 'zell_catalog_home_products_guard')
  union all
  select 'V07', 'storage_orphans_reason_check = old reasons + product_deleted (same name)',
         (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
           where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')
         = 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))',
         (select 'product_deleted rows=' || count(*) from public.storage_orphans o where o.reason = 'product_deleted')
  union all
  select 'V08', 'others intact: 45501..45508 only in the 3 new functions, no CREATE on public for zell_catalog_definer / zell_inventory_definer',
         coalesce((select pg_catalog.string_agg(p.proname, ',' order by p.proname) from pg_catalog.pg_proc p where p.prosrc ~ '4550[1-8]'), '')
           = 'zell_catalog_trg_home_products_guard,zell_product_delete,zell_product_delete_preview'
         and not pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE')
         and not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE'),
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 8 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
