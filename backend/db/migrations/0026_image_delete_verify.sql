-- 0026 IMAGE-DELETE — التحقق بعد التطبيق (قراية كتالوج بس) لـ 0026_image_delete.sql
--
-- • معاملة واحدة read only: begin ... SELECT واحد ... rollback. قبل التطبيق النتيجة FAIL (الدوال مش موجودة).
-- • الصف 0 = الحكم (PASS/FAIL) وعدد النجاح والفشل، وبعده صف لكل فحص.
-- • المتوقع بعد التطبيق: PASS بـ 9 نجاح و 0 فشل.

begin;
set transaction read only;

with f as (
  select pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') as del,
         pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') as trg,
         (select a.attnum from pg_catalog.pg_attribute a
           where a.attrelid = 'public.products'::regclass and a.attname = 'is_active') as att
), c(n, id, ok, detail) as (
  select 1, 'V01', coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef
                               and p.proconfig = array['search_path=""', 'lock_timeout=3s']
                              from pg_catalog.pg_proc p, f where p.oid = f.del), false),
         'zell_product_image_delete: owner zell_catalog_definer, security definer, search_path empty, lock_timeout 3s'
  union all
  select 2, 'V02', coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef
                               and p.proconfig = array['search_path=""']
                              from pg_catalog.pg_proc p, f where p.oid = f.trg), false),
         'zell_catalog_trg_products_activation_guard: owner zell_catalog_definer, security definer, search_path empty'
  union all
  select 3, 'V03', coalesce((select f.del is not null and f.trg is not null
                               and pg_catalog.has_function_privilege('authenticated', f.del, 'EXECUTE')
                               and not pg_catalog.has_function_privilege('anon', f.del, 'EXECUTE')
                               and not pg_catalog.has_function_privilege('service_role', f.del, 'EXECUTE')
                               and not pg_catalog.has_function_privilege('anon', f.trg, 'EXECUTE')
                               and not pg_catalog.has_function_privilege('authenticated', f.trg, 'EXECUTE')
                               and not pg_catalog.has_function_privilege('service_role', f.trg, 'EXECUTE')
                               and not exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                                                where p.oid in (f.del, f.trg) and (a.grantee = 0 or a.is_grantable))
                               and (select pg_catalog.count(*) from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                                     where p.oid = f.del and a.grantee <> p.proowner) = 1
                              from f), false),
         'EXECUTE exact: authenticated on the delete function only, nothing on the trigger function, no PUBLIC, no grant option'
  union all
  select 4, 'V04', coalesce((select exists (select 1 from pg_catalog.pg_trigger t
                               where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'
                                 and t.tgenabled = 'O' and t.tgfoid = f.trg and t.tgtype = 23
                                 and t.tgattr::text = f.att::text) from f), false),
         'trigger zell_catalog_products_activation_guard: before insert or update of is_active, for each row, enabled'
  union all
  select 5, 'V05', (select pg_catalog.count(*) from pg_catalog.pg_policies p
                     where p.schemaname = 'public' and p.roles = array['zell_catalog_definer']::name[]
                       and ((p.tablename = 'product_images' and p.policyname = 'zell_catalog_definer_image_delete'
                             and p.cmd = 'DELETE' and p.qual = 'true' and p.with_check is null)
                         or (p.tablename = 'product_images' and p.policyname = 'zell_catalog_definer_image_promote'
                             and p.cmd = 'UPDATE' and p.qual = 'true' and p.with_check like '%is_primary%'
                             and p.with_check like '%cover%' and p.with_check like '%gallery%')
                         or (p.tablename = 'storage_orphans' and p.policyname = 'zell_catalog_definer_insert_removed'
                             and p.cmd = 'INSERT' and p.qual is null and p.with_check like '%removed%'
                             and p.with_check like '%cleaned_at IS NULL%'))) = 3,
         'policies: image_delete (DELETE) · image_promote (UPDATE, primary cover gallery) · insert_removed (INSERT, removed)'
  union all
  select 6, 'V06', pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'DELETE')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'kind', 'SELECT')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'is_primary', 'SELECT')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'sort_order', 'SELECT')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'is_primary', 'UPDATE')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'fit', 'UPDATE')
                    and pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'updated_at', 'UPDATE')
                    and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'kind', 'UPDATE')
                    and not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'object_path', 'UPDATE')
                    and not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'INSERT'),
         'zell_catalog_definer on product_images: DELETE + SELECT (kind, is_primary, sort_order) + UPDATE (is_primary, fit, updated_at) only'
  union all
  select 7, 'V07', not pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE')
                    and exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer'
                                 and not (r.rolcanlogin or r.rolbypassrls or r.rolinherit or r.rolsuper)),
         'zell_catalog_definer: no CREATE on schema public, NOLOGIN NOBYPASSRLS NOINHERIT'
  union all
  select 8, 'V08', (select pg_catalog.pg_get_constraintdef(k.oid) from pg_catalog.pg_constraint k
                     where k.conrelid = 'public.storage_orphans'::regclass and k.conname = 'storage_orphans_reason_check')
                   = 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))',
         'storage_orphans_reason_check unchanged'
  union all
  select 9, 'V09', (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.prosrc ~ '4570[1-5]') = 2,
         'codes 45701..45705 used by the two new functions only'
)
select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where not coalesce(c.ok, false)) = 0 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where coalesce(c.ok, false)) || ' fail=' || pg_catalog.count(*) filter (where not coalesce(c.ok, false)) as detail
          from c
        union all
        select c.n, c.id, case when coalesce(c.ok, false) then 'pass' else 'fail' end, c.detail from c) s
 order by s.n;
rollback;
