-- 0022 PRODUCT-DELETE — التحقق بعد التطبيق (قراءة بس) لـ 0022_product_delete.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • بيشتغل في أي وقت بعد التطبيق (قبل أو بعد أي حذف).
-- • V09 و V10 مقارنة بالحرف: كل صلاحية للدور zell_catalog_definer في الداتابيز كلها (جداول · أعمدة · sequences · schemas ·
--   دوال)، وكل policy بتنطبق عليه (باسمه أو PUBLIC على جداوله) بتعبيرات USING / WITH CHECK. أي زيادة أو نقص = FAIL.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (10 فحوص).

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
), cat as (
  select pg_catalog.to_regrole('zell_catalog_definer')::oid as r
), priv as (
  select 'rel:' || n.nspname || '.' || c.relname || ':' || a.privilege_type || case when a.is_grantable then '*' else '' end as x
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl) a
   where a.grantee = (select r from cat)
  union all
  select 'col:' || n.nspname || '.' || c.relname || '.' || t.attname || ':' || a.privilege_type || case when a.is_grantable then '*' else '' end
    from pg_catalog.pg_attribute t join pg_catalog.pg_class c on c.oid = t.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(t.attacl) a
   where a.grantee = (select r from cat) and t.attnum > 0 and not t.attisdropped
  union all
  select 'schema:' || n.nspname || ':' || a.privilege_type || case when a.is_grantable then '*' else '' end
    from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a
   where a.grantee = (select r from cat)
  union all
  select 'fn:' || n.nspname || '.' || p.proname || ':' || a.privilege_type || case when a.is_grantable then '*' else '' end
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(p.proacl) a
   where a.grantee = (select r from cat)
  union all
  select 'type:' || t.typname || ':' || a.privilege_type
    from pg_catalog.pg_type t cross join lateral pg_catalog.aclexplode(t.typacl) a
   where a.grantee = (select r from cat)
  union all
  select 'db:' || d.datname || ':' || a.privilege_type
    from pg_catalog.pg_database d cross join lateral pg_catalog.aclexplode(d.datacl) a
   where a.grantee = (select r from cat)
  union all
  select 'default_acl:' || d.defaclobjtype::text from pg_catalog.pg_default_acl d where d.defaclrole = (select r from cat)
  union all
  select 'default_acl_grant:' || d.defaclobjtype::text
    from pg_catalog.pg_default_acl d cross join lateral pg_catalog.aclexplode(d.defaclacl) a
   where a.grantee = (select r from cat)
), pol as (
  select c.relname::text || '|' || p.polname::text || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|'
         || (select pg_catalog.string_agg(case when x = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x)::text end, ',' order by 1)
               from pg_catalog.unnest(p.polroles) x) || '|'
         || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '-') || '|'
         || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '-') as x
    from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
   where (select r from cat) = any (p.polroles)
      or (0::oid = any (p.polroles)
          and p.polrelid in ('public.products'::regclass, 'public.product_images'::regclass, 'public.product_widths'::regclass,
                             'public.product_addons'::regclass, 'public.product_collections'::regclass, 'public.order_items'::regclass,
                             'public.settings'::regclass, 'public.storage_orphans'::regclass))
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
  select 'V03', 'EXECUTE exactly: delete/preview {owner, authenticated} · guard {owner} · wrapper {owner, zell_catalog_definer} · helper {postgres, zell_inventory_definer}',
         (select grantees from fn where proname = 'zell_product_delete') = array['authenticated', 'zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_product_delete_preview') = array['authenticated', 'zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_catalog_trg_home_products_guard') = array['zell_catalog_definer']
         and (select grantees from fn where proname = 'zell_inv_product_stock_ref_exists') = array['zell_catalog_definer', 'zell_inventory_definer']
         and (select grantees from fn where proname = 'zell_inv_product_has_stock_refs') = array['postgres', 'zell_inventory_definer']
         and not exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                          where p.oid in (select oid from fn) and (a.privilege_type <> 'EXECUTE' or a.is_grantable)),
         (select string_agg(proname || '=' || coalesce(array_to_string(grantees, '+'), '-'), ' ' order by proname) from fn)
  union all
  select 'V04', 'policies: 17 zell_catalog_definer_* (any table), all for that role only',
         (select count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%') = 17
         and not exists (select 1 from pg_catalog.pg_policies p
                          where p.policyname like 'zell\_catalog\_definer\_%' and p.roles <> array['zell_catalog_definer']::name[]),
         (select 'found=' || count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%')
  union all
  select 'V05', 'effective access (has_*_privilege): no name/price read, no is_active write, nothing on orders / collections',
         pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'id', 'SELECT')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'name_ar', 'SELECT')
         and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'is_active', 'UPDATE')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.products', 'SELECT,INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
         and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
         and not pg_catalog.has_any_column_privilege('zell_catalog_definer', 'public.orders', 'SELECT,INSERT,UPDATE')
         and not pg_catalog.has_any_column_privilege('zell_catalog_definer', 'public.collections', 'SELECT,INSERT,UPDATE'),
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
  union all
  select 'V09', 'exact privilege table of zell_catalog_definer (tables · columns · sequences · schemas · functions · types · databases · default ACLs)',
         coalesce((select pg_catalog.string_agg(x, ' ; ' order by x collate "C") from priv), '') = 'col:public.order_items.product_id:SELECT ; col:public.product_addons.addon_id:SELECT ; col:public.product_addons.product_id:SELECT ; col:public.product_addons.product_id:UPDATE ; col:public.product_collections.product_id:SELECT ; col:public.product_collections.product_id:UPDATE ; col:public.product_images.bucket:SELECT ; col:public.product_images.id:SELECT ; col:public.product_images.object_path:SELECT ; col:public.product_images.product_id:SELECT ; col:public.product_images.product_id:UPDATE ; col:public.product_widths.product_id:SELECT ; col:public.product_widths.product_id:UPDATE ; col:public.products.id:SELECT ; col:public.products.is_active:SELECT ; col:public.products.updated_at:SELECT ; col:public.products.updated_at:UPDATE ; col:public.settings.key:SELECT ; col:public.settings.updated_at:SELECT ; col:public.settings.updated_at:UPDATE ; col:public.settings.value:SELECT ; col:public.settings.value:UPDATE ; col:public.storage_orphans.bucket:INSERT ; col:public.storage_orphans.bucket:SELECT ; col:public.storage_orphans.cleaned_at:SELECT ; col:public.storage_orphans.cleaned_at:UPDATE ; col:public.storage_orphans.id:SELECT ; col:public.storage_orphans.object_path:INSERT ; col:public.storage_orphans.object_path:SELECT ; col:public.storage_orphans.reason:INSERT ; fn:public.zell_catalog_trg_home_products_guard:EXECUTE ; fn:public.zell_inv_product_stock_ref_exists:EXECUTE ; fn:public.zell_order_actor:EXECUTE ; fn:public.zell_order_admin_role:EXECUTE ; fn:public.zell_order_claims_actor:EXECUTE ; fn:public.zell_product_delete:EXECUTE ; fn:public.zell_product_delete_preview:EXECUTE ; rel:public.products:DELETE ; rel:public.storage_orphans_id_seq:USAGE ; schema:public:USAGE',
         coalesce((select pg_catalog.string_agg(x, ' ; ' order by x collate "C") from priv), '')
  union all
  select 'V10', 'exact policies that apply to zell_catalog_definer (by name or PUBLIC on its tables): command, permissive, roles, USING, WITH CHECK',
         coalesce((select pg_catalog.string_agg(x, ' ; ' order by x collate "C") from pol), '') = 'order_items|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; product_addons|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; product_addons|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; product_collections|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; product_collections|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; product_images|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; product_images|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; product_widths|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; product_widths|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; products|zell_catalog_definer_delete|d|true|zell_catalog_definer|true|- ; products|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; products|zell_catalog_definer_select|r|true|zell_catalog_definer|true|- ; settings|zell_catalog_definer_select|r|true|zell_catalog_definer|(key = ''home_products''::text)|- ; settings|zell_catalog_definer_update|w|true|zell_catalog_definer|(key = ''home_products''::text)|(key = ''home_products''::text) ; storage_orphans|zell_catalog_definer_insert|a|true|zell_catalog_definer|-|((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) ; storage_orphans|zell_catalog_definer_lock|w|true|zell_catalog_definer|true|false ; storage_orphans|zell_catalog_definer_select|r|true|zell_catalog_definer|true|-',
         coalesce((select pg_catalog.string_agg(x, ' ; ' order by x collate "C") from pol), '')
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 10 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
