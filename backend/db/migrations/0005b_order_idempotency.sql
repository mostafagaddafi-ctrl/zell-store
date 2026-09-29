-- =====================================================================
-- 0005b_order_idempotency.sql
-- الحالة: مسودة — لم تُنفّذ.
--
-- تغيير جوهري بعد المراجعة: **الهاش بيتحسب في الباك إند مش في الداتابيز.**
--   pg_catalog.sha256() مش مضمونة في كل النسخ/الإعدادات، و pgcrypto بتعيش في
--   schema `extensions` في Supabase — الاعتماد عليها داخل دالة بـ search_path=''
--   بيضيف اعتمادية هشة. الحل: الباك إند يحسب SHA-256 لمحتوى الطلب ويمرره كنص،
--   والداتابيز بتتحقق من **الصيغة** بس وبتقارن.
-- =====================================================================

begin;

alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists request_hash    text;

-- الصيغة: sha256 hex صغيرة (64 حرف). المفتاح: UUID أو أطول.
alter table public.orders
  drop constraint if exists orders_request_hash_format;
alter table public.orders
  add constraint orders_request_hash_format
  check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');

alter table public.orders
  drop constraint if exists orders_idempotency_key_len;
alter table public.orders
  add constraint orders_idempotency_key_len
  check (idempotency_key is null or pg_catalog.length(idempotency_key) between 16 and 128);

-- القيد الفريد هو آلية الذرّية (مش select-ثم-insert)
create unique index if not exists orders_idempotency_key_idx
  on public.orders (idempotency_key)
  where idempotency_key is not null;

commit;

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop index if exists public.orders_idempotency_key_idx;
--   alter table public.orders drop constraint if exists orders_idempotency_key_len;
--   alter table public.orders drop constraint if exists orders_request_hash_format;
--   alter table public.orders drop column if exists request_hash;
--   alter table public.orders drop column if exists idempotency_key;
-- commit;

-- =====================================================================
-- ملاحظات
-- =====================================================================
-- 1) الباك إند بيحسب: sha256(canonical_json(items,name,phone,gov,address,notes))
--    بترتيب مفاتيح ثابت — التسلسل لازم يكون متطابق في كل مكان وإلا الـ replay هيفشل.
-- 2) صلاحية حذف المفاتيح القديمة: مؤجّلة. الصفوف بتفضل مع الطلب للأبد حالياً.
