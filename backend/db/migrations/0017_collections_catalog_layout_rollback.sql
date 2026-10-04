-- =====================================================================
-- 0017 rollback — شيل collections.catalog_layout
--
--  ⚠️⚠️ ماتنفّذهوش والكود اللي بيقرا العمود منشور — المتجر هيقع
--       (طبقة القراءة بتطلب catalog_layout صراحة، والفشل صريح).
--  الترتيب الصح للرجوع:
--    ١. revert كود الـ PR ونشر zell-store و admin.
--    ٢. اتأكد إن النشرتين شغالين.
--    ٣. بعد كده بس نفّذ الملف ده (اختياري — العمود من غير استخدام مابيضرّش).
--
--  مفيش دالة اتغيّرت في 0017، فمفيش تعريف قديم يترجع.
--  ⚠️ لازم يتنفّذ بدور postgres.
-- =====================================================================

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_ROLLBACK_0017_WRONG_ROLE: current_user=%', current_user;
  end if;
end
$guard$;

set local lock_timeout = '5s';

alter table public.collections drop constraint if exists collections_catalog_layout_check;
alter table public.collections drop column if exists catalog_layout;

commit;
