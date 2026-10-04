-- =====================================================================
-- 0017 — شكل عرض المنتجات في صفحة القسم
--
--  الحالة: **اتطبّقت على Production** (2026-10-04) قبل أي كود بيقرا العمود.
--  الترتيب: 0016 ← 0017
--
--  عمود واحد: collections.catalog_layout (text, not null, default 'cards').
--    cards   = الشكل الحالي (كروت كبيرة — منتج في الصف على الموبايل)
--    compact = شبكة مدمجة (٢ على الموبايل، ٣ من sm، ٤ من lg)
--  صاحب المتجر بيختاره لكل قسم من اللوحة بعد أول حفظ. الزبون مابيختارش.
--  بيأثر على صفحة /collection/[slug] بس (مش صف القسم في الرئيسية)،
--  وقسم فيه منتج ظاهر واحد بيتعرض كروت كبيرة حتى لو compact.
--
--  ⚠️ إضافة بس. كل الأقسام الحالية بتاخد 'cards' = نفس الشكل بالظبط.
--  ⚠️ مفيش trigger على collections، فـ updated_at مابيتغيّرش = مفيش CONFLICT.
--  ⚠️ zell_create_collection ما اتغيّرتش (بتكتب أعمدة بالاسم → الـ default).
--     ولا zell_create_order ولا الأسعار ولا الطلبات.
--  ⚠️ لازم تتنفّذ قبل نشر الكود — المتجر واللوحة بيقروا العمود صراحة.
--  ⚠️ لازم تتنفّذ بدور postgres.
--
--  التحقق اللي اتعمل على Production بعد التطبيق:
--    - البصمة قبل = بعد: 3 أقسام بنفس (id, updated_at)، و6 روابط
--      product_collections بنفس الـ md5، و6 منتجات، وأوردر واحد.
--    - كل الأقسام catalog_layout = 'cards'.
--    - update بقيمة 'grid' اترفض بـ collections_catalog_layout_check جوه
--      DO block بيرمي exception → اترجع بالكامل.
--    - service_role: select/update ✓ · anon/authenticated: مفيش.
-- =====================================================================

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0017_WRONG_ROLE: current_user=%', current_user;
  end if;
end
$guard$;

set local lock_timeout = '5s';

alter table public.collections
  add column catalog_layout text not null default 'cards';

alter table public.collections
  add constraint collections_catalog_layout_check
  check (catalog_layout in ('cards', 'compact'));

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collections'
      and column_name = 'catalog_layout' and is_nullable = 'NO' and data_type = 'text'
  ) then
    raise exception 'ZELL_MIGRATION_0017_COLUMN_MISSING';
  end if;

  if exists (select 1 from public.collections where catalog_layout <> 'cards') then
    raise exception 'ZELL_MIGRATION_0017_UNEXPECTED_VALUES';
  end if;

  if not pg_catalog.has_column_privilege('service_role', 'public.collections', 'catalog_layout', 'select')
     or not pg_catalog.has_column_privilege('service_role', 'public.collections', 'catalog_layout', 'update') then
    raise exception 'ZELL_MIGRATION_0017_SERVICE_ROLE_PRIVILEGES';
  end if;

  if pg_catalog.has_column_privilege('anon', 'public.collections', 'catalog_layout', 'select')
     or pg_catalog.has_column_privilege('authenticated', 'public.collections', 'catalog_layout', 'select') then
    raise exception 'ZELL_MIGRATION_0017_PUBLIC_ROLE_CAN_READ';
  end if;
end
$verify$;

commit;
