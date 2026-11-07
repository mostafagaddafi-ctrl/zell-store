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
  select 5, 'V05', (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
                   || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
                 ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
               from pg_catalog.pg_policies p
              where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
                and p.roles && array['zell_catalog_definer', 'public']::name[]) = 'product_images.zell_catalog_definer_image_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | product_images.zell_catalog_definer_image_promote:UPDATE:PERMISSIVE:zell_catalog_definer:true:(is_primary AND (fit = ''cover''::text) AND (kind = ''gallery''::text)) | product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_insert_removed:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''removed''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-',
         'policies of zell_catalog_definer (and PUBLIC) on product_images / products / storage_orphans = expected text exactly'
  union all
  select 6, 'V06', (select pg_catalog.string_agg(t.n || ':S=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'SELECT')), '')
                 || ';U=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'UPDATE')), '')
                 || ';I=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'INSERT')), '')
                 || ';D=' || pg_catalog.has_table_privilege('zell_catalog_definer', t.o, 'DELETE')::text
                 || ';G=' || (exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                                       where c.oid = t.o and x.grantee = 'zell_catalog_definer'::regrole and x.is_grantable)
                              or exists (select 1 from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
                                          where a.attrelid = t.o and x.grantee = 'zell_catalog_definer'::regrole and x.is_grantable))::text,
                 ' | ' order by t.n collate "C")
               from (values ('product_images'::text, 'public.product_images'::regclass::oid),
                            ('products'::text, 'public.products'::regclass::oid),
                            ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o)) = 'product_images:S=bucket,id,is_primary,kind,object_path,product_id,sort_order;U=fit,is_primary,updated_at;I=;D=true;G=false | products:S=id,is_active,updated_at;U=updated_at;I=;D=true;G=false | storage_orphans:S=bucket,cleaned_at,id,object_path;U=cleaned_at;I=bucket,object_path,reason;D=false;G=false',
         'zell_catalog_definer column grants on product_images / products / storage_orphans = expected exactly, no grant option'
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
