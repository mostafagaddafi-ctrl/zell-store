-- 0026 IMAGE-DELETE — الرجوع (موافقة جديدة صريحة بس؛ وجود الملف مش تصريح)
--
-- • بيشيل الـ trigger والدالتين والـ policies التلاتة والمنح الزيادة على product_images، وبيرجّع UPDATE (product_id) بالظبط (العقد §٤).
-- • قبل الرجوع: الحالة لازم تطابق بعد 0026 بالنص (المنح والـ policies)، وإلا ZELL_0026_RB_STATE_DRIFT من غير أي تغيير.
--   بعده: المنح والـ policies لازم تطابق خط أساس 0022 بالنص.
-- • مابيلمسش سجلات storage_orphans (السبب removed موجود قبل 0026 من 0012، ومستخدم لأغلفة الأقسام).
-- • الصور اللي اتحذفت قبل الرجوع مابترجعش: الرجوع للدالة، مش للبيانات. بعده حارس التفعيل فحص تطبيق بس زي قبل 0026.
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0026-rollback';

begin;
-- >>> 0026 ROLLBACK
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $rbpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_g text;
  v_p text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0026_RB_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0026_RB_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is null
     or pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard') then
    raise exception 'ZELL_0026_RB_NOT_APPLIED';
  end if;
  v_g := (select pg_catalog.string_agg(t.n || ':S=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'SELECT')), '')
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
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  v_p := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
  if v_g is distinct from 'product_images:S=bucket,id,is_primary,kind,object_path,product_id,sort_order;U=fit,is_primary,updated_at;I=;D=true;G=false | products:S=id,is_active,updated_at;U=updated_at;I=;D=true;G=false | storage_orphans:S=bucket,cleaned_at,id,object_path;U=cleaned_at;I=bucket,object_path,reason;D=false;G=false' or v_p is distinct from 'product_images.zell_catalog_definer_image_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | product_images.zell_catalog_definer_image_promote:UPDATE:PERMISSIVE:zell_catalog_definer:true:(is_primary AND (fit = ''cover''::text) AND (kind = ''gallery''::text)) | product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_insert_removed:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''removed''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    raise exception 'ZELL_0026_RB_STATE_DRIFT' using detail = 'grants: ' || coalesce(v_g, '(null)') || ' || policies: ' || coalesce(v_p, '(null)');
  end if;
end
$rbpre$;

drop trigger zell_catalog_products_activation_guard on public.products;
set local role zell_catalog_definer;
drop function public.zell_product_image_delete(integer, bigint);
drop function public.zell_catalog_trg_products_activation_guard();
reset role;
drop policy zell_catalog_definer_image_delete on public.product_images;
drop policy zell_catalog_definer_image_promote on public.product_images;
drop policy zell_catalog_definer_insert_removed on public.storage_orphans;
revoke select (kind, is_primary, sort_order), update (is_primary, fit, updated_at), delete
  on table public.product_images from zell_catalog_definer;
grant update (product_id) on table public.product_images to zell_catalog_definer;

do $rbpost$
declare
  v_g text := (select pg_catalog.string_agg(t.n || ':S=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'SELECT')), '')
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
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  v_p text := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
begin
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null
     or pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard') then
    raise exception 'ZELL_0026_RB_POST_SHAPE' using detail = 'objects_left';
  end if;
  if v_g is distinct from 'product_images:S=bucket,id,object_path,product_id;U=product_id;I=;D=false;G=false | products:S=id,is_active,updated_at;U=updated_at;I=;D=true;G=false | storage_orphans:S=bucket,cleaned_at,id,object_path;U=cleaned_at;I=bucket,object_path,reason;D=false;G=false' or v_p is distinct from 'product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    raise exception 'ZELL_0026_RB_POST_SHAPE' using detail = 'grants: ' || coalesce(v_g, '(null)') || ' || policies: ' || coalesce(v_p, '(null)');
  end if;
end
$rbpost$;
-- <<< 0026 ROLLBACK
commit;
