-- =====================================================================
-- 0006_site_images.sql
-- الحالة: مقترحة — لم تُنفّذ. للمراجعة.
--
-- الغرض: صور الموقع غير المرتبطة بمنتج (اللوجو، معرض «شغلنا»، صور الخامات)
--        تتخزّن في Supabase Storage بـ object_path، وتتدار من الداشبورد —
--        بدل تخزين روابط داخل settings (الترتيب والحذف على jsonb صعب).
--
-- شرط مسبق: 0004 (وإلا الجدول الجديد بيتمنح لـ anon تلقائياً).
-- علاقة بـ 0003: نفس الفلسفة — object_path فقط، الرابط يتركّب في التطبيق.
-- =====================================================================

begin;

create table if not exists site_images (
  id           bigserial primary key,

  kind         text    not null check (kind in ('logo', 'gallery', 'material')),
  bucket       text    not null default 'product-images',
  object_path  text    not null,

  alt_text     text,
  caption      text,
  sort_order   integer not null default 0 check (sort_order >= 0),
  is_active    boolean not null default true,

  -- بيانات وصفية اختيارية (زي product_images)
  width_px     integer check (width_px is null or width_px > 0),
  height_px    integer check (height_px is null or height_px > 0),
  bytes        integer check (bytes is null or bytes > 0),
  content_type text,
  checksum     text check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint site_images_object_unique unique (bucket, object_path)
);

-- ترتيب العرض داخل كل نوع
create index if not exists site_images_kind_idx
  on site_images (kind, is_active, sort_order, id);

-- لوجو واحد نشط بالكتير
create unique index if not exists site_images_one_active_logo_idx
  on site_images (kind)
  where kind = 'logo' and is_active;

-- منع تكرار نفس الملف داخل نفس النوع — **للصفوف النشطة فقط**
-- (لو طبّقناه على الكل، إعادة رفع لوجو قديم متعطّل هتترفض)
create unique index if not exists site_images_checksum_idx
  on site_images (kind, checksum)
  where checksum is not null and is_active;

-- قفل الجدول فوراً (DEFAULT PRIVILEGES بتمنح anon تلقائياً)
revoke all on table public.site_images from anon, authenticated;
revoke all on sequence public.site_images_id_seq from anon, authenticated;
alter table public.site_images enable row level security;

-- ---------------------------------------------------------------------
-- تتبّع الملفات اليتيمة (مطلوب لمصفوفة الأعطال في docs/IMAGE-MANAGEMENT.md):
-- لو الرفع نجح والإدراج فشل، أو الحذف من الداتابيز نجح وحذف الملف فشل.
-- ---------------------------------------------------------------------
create table if not exists storage_orphans (
  id          bigserial primary key,
  bucket      text not null default 'product-images',
  object_path text not null,
  reason      text not null check (reason in ('insert_failed', 'delete_failed', 'replaced')),
  created_at  timestamptz not null default now(),
  cleaned_at  timestamptz,
  constraint storage_orphans_object_unique unique (bucket, object_path)
);

create index if not exists storage_orphans_pending_idx
  on storage_orphans (created_at)
  where cleaned_at is null;

revoke all on table public.storage_orphans from anon, authenticated;
revoke all on sequence public.storage_orphans_id_seq from anon, authenticated;
alter table public.storage_orphans enable row level security;

commit;

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop table if exists storage_orphans;
--   drop table if exists site_images;
-- commit;

-- =====================================================================
-- ملاحظات للمراجعة
-- =====================================================================
-- 1) مفاتيح settings القديمة (logo_url, gallery, materials) **ما تتحذفش** —
--    القراءة هتبقى مزدوجة: site_images أولاً، وإلا settings، وإلا الصور المدمجة.
--    الحذف في migration منفصلة بعد فترة تشغيل آمنة وبموافقة صريحة.
-- 2) معرض «قبل/بعد» العام: صفّين kind='gallery' مربوطين بـ caption واحد،
--    ولا عمود pair_id؟ (مقترح: pair_id uuid يتضاف لو احتجناه — مؤجّل).
-- 3) مراجعة التفرّد:
--    • (bucket, object_path) unique — صح، الملف الواحد ماينفعش يتسجّل مرتين
--      (وإلا حذف صف بيكسر التاني لأن الملف بيتمسح من Storage).
--    • التفرّد ده مابيمنعش إن نفس الملف يترفع تاني بـ UUID جديد — دور فهرس checksum.
--    • checksum unique للنشط فقط، عشان إعادة استخدام صورة قديمة متعطّلة تفضل ممكنة.
--      نقطة مراجعة: نفس الصورة مسموحة حالياً في gallery و material مع بعض.
-- 4) sort_order مقيّد بـ >= 0؛ الترتيب بيتكتب دفعة واحدة من الباك إند.
-- 5) `is_active` بيسمح بإخفاء صورة من غير حذفها من Storage.
