-- 0026 IMAGE-DELETE — استعلام الأثر (قبل التطبيق وبعده، نفس الملف بالحرف). قراية بس.
--
-- • معاملة read only: begin ... SELECT واحد ... rollback. صف واحد بـ 15 عمود:
--   1 applied (دالة الحذف|الـ trigger) · 2 عدد صور المنتجات · 3 عدد الرئيسيات · 4 المنتجات الظاهرة ·
--   5 المنتجات الظاهرة من غير رئيسية من المعرض · 6 سجلات storage_orphans لكل سبب · 7 السجلات المستنية تنظيف ·
--   8 بصمة product_images · 9 بصمة storage_orphans · 10 بصمة ظهور المنتجات ·
--   11 منح zell_catalog_definer على الجداول التلاتة (كل عمود SELECT/UPDATE/INSERT · DELETE · grant option) ·
--   12 كل policies الجداول التلاتة اللي بتنطبق على الدور (أو PUBLIC) بالنص الكامل · 13 idle_tx (NULL لو الجلسات مش ظاهرة) ·
--   14 الجلسات ظاهرة · 15 ACL دالة الحذف ('-' لو مش موجودة).
-- • قبل التطبيق وبعده: الأعمدة 2–10 لازم تبقى زي ما هي (التطبيق مابيغيّرش بيانات).

begin;
set transaction read only;

select
  (pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null)::text || '|'
    || (exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'))::text as applied,
  (select pg_catalog.count(*) from public.product_images) as images,
  (select pg_catalog.count(*) from public.product_images where is_primary) as primaries,
  (select pg_catalog.count(*) from public.products where is_active) as products_active,
  (select pg_catalog.count(*) from public.products p
    where p.is_active
      and not exists (select 1 from public.product_images i
                       where i.product_id = p.id and i.kind = 'gallery' and i.is_primary)) as active_without_primary,
  coalesce((select pg_catalog.string_agg(x.reason || '=' || x.n, ',' order by x.reason)
              from (select o.reason, pg_catalog.count(*) as n from public.storage_orphans o group by o.reason) x), '') as orphans_by_reason,
  (select pg_catalog.count(*) from public.storage_orphans where cleaned_at is null) as orphans_pending,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.product_images t) as fp_images,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t) as fp_orphans,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t.id::text || ':' || t.is_active::text, ',' order by t.id), '')) from public.products t) as fp_visibility,
  (select pg_catalog.string_agg(t.n || ':S=' || coalesce((select pg_catalog.string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_catalog.pg_attribute a where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege('zell_catalog_definer', t.o, a.attnum, 'SELECT')), '')
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
                    ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o)) as definer_grants,
  coalesce((select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
           || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
         ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
       from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
        and p.roles && array['zell_catalog_definer', 'public']::name[]), '') as definer_policies,
  case when not exists (select 1 from pg_catalog.pg_stat_activity a
                         where a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid() and a.state is null)
       then (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a
              where a.pid <> pg_catalog.pg_backend_pid() and a.state like 'idle in transaction%')
  end as idle_tx,
  not exists (select 1 from pg_catalog.pg_stat_activity a
               where a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid() and a.state is null) as sessions_visible,
  coalesce((select p.proacl::text from pg_catalog.pg_proc p
             where p.oid = pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)')), '-') as delete_acl;
rollback;
