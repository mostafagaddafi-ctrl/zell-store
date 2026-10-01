-- =====================================================================
-- 0006a — أعمدة الطلب الستة
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على Production**
--  الخطة:  docs/plans/ORDER-FLOW-PLAN.md §2.2
--  الترتيب: 0006a ثم 0006b. ممنوع تنفيذ 0006b قبل ده.
--
--  بيضيف: idempotency_key · request_hash · checkout_session_hash ·
--          receipt_token_hash · receipt_token_hash_prev · receipt_expires_at
--  وفهرس فريد جزئي واحد = نقطة الذرّية الوحيدة لمسار الطلب.
--
--  كل الأعمدة nullable عن قصد: الطلبات اليدوية من اللوحة تفضل صالحة،
--  والتراجع = drop column بدون أي فقد لصفوف.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) الأعمدة — قابلة لإعادة التنفيذ
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists idempotency_key         text;
alter table public.orders add column if not exists request_hash            text;
alter table public.orders add column if not exists checkout_session_hash   text;
alter table public.orders add column if not exists receipt_token_hash      text;
alter table public.orders add column if not exists receipt_token_hash_prev text;
alter table public.orders add column if not exists receipt_expires_at      timestamptz;

comment on column public.orders.idempotency_key is
  'UUID من العميل. **مش سر** (مخزّن في sessionStorage). يمنع التكرار بس.';
comment on column public.orders.request_hash is
  'SHA-256 للطلب المطبّع، محسوب في الباك إند. يربط المفتاح بمحتواه.';
comment on column public.orders.checkout_session_hash is
  'SHA-256 لكوكي جلسة الدفع HttpOnly. إثبات «المتصفح ده» — شرط الـreplay.';
comment on column public.orders.receipt_token_hash is
  'SHA-256 لرمز الإيصال الحالي. السر الخام عمره ما يدخل الداتابيز.';
comment on column public.orders.receipt_token_hash_prev is
  'الرمز السابق — لسه صالح. بيخلّي التصميم صح مهما كان ترتيب وصول الردود.';
comment on column public.orders.receipt_expires_at is
  'بيتكتب مرة واحدة عند الإنشاء. **عمره ما يتمدّد** — ولا مسار واحد بيعدّله.';

-- ---------------------------------------------------------------------
-- (2) القيود — ALTER ... ADD CONSTRAINT مالوش IF NOT EXISTS
-- ---------------------------------------------------------------------
do $guard$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'orders_idempotency_key_len'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_idempotency_key_len
      check (idempotency_key is null
             or pg_catalog.length(pg_catalog.btrim(idempotency_key)) between 16 and 128);
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'orders_request_hash_format'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_request_hash_format
      check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'orders_checkout_session_hash_format'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_checkout_session_hash_format
      check (checkout_session_hash is null or checkout_session_hash ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'orders_receipt_token_hash_format'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_receipt_token_hash_format
      check (receipt_token_hash is null or receipt_token_hash ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'orders_receipt_token_hash_prev_format'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_receipt_token_hash_prev_format
      check (receipt_token_hash_prev is null or receipt_token_hash_prev ~ '^[0-9a-f]{64}$');
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- (3) الفهرس الفريد الجزئي — نقطة الذرّية الوحيدة
--
--  ⚠ الـpredicate هنا لازم يطابق **حرفياً** جملة
--     on conflict (idempotency_key) where idempotency_key is not null
--    في 0006b. أي اختلاف = بوستجريس ما بيلاقيش الفهرس والـon conflict بيفشل.
-- ---------------------------------------------------------------------
create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- مفيش فهرس على أي عمود hash عن قصد: البحث بيبدأ من order_number اللي عليه
-- orders_order_number_key، والهاشات بتتقارن بعدها على صف واحد.

-- ---------------------------------------------------------------------
-- (4) تحقق ذاتي — الـmigration بتفحص نفسها
-- ---------------------------------------------------------------------
do $verify$
declare
  v_cols integer;
  v_cons integer;
  v_idx  integer;
begin
  select pg_catalog.count(*) into v_cols
  from pg_catalog.pg_attribute
  where attrelid = 'public.orders'::regclass
    and not attisdropped
    and attname in ('idempotency_key', 'request_hash', 'checkout_session_hash',
                    'receipt_token_hash', 'receipt_token_hash_prev', 'receipt_expires_at');
  if v_cols <> 6 then
    raise exception 'ZELL_MIGRATION_0006A_COLUMNS: expected 6, found %', v_cols;
  end if;

  select pg_catalog.count(*) into v_cons
  from pg_catalog.pg_constraint
  where conrelid = 'public.orders'::regclass
    and conname in ('orders_idempotency_key_len', 'orders_request_hash_format',
                    'orders_checkout_session_hash_format', 'orders_receipt_token_hash_format',
                    'orders_receipt_token_hash_prev_format');
  if v_cons <> 5 then
    raise exception 'ZELL_MIGRATION_0006A_CONSTRAINTS: expected 5, found %', v_cons;
  end if;

  select pg_catalog.count(*) into v_idx
  from pg_catalog.pg_indexes
  where schemaname = 'public' and indexname = 'orders_idempotency_key_uidx';
  if v_idx <> 1 then
    raise exception 'ZELL_MIGRATION_0006A_INDEX: missing orders_idempotency_key_uidx';
  end if;
end
$verify$;

commit;

-- =====================================================================
-- التراجع (للمرجع — مش بيتنفّذ تلقائياً)
-- =====================================================================
--  begin;
--    drop index if exists public.orders_idempotency_key_uidx;
--    alter table public.orders
--      drop constraint if exists orders_receipt_token_hash_prev_format,
--      drop constraint if exists orders_receipt_token_hash_format,
--      drop constraint if exists orders_checkout_session_hash_format,
--      drop constraint if exists orders_request_hash_format,
--      drop constraint if exists orders_idempotency_key_len;
--    alter table public.orders
--      drop column if exists receipt_expires_at,
--      drop column if exists receipt_token_hash_prev,
--      drop column if exists receipt_token_hash,
--      drop column if exists checkout_session_hash,
--      drop column if exists request_hash,
--      drop column if exists idempotency_key;
--  commit;
--  مفيش أي صف طلب بيضيع في التراجع ده.
