-- =====================================================================
-- 0002_security_rls_grants.sql
-- الحالة: مطبّقة على production بتاريخ 2026-09-29
-- السبب: الجداول كانت RLS مقفول عليها و role `anon` عنده كل الصلاحيات،
--        يعني أي حد معاه الـ anon key العام كان يقدر يقرا/يعدّل/يمسح
--        طلبات العملاء (أسماء، تليفونات، عناوين) عن طريق Supabase REST API.
-- الأثر على التطبيق: صفر — الباك إند بيتصل بدور `postgres` وعنده BYPASSRLS.
-- =====================================================================

begin;

-- 1) تشغيل Row Level Security على كل جداول public
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.settings    enable row level security;

-- مفيش policies مضافة عن قصد: من غير policy، أي دور خاضع لـ RLS ما بيشوفش أي صف.
-- الوصول الوحيد دلوقتي عن طريق دور `postgres` (BYPASSRLS) من الباك إند.

-- 2) سحب صلاحيات الأدوار العامة (anon = مفتاح عام، authenticated = مستخدمي Supabase Auth)
revoke all on public.products    from anon, authenticated;
revoke all on public.orders      from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.settings    from anon, authenticated;

-- 3) مخزن صور المنتجات: قراءة عامة (الصور بتتعرض في المتجر)، رفع من الباك إند فقط
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,                                    -- القراءة عامة عن طريق /storage/v1/object/public/...
  5242880,                                 -- 5 MB لكل ملف
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ملاحظة: مفيش policies على storage.objects، يعني الكتابة/الحذف متاحة لـ service_role فقط
-- (اللي بيستخدمه الباك إند)، والقراءة عامة لأن الـ bucket public.

commit;

-- =====================================================================
-- rollback (للتراجع اليدوي فقط — بيرجّع الوضع غير الآمن)
-- =====================================================================
-- begin;
--   alter table public.products    disable row level security;
--   alter table public.orders      disable row level security;
--   alter table public.order_items disable row level security;
--   alter table public.settings    disable row level security;
--   grant all on public.products, public.orders, public.order_items, public.settings
--     to anon, authenticated;
--   delete from storage.buckets where id = 'product-images';
-- commit;

-- =====================================================================
-- التحقق بعد التنفيذ
-- =====================================================================
-- select tablename, rowsecurity from pg_tables where schemaname = 'public';
-- select table_name, grantee from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon','authenticated');   -- المفروض صفر صفوف
-- select id, public, file_size_limit from storage.buckets;
