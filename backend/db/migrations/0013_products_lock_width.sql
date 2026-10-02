-- =====================================================================
-- 0013 — تثبيت العرض لكل منتج
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الترتيب: 0012 ← 0013
--
--  عمود واحد: products.lock_width (boolean, not null, default false).
--  true = في صفحة المنتج، خانة «عرض الشباك» بتظهر مقفولة على عرض الرول،
--  والزبون بيكتب الارتفاع بس (شريحة واحدة). اختيار الطول بالمتر زي ما هو.
--
--  ⚠️ عرض بس. zell_create_order **مابتتلمسش**: بتاخد productId و lengthCm
--     وبتتحقق من min/step/max وبتحسب السعر بنفسها زي ما هي.
--  ⚠️ إضافة بس، idempotent. كل المنتجات الحالية بتبدأ false = نفس السلوك.
--  ⚠️ لازم تتنفّذ قبل دمج الكود — المتجر واللوحة بيقروا العمود.
--  ⚠️ لازم تتنفّذ بدور postgres.
-- =====================================================================

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0013_WRONG_ROLE: current_user=%', current_user;
  end if;
end
$guard$;

alter table public.products
  add column if not exists lock_width boolean not null default false;

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products'
      and column_name = 'lock_width' and is_nullable = 'NO' and data_type = 'boolean'
  ) then
    raise exception 'ZELL_MIGRATION_0013_COLUMN_MISSING';
  end if;

  if not pg_catalog.has_column_privilege('service_role', 'public.products', 'lock_width', 'select')
     or not pg_catalog.has_column_privilege('service_role', 'public.products', 'lock_width', 'update') then
    raise exception 'ZELL_MIGRATION_0013_SERVICE_ROLE_PRIVILEGES';
  end if;

  if pg_catalog.has_column_privilege('anon', 'public.products', 'lock_width', 'select')
     or pg_catalog.has_column_privilege('authenticated', 'public.products', 'lock_width', 'select') then
    raise exception 'ZELL_MIGRATION_0013_PUBLIC_SELECT';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;

-- التراجع (للمرجع):
--   begin;
--     alter table public.products drop column if exists lock_width;
--     notify pgrst, 'reload schema';
--   commit;
