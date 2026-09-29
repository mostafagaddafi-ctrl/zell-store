-- =====================================================================
-- 0004_harden_default_privileges.sql
-- الحالة: مقترحة — لم تُنفّذ. للمراجعة.
--
-- السبب (مكتشف في 0002_verification.md):
--   Supabase بيضبط DEFAULT PRIVILEGES في schema public بحيث أي **جدول أو sequence
--   أو دالة جديدة** بتتمنح تلقائياً لـ anon و authenticated:
--       tables    → anon=arwdDxtm, authenticated=arwdDxtm
--       sequences → anon=rwU,      authenticated=rwU
--       functions → anon=X,        authenticated=X
--   يعني 0002 بيأمّن الجداول الموجودة بس، وأي جدول جديد بيرجع مكشوف.
--   كمان صلاحية USAGE على الـ sequences الحالية لسه قائمة وبتسرّب عدّاد الطلبات
--   (select last_value) حتى مع قفل الجداول.
--
-- ⚠ ملاحظة قبل التنفيذ:
--   لو قررنا لاحقاً فتح قراءة عامة للمنتجات عن طريق PostgREST (الخيار «ب» في
--   docs/DATA-ACCESS.md)، المنح وقتها بيبقى **صريح لكل كائن على حدة** مع RLS policy،
--   مش بالاعتماد على الصلاحيات الافتراضية. الـ migration دي ما بتمنعش الخيار ده.
-- =====================================================================

begin;

-- 1) إلغاء الصلاحيات الافتراضية للكائنات الجديدة (المالك postgres)
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- 2) نفس الشيء للكائنات اللي بينشئها supabase_admin
alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon, authenticated;

-- 3) تنظيف الـ sequences الموجودة حالياً
revoke all on sequence public.products_id_seq    from anon, authenticated;
revoke all on sequence public.orders_id_seq      from anon, authenticated;
revoke all on sequence public.order_items_id_seq from anon, authenticated;

commit;

-- =====================================================================
-- rollback (يرجّع سلوك Supabase الافتراضي)
-- =====================================================================
-- begin;
--   alter default privileges for role postgres in schema public
--     grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public
--     grant all on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public
--     grant execute on functions to anon, authenticated;
--   alter default privileges for role supabase_admin in schema public
--     grant all on tables to anon, authenticated;
--   alter default privileges for role supabase_admin in schema public
--     grant all on sequences to anon, authenticated;
--   alter default privileges for role supabase_admin in schema public
--     grant execute on functions to anon, authenticated;
--   grant usage, select on sequence public.products_id_seq, public.orders_id_seq,
--     public.order_items_id_seq to anon, authenticated;
-- commit;

-- =====================================================================
-- التحقق بعد التنفيذ (المفروض النتيجتين فاضيتين)
-- =====================================================================
-- select n.nspname, pg_get_userbyid(d.defaclrole) as owner, d.defaclobjtype,
--        array_to_string(d.defaclacl,' | ') as acl
-- from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
-- where n.nspname = 'public'
--   and (array_to_string(d.defaclacl,',') like '%anon=%'
--        or array_to_string(d.defaclacl,',') like '%authenticated=%');
--
-- select object_name, grantee from information_schema.usage_privileges
-- where object_schema='public' and grantee in ('anon','authenticated');
