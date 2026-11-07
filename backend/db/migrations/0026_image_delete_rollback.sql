-- 0026 IMAGE-DELETE — الرجوع (موافقة جديدة صريحة بس؛ وجود الملف مش تصريح)
--
-- • بيشيل الـ trigger والدالتين والـ policies التلاتة والمنح الزيادة على product_images بس (العقد §٤).
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
                     where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard')
     or (select pg_catalog.count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public'
            and p.policyname in ('zell_catalog_definer_image_delete', 'zell_catalog_definer_image_promote',
                                 'zell_catalog_definer_insert_removed')) <> 3 then
    raise exception 'ZELL_0026_RB_NOT_APPLIED';
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

do $rbpost$
begin
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null
     or pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard')
     or exists (select 1 from pg_catalog.pg_policies p
                 where p.schemaname = 'public'
                   and p.policyname in ('zell_catalog_definer_image_delete', 'zell_catalog_definer_image_promote',
                                        'zell_catalog_definer_insert_removed'))
     or pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'DELETE')
     or pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'kind', 'SELECT')
     or pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'is_primary', 'UPDATE')
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'product_id', 'UPDATE')
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'object_path', 'SELECT')
     or not exists (select 1 from pg_catalog.pg_policies p
                     where p.schemaname = 'public' and p.tablename = 'product_images' and p.policyname = 'zell_catalog_definer_lock') then
    raise exception 'ZELL_0026_RB_POST_SHAPE';
  end if;
end
$rbpost$;
-- <<< 0026 ROLLBACK
commit;
