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
-- 🔴 نقطة إضافية (من المراجعة): PostgreSQL نفسه بيمنح **EXECUTE لـ PUBLIC**
--   على أي دالة جديدة — وده سلوك المحرّك، مش إعداد Supabase. الدور الوهمي
--   `PUBLIC` بيشمل **كل الأدوار** الحالية والمستقبلية، بما فيهم anon و authenticated
--   وأي دور يتعمل بعدين. يعني سحب الصلاحيات من anon/authenticated **لا يكفي**:
--   لازم `revoke ... from public` كمان، وإلا الدالة تفضل قابلة للتنفيذ من الجميع.
--   نفس الكلام على schema public: `GRANT USAGE/CREATE` ممنوحة لـ PUBLIC افتراضياً
--   في Postgres < 15 (Supabase بيشيل CREATE عادة — يتأكد منه في التحقق تحت).
--
-- ⚠ ملاحظة قبل التنفيذ:
--   لو قررنا لاحقاً فتح قراءة عامة للمنتجات عن طريق PostgREST (الخيار «ب» في
--   docs/DATA-ACCESS.md)، المنح وقتها بيبقى **صريح لكل كائن على حدة** مع RLS policy،
--   مش بالاعتماد على الصلاحيات الافتراضية. الـ migration دي ما بتمنعش الخيار ده.
-- =====================================================================

begin;

-- 1) إلغاء الصلاحيات الافتراضية للكائنات الجديدة (المالك postgres)
--    ملاحظة: `public` هنا هو الدور الوهمي PUBLIC (كل الأدوار)، مش اسم الـ schema.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2) نفس الشيء للكائنات اللي بينشئها supabase_admin
alter default privileges for role supabase_admin in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated;

-- 3) تنظيف الـ sequences الموجودة حالياً
revoke all on sequence public.products_id_seq    from public, anon, authenticated;
revoke all on sequence public.orders_id_seq      from public, anon, authenticated;
revoke all on sequence public.order_items_id_seq from public, anon, authenticated;

-- 4) الدوال الموجودة حالياً (صفر دوال دلوقتي، لكن السطر ده بيمنع أي مفاجأة)
revoke execute on all functions in schema public from public, anon, authenticated;

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
-- where object_schema='public' and grantee in ('anon','authenticated','PUBLIC');
--
-- -- صلاحيات PUBLIC على الدوال (المفروض فاضية)
-- select p.proname, pg_catalog.array_to_string(p.proacl, ' | ') as acl
-- from pg_proc p where p.pronamespace = 'public'::regnamespace;
--
-- -- صلاحيات PUBLIC على schema public
-- select nspname, pg_catalog.array_to_string(nspacl, ' | ') from pg_namespace where nspname='public';
