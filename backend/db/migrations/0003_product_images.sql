-- =====================================================================
-- 0003_product_images.sql
-- الحالة: مقترحة — لم تُنفّذ. للمراجعة قبل التطبيق.
--
-- الهدف: مصدر واحد لصور المنتجات مخزّن في Supabase Storage.
--   * بنخزّن **object path** فقط (مش رابط كامل) — عشان تغيير المشروع أو الدومين
--     أو تفعيل CDN ما يكسرش أي صف. الرابط العام بيتركّب في طبقة التطبيق:
--     {SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}
--   * ترتيب ظهور الصور + صورة رئيسية واحدة لكل منتج.
--   * دعم صور «قبل/بعد» بنفس الجدول عن طريق العمود kind.
--
-- إضافية بالكامل (additive): مفيش عمود أو بيانات بتتحذف.
-- الأعمدة القديمة (products.image_url / images / before_image / after_image)
-- بتفضل زي ما هي، والقراءة هتبقى مزدوجة لحد ما نتأكد.
--
-- ⚠ مهم (مكتشف في تحقق 0002): في Supabase فيه DEFAULT PRIVILEGES بتمنح `anon`
-- و`authenticated` كل الصلاحيات على **أي جدول جديد** في schema public. عشان كده
-- الـ migration دي بتسحب الصلاحيات وبتشغّل RLS على الجدول والـ sequence فوراً.
-- والعلاج الجذري في `0004_harden_default_privileges.sql`.
-- =====================================================================

begin;

create table if not exists product_images (
  id            bigserial primary key,
  product_id    integer not null references products (id) on delete cascade,

  -- مكان الملف في Supabase Storage
  bucket        text    not null default 'product-images',
  object_path   text    not null,          -- مثال: products/1/preview-9f2c.jpg

  -- نوع الصورة: معرض عادي، أو طرف من مقارنة قبل/بعد
  kind          text    not null default 'gallery'
                  check (kind in ('gallery', 'before', 'after')),

  alt_text      text,
  sort_order    integer not null default 0,
  is_primary    boolean not null default false,

  -- بيانات وصفية اختيارية (بتتملى وقت الرفع — مفيدة لتفادي layout shift)
  width_px      integer check (width_px is null or width_px > 0),
  height_px     integer check (height_px is null or height_px > 0),
  bytes         integer check (bytes is null or bytes > 0),
  content_type  text,

  -- SHA-256 لمحتوى الملف: يمنع رفع نفس الصورة مرتين لنفس المنتج،
  -- وبيساعد في اكتشاف الملفات اليتيمة وقت التنظيف
  checksum      text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_images_object_unique unique (bucket, object_path)
);

-- ترتيب العرض داخل المنتج
create index if not exists product_images_product_idx
  on product_images (product_id, kind, sort_order, id);

-- صورة رئيسية واحدة بالكتير لكل منتج (يفرضها الفهرس مش التطبيق)
create unique index if not exists product_images_one_primary_idx
  on product_images (product_id)
  where is_primary;

-- صورة «قبل» واحدة وصورة «بعد» واحدة لكل منتج
create unique index if not exists product_images_one_before_after_idx
  on product_images (product_id, kind)
  where kind in ('before', 'after');

-- منع تكرار نفس الصورة داخل نفس المنتج
create unique index if not exists product_images_checksum_idx
  on product_images (product_id, checksum)
  where checksum is not null;

-- قفل الجدول الجديد فوراً (الـ DEFAULT PRIVILEGES بتمنح anon تلقائياً)
revoke all on table public.product_images from anon, authenticated;
revoke all on sequence public.product_images_id_seq from anon, authenticated;
alter table public.product_images enable row level security;

commit;

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop table if exists product_images;
-- commit;

-- =====================================================================
-- التحقق بعد التنفيذ
-- =====================================================================
-- select rowsecurity from pg_tables where schemaname='public' and tablename='product_images';
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name='product_images' and grantee in ('anon','authenticated');  -- المفروض صفر صفوف

-- =====================================================================
-- خطة الهجرة التدريجية (كل مرحلة منفصلة ومراجَعة)
-- =====================================================================
-- المرحلة ١ — الحالية: إنشاء الجدول فقط. الواجهة ما تتغيّرش.
--
-- المرحلة ٢ — قراءة مزدوجة (dual read) في الباك إند:
--     صور المنتج = صفوف product_images لو موجودة، وإلا الأعمدة القديمة،
--     وإلا الصور المدمجة في frontend/assets. مفيش حذف لأي مصدر.
--
-- المرحلة ٣ — الكتابة الجديدة من الداشبورد بترفع على Storage وتسجّل هنا فقط.
--     الأعمدة القديمة تفضل للقراءة بس (read-only legacy).
--
-- المرحلة ٤ — بعد ما كل منتج يبقى له صفوف هنا وفترة تشغيل آمنة:
--     migration منفصلة (0005) تنقل أي روابط قديمة متبقية وتعلّم الأعمدة deprecated.
--
-- المرحلة ٥ — حذف الأعمدة القديمة، بموافقة صريحة وفي migration مستقلة.
