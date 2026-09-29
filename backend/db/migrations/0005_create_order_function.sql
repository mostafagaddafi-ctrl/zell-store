-- =====================================================================
-- 0005_create_order_function.sql  — مسودة v2 (توجّه مقبول، SQL غير معتمد)
-- لم تُنفّذ. للمراجعة السطر-بسطر قبل أي تطبيق.
--
-- شرط مسبق إلزامي: 0004 (إلغاء EXECUTE الافتراضي لـ anon/authenticated).
--
-- تغييرات v2 بناءً على المراجعة:
--   1. مالك SECURITY DEFINER = دور مخصص NOLOGIN (`zell_definer`) بدل postgres.
--   2. `zell_definer` مالوش BYPASSRLS، فالوصول بيتم بـ policies صريحة محدودة.
--   3. idempotency ذرّي بـ ON CONFLICT (مش check-then-insert) + ربط المفتاح بـ request hash.
--   4. البصمة = HMAC يحسبه الباك إند الموثوق (مش المتصفح) ويمرره كنص.
--   5. أكواد أخطاء ثابتة (SQLSTATE في class 45 + رسالة = كود ثابت).
--   6. توثيق صريح لاعتماد الدالة على مفاتيح settings.
-- =====================================================================

-- =====================================================================
-- (0) الاعتماديات — لازم تكون موجودة قبل التنفيذ
-- =====================================================================
-- الدالة بتعتمد على صفوف في public.settings بالشكل ده:
--
--   key = 'shipping_rates'                     → jsonb object: {"القاهرة": 5000, ...}
--                                                 (المفتاح اسم المحافظة، القيمة بالقرش integer)
--   key = 'shipping_default_piastres'          → jsonb number (integer)
--   key = 'free_shipping_threshold_piastres'   → jsonb number (integer، 0 = مقفول)
--
-- حالياً على production: المفاتيح الثلاثة **موجودة** (14 صف في settings)،
-- لكن مفيش أي قيد في الـ schema يضمن وجودها أو شكلها. عشان كده:
--   • الدالة بتفشل بكود ثابت ZELL_SETTINGS_MISSING لو ناقص أي مفتاح.
--   • مقترح (نقطة مراجعة): migration منفصلة تضيف CHECK أو trigger يضمن الشكل،
--     أو نقل إعدادات الشحن لجدول `shipping_rates(governorate pk, piastres int)`
--     بدل jsonb — أوضح وأسهل في الفهرسة والتحقق.
--
-- كمان بتعتمد على: public.generate_order_number() — **غير موجودة**، محتاجة migration
-- مستقلة (نفس أبجدية FLM-XXXXXX بدون O/0/I/1 + إعادة محاولة عند التكرار).

begin;

-- =====================================================================
-- (1) الأدوار
-- =====================================================================
-- zell_definer: مالك الدالة. NOLOGIN، من غير BYPASSRLS، صلاحياته أضيق حاجة ممكنة.
--               السطر ده هو اللي بيمنع «SECURITY DEFINER = postgres» الخطير.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'zell_definer') then
    create role zell_definer nologin nobypassrls;
  end if;
end;
$$;

-- zell_order: دور تسجيل دخول للواجهة العامة مستقبلاً. مالوش أي صلاحية على الجداول.
-- (يتعمل وقت فتح المتجر للعامة — مش دلوقتي)
-- create role zell_order login password '...';

-- عشان postgres يقدر ينقل ملكية الدالة لـ zell_definer لازم يكون عضو فيه:
grant zell_definer to postgres;

-- =====================================================================
-- (2) صلاحيات zell_definer — أضيق مجموعة تكفي لإنشاء طلب
-- =====================================================================
grant usage on schema public to zell_definer;

grant select on table public.products  to zell_definer;
grant select on table public.settings  to zell_definer;
grant insert on table public.orders    to zell_definer;
grant select on table public.orders    to zell_definer;  -- مطلوب لـ RETURNING و replay فقط
grant insert on table public.order_items to zell_definer;
grant usage  on sequence public.orders_id_seq      to zell_definer;
grant usage  on sequence public.order_items_id_seq to zell_definer;

-- ملاحظة: مفيش UPDATE ولا DELETE على orders/order_items إطلاقاً.

-- =====================================================================
-- (3) RLS policies لـ zell_definer
--     (الدور مالوش BYPASSRLS، فمن غير policies مش هيشوف ولا صف)
-- =====================================================================
create policy products_read_for_definer on public.products
  for select to zell_definer
  using (is_active = true);

create policy settings_read_for_definer on public.settings
  for select to zell_definer
  using (key in ('shipping_rates', 'shipping_default_piastres', 'free_shipping_threshold_piastres'));
  -- ⚠ ملاحظة مراجعة: كده telegram_bot_token و notify_email مش مقروءين للدور ده أصلاً.

create policy orders_insert_for_definer on public.orders
  for insert to zell_definer with check (true);

create policy orders_read_own_new_for_definer on public.orders
  for select to zell_definer
  using (created_at > now() - interval '1 day');
  -- القراءة محدودة بآخر 24 ساعة عشان replay الـ idempotency بس.

create policy order_items_insert_for_definer on public.order_items
  for insert to zell_definer with check (true);

-- =====================================================================
-- (4) idempotency: مفتاح + بصمة الطلب (request hash)
-- =====================================================================
alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists request_hash    text;

-- القيد الفريد هو آلية الذرّية نفسها (مش select-ثم-insert)
create unique index if not exists orders_idempotency_key_idx
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- =====================================================================
-- (5) تحديد المعدل — البصمة HMAC محسوبة في الباك إند
-- =====================================================================
-- الباك إند الموثوق بيحسب:
--   fingerprint = encode(hmac_sha256(secret, ip || '|' || user_agent), 'hex')
-- المفتاح السري في مورد Retool / متغيّر بيئة، **مش** في الواجهة.
-- الداتابيز بتخزّن الـ HMAC بس — مفيش IP خام (أفضل للخصوصية).
create table if not exists public.order_throttle (
  fingerprint       text        primary key,
  window_started_at timestamptz not null default now(),
  attempts          integer     not null default 0,
  last_attempt_at   timestamptz not null default now()
);

revoke all on table public.order_throttle from public, anon, authenticated;
grant select, insert, update on table public.order_throttle to zell_definer;
alter table public.order_throttle enable row level security;

create policy throttle_rw_for_definer on public.order_throttle
  for all to zell_definer using (true) with check (true);

-- =====================================================================
-- (6) الدالة
-- =====================================================================
create or replace function public.create_order(
  p_items           jsonb,
  p_customer_name   text,
  p_customer_phone  text,
  p_governorate     text,
  p_address         text,
  p_notes           text,
  p_fingerprint     text,     -- HMAC من الباك إند
  p_idempotency_key text      -- UUID من الباك إند
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_window            constant interval := interval '1 hour';
  c_max_per_window    constant integer  := 5;
  c_max_per_phone_day constant integer  := 5;
  c_max_items         constant integer  := 20;

  v_request_hash  text;
  v_existing      record;
  v_attempts      integer;
  v_rates         jsonb;
  v_default_ship  jsonb;
  v_free_thresh   jsonb;
  v_item_count    integer;
  v_order         record;
begin
  ------------------------------------------------------------------
  -- (أ) بصمة الطلب: المفتاح مربوط بالمحتوى، فإعادة استخدامه ببيانات
  --     مختلفة بترجع خطأ بدل ما تمرّ
  ------------------------------------------------------------------
  if p_idempotency_key is null or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 16 then
    raise exception 'ZELL_IDEMPOTENCY_REQUIRED' using errcode = '45001';
  end if;
  if p_fingerprint is null or pg_catalog.length(p_fingerprint) < 32 then
    raise exception 'ZELL_FINGERPRINT_REQUIRED' using errcode = '45002';
  end if;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'items', p_items,
        'name',  pg_catalog.btrim(coalesce(p_customer_name, '')),
        'phone', coalesce(p_customer_phone, ''),
        'gov',   coalesce(p_governorate, ''),
        'addr',  pg_catalog.btrim(coalesce(p_address, '')),
        'notes', pg_catalog.btrim(coalesce(p_notes, ''))
      )::text, 'UTF8')),
    'hex');

  ------------------------------------------------------------------
  -- (ب) تحديد المعدل
  ------------------------------------------------------------------
  insert into public.order_throttle as t (fingerprint, window_started_at, attempts, last_attempt_at)
  values (p_fingerprint, now(), 1, now())
  on conflict (fingerprint) do update
    set attempts          = case when now() - t.window_started_at > c_window then 1 else t.attempts + 1 end,
        window_started_at = case when now() - t.window_started_at > c_window then now() else t.window_started_at end,
        last_attempt_at   = now()
  returning t.attempts into v_attempts;

  if v_attempts > c_max_per_window then
    raise exception 'ZELL_RATE_LIMIT' using errcode = '45010';
  end if;

  ------------------------------------------------------------------
  -- (ج) التحقق من المدخلات
  ------------------------------------------------------------------
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_customer_name, ''))) < 3 then
    raise exception 'ZELL_INVALID_NAME' using errcode = '45020';
  end if;
  if coalesce(p_customer_phone, '') !~ '^01[0125][0-9]{8}$' then
    raise exception 'ZELL_INVALID_PHONE' using errcode = '45021';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_address, ''))) < 8 then
    raise exception 'ZELL_INVALID_ADDRESS' using errcode = '45022';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  v_item_count := pg_catalog.jsonb_array_length(p_items);
  if v_item_count = 0 then
    raise exception 'ZELL_CART_EMPTY' using errcode = '45024';
  end if;
  if v_item_count > c_max_items then
    raise exception 'ZELL_CART_TOO_LARGE' using errcode = '45025';
  end if;

  -- الاعتماديات (راجع القسم 0)
  select s.value into v_rates        from public.settings s where s.key = 'shipping_rates';
  select s.value into v_default_ship from public.settings s where s.key = 'shipping_default_piastres';
  select s.value into v_free_thresh  from public.settings s where s.key = 'free_shipping_threshold_piastres';
  if v_rates is null or v_default_ship is null or v_free_thresh is null then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  if not (v_rates ? coalesce(p_governorate, '')) then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;

  if (select pg_catalog.count(*) from public.orders o
       where o.customer_phone = p_customer_phone
         and o.created_at > now() - interval '1 day') >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45011';
  end if;

  ------------------------------------------------------------------
  -- (د) الإنشاء الذرّي + idempotency عن طريق القيد الفريد
  ------------------------------------------------------------------
  with req as (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm
    from pg_catalog.jsonb_array_elements(p_items) as e
  ),
  priced as (
    select p.id as product_id, p.name_ar, p.image_url, p.price_per_meter_piastres, p.width_cm,
           r.length_cm,
           pg_catalog.round((p.price_per_meter_piastres * r.length_cm) / 100.0)::integer as line_total
    from req r
    join public.products p
      on p.id = r.product_id
     and p.is_active = true
     and r.length_cm >= p.min_length_cm
     and r.length_cm <= p.max_length_cm
     and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
  ),
  totals as (
    select coalesce(pg_catalog.sum(line_total), 0)::integer as subtotal,
           pg_catalog.count(*)::integer as ok_count
    from priced
  ),
  ship as (
    select coalesce((v_rates ->> p_governorate)::integer, (v_default_ship #>> '{}')::integer, 0) as base_piastres,
           coalesce((v_free_thresh #>> '{}')::integer, 0) as free_threshold
  ),
  new_order as (
    insert into public.orders (
      order_number, customer_name, customer_phone, governorate, address, notes,
      subtotal_piastres, shipping_piastres, total_piastres, idempotency_key, request_hash
    )
    select
      public.generate_order_number(),
      pg_catalog.btrim(p_customer_name), p_customer_phone, p_governorate,
      pg_catalog.btrim(p_address), nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
      t.subtotal,
      case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold then 0 else sh.base_piastres end,
      t.subtotal + case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold then 0 else sh.base_piastres end,
      p_idempotency_key, v_request_hash
    from totals t, ship sh
    where t.ok_count > 0 and t.ok_count = (select pg_catalog.count(*) from req)
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres
  ),
  items_ins as (
    insert into public.order_items (
      order_id, product_id, product_name_ar, product_image_url,
      unit_price_piastres, length_cm, width_cm, line_total_piastres
    )
    select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
           pr.length_cm, pr.width_cm, pr.line_total
    from new_order o cross join priced pr
    returning order_id
  )
  select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
         (select pg_catalog.count(*) from items_ins) as items
  into v_order
  from new_order o;

  ------------------------------------------------------------------
  -- (هـ) مفيش صف اتعمل: يا إما إعادة إرسال (replay) يا إما رفض
  ------------------------------------------------------------------
  if v_order.order_number is null then
    select o.order_number, o.request_hash, o.subtotal_piastres, o.shipping_piastres, o.total_piastres
      into v_existing
    from public.orders o
    where o.idempotency_key = p_idempotency_key;

    if v_existing.order_number is not null then
      -- نفس المفتاح: لازم يكون بنفس المحتوى، وإلا رفض
      if v_existing.request_hash is distinct from v_request_hash then
        raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
      end if;
      return pg_catalog.jsonb_build_object(
        'ok', true, 'replayed', true,
        'order_number', v_existing.order_number,
        'subtotal_piastres', v_existing.subtotal_piastres,
        'shipping_piastres', v_existing.shipping_piastres,
        'total_piastres', v_existing.total_piastres);
    end if;

    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'replayed', false,
    'order_number', v_order.order_number,
    'subtotal_piastres', v_order.subtotal_piastres,
    'shipping_piastres', v_order.shipping_piastres,
    'total_piastres', v_order.total_piastres,
    'items', v_order.items);
end;
$$;

-- الملكية: الدالة تشتغل بصلاحيات zell_definer (مش postgres)
alter function public.create_order(jsonb, text, text, text, text, text, text, text)
  owner to zell_definer;

-- =====================================================================
-- (7) الصلاحيات على الدالة
-- =====================================================================
-- PostgreSQL بيمنح EXECUTE لـ PUBLIC افتراضياً على أي دالة، فلازم السحب الصريح:
revoke all on function public.create_order(jsonb, text, text, text, text, text, text, text)
  from public, anon, authenticated;

-- الاتصال الحالي (Retool → دور postgres): منح صريح عشان الباك إند يقدر ينادي الدالة
grant execute on function public.create_order(jsonb, text, text, text, text, text, text, text)
  to postgres;

-- لاحقاً عند فتح المتجر للعامة (غير منفّذ):
--   grant execute on function public.create_order(...) to zell_order;
--   -- zell_order مالوش SELECT ولا INSERT على orders/order_items — الدالة بس.

commit;

-- =====================================================================
-- أكواد الأخطاء الثابتة (الرسالة = الكود، والتطبيق بيترجمها للمستخدم)
-- =====================================================================
--  45001 ZELL_IDEMPOTENCY_REQUIRED     مفتاح idempotency ناقص
--  45002 ZELL_FINGERPRINT_REQUIRED     بصمة HMAC ناقصة
--  45003 ZELL_IDEMPOTENCY_MISMATCH     نفس المفتاح ببيانات مختلفة
--  45010 ZELL_RATE_LIMIT               تجاوز حد المحاولات لكل بصمة
--  45011 ZELL_PHONE_DAILY_LIMIT        تجاوز الحد اليومي لنفس الرقم
--  45020 ZELL_INVALID_NAME             الاسم قصير
--  45021 ZELL_INVALID_PHONE            صيغة الموبايل غلط
--  45022 ZELL_INVALID_ADDRESS          العنوان قصير
--  45023 ZELL_CART_INVALID             السلة مش array
--  45024 ZELL_CART_EMPTY               السلة فاضية
--  45025 ZELL_CART_TOO_LARGE           أصناف أكتر من الحد
--  45030 ZELL_SETTINGS_MISSING         مفاتيح الشحن ناقصة في settings
--  45031 ZELL_GOVERNORATE_NOT_SERVED   محافظة مش في جدول الشحن
--  45040 ZELL_ITEM_UNAVAILABLE         منتج مقفول أو طول مخالف

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop function if exists public.create_order(jsonb, text, text, text, text, text, text, text);
--   drop policy if exists throttle_rw_for_definer on public.order_throttle;
--   drop policy if exists order_items_insert_for_definer on public.order_items;
--   drop policy if exists orders_read_own_new_for_definer on public.orders;
--   drop policy if exists orders_insert_for_definer on public.orders;
--   drop policy if exists settings_read_for_definer on public.settings;
--   drop policy if exists products_read_for_definer on public.products;
--   drop table if exists public.order_throttle;
--   drop index if exists public.orders_idempotency_key_idx;
--   alter table public.orders drop column if exists request_hash;
--   alter table public.orders drop column if exists idempotency_key;
--   revoke all on schema public from zell_definer;
--   -- drop role zell_definer;  -- بعد التأكد إنه مش مالك أي كائن
-- commit;

-- =====================================================================
-- نقاط مفتوحة للمراجعة
-- =====================================================================
-- 1) public.generate_order_number() غير موجودة — migration مستقلة مطلوبة،
--    ولازم تكون owner = zell_definer كمان أو SECURITY INVOKER بسيطة.
-- 2) policy قراءة الطلبات لـ zell_definer محدودة بـ 24 ساعة؛ لو الـ idempotency
--    key عمره أطول من كده، الـ replay هيفشل ويرفع ZELL_ITEM_UNAVAILABLE بالغلط.
--    البديل: policy على `idempotency_key is not null` بدل الوقت. محتاج قرار.
-- 3) `on conflict ... where idempotency_key is not null` على فهرس جزئي —
--    يتأكد إن صياغة الـ inference صحيحة في نسخة Postgres المستخدمة.
-- 4) اعتماد settings.shipping_rates كـ jsonb: مقترح تحويله لجدول مستقل.
-- 5) تنظيف order_throttle (pg_cron يومي أو حذف عشوائي عند الكتابة).
