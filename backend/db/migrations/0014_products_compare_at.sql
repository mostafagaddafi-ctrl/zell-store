-- 0014 — السعر قبل الخصم (عرض بس)
--
-- الزبون بيدفع price_per_meter_piastres دايمًا. compare_at_piastres بيظهر
-- مشطوب جنب السعر ونسبة الخصم بتتحسب منه — zell_create_order ما اتغيّرتش.
--
-- إضافة فقط: عمود فاضي، والقيد بيضمن إن السعر القديم أكبر من الحالي.
-- اتطبّقت على Production قبل نشر الكود (المتجر بيقرا العمود ده).

alter table public.products
  add column if not exists compare_at_piastres integer;

alter table public.products
  add constraint products_compare_at_check
  check (
    compare_at_piastres is null
    or (compare_at_piastres > 0 and compare_at_piastres > price_per_meter_piastres)
  );

-- تراجع:
--   alter table public.products drop constraint products_compare_at_check;
--   alter table public.products drop column compare_at_piastres;
