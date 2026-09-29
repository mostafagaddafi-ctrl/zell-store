-- =====================================================================
-- 0005c_create_order_function.sql
-- الحالة: مسودة — لم تُنفّذ.
--
-- شروط مسبقة: 0004 (EXECUTE الافتراضي) ← 0005a (generate_order_number) ← 0005b (idempotency).
--
-- تغييرات بعد المراجعة الفعلية للـ commit:
--   ✗ اتشال: تحديد المعدل داخل الدالة. السبب: أي `raise exception` بيعمل rollback
--     للـ transaction كله، فتحديث عدّاد الـ throttle بيتلغي مع كل رفض — يعني
--     المهاجم اللي بيبعت طلبات غلط عمره ما هيتعد عليه. تحديد المعدل مكانه
--     الصح = الباك إند/البروكسي (مخزن خارج الـ transaction). مؤجّل ومنفصل.
--   ✗ اتشال: حساب الهاش في الداتابيز (pg_catalog.sha256 مش مضمونة) → الباك إند بيمرره.
--   ✓ اتصلح: policy قراءة الطلبات للـ replay مبنية على `idempotency_key is not null`
--     بدل نافذة 24 ساعة (كانت هتخلي الـ replay يفشل بعد يوم).
--   ✓ اتضاف: تحقق آمن من شكل الـ JSON قبل أي cast (مفيش 22P02 وقت التشغيل).
--   ✓ اتضاف: إعادة محاولة عند تصادم order_number باستخدام CONSTRAINT_NAME.
--   ✓ باقي: حد يومي لكل رقم موبايل (استعلام قراءة، مش عدّاد بيتلغي).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) دور المالك: NOLOGIN، من غير BYPASSRLS
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'zell_definer') then
    create role zell_definer nologin nobypassrls;
  end if;
end;
$$;

grant zell_definer to postgres;   -- عشان نقل الملكية

-- ---------------------------------------------------------------------
-- (2) أضيق صلاحيات تكفي
-- ---------------------------------------------------------------------
grant usage on schema public to zell_definer;

grant select on table public.products    to zell_definer;
grant select on table public.settings    to zell_definer;
grant select, insert on table public.orders to zell_definer;   -- SELECT للـ replay فقط
grant insert on table public.order_items to zell_definer;
grant usage  on sequence public.orders_id_seq      to zell_definer;
grant usage  on sequence public.order_items_id_seq to zell_definer;
grant execute on function public.generate_order_number(text) to zell_definer;

-- مفيش UPDATE ولا DELETE على orders/order_items إطلاقاً.

-- ---------------------------------------------------------------------
-- (3) RLS policies (zell_definer مالوش BYPASSRLS)
-- ---------------------------------------------------------------------
drop policy if exists products_read_for_definer on public.products;
create policy products_read_for_definer on public.products
  for select to zell_definer using (is_active = true);

drop policy if exists settings_read_for_definer on public.settings;
create policy settings_read_for_definer on public.settings
  for select to zell_definer
  using (key in ('shipping_rates', 'shipping_default_piastres', 'free_shipping_threshold_piastres'));

drop policy if exists orders_insert_for_definer on public.orders;
create policy orders_insert_for_definer on public.orders
  for insert to zell_definer with check (true);

-- القراءة للـ replay ولفحص الحد اليومي — من غير نافذة زمنية (التصحيح)
drop policy if exists orders_read_for_definer on public.orders;
create policy orders_read_for_definer on public.orders
  for select to zell_definer using (true);
  -- ⚠ نقطة مراجعة: `using (true)` بيدي الدور قراءة كل الطلبات.
  --   البديل الأضيق: عمودين بس عن طريق VIEW، أو فصل فحص الحد اليومي للباك إند.
  --   القرار مؤجّل — مذكور صراحةً عشان ما يعدّيش من غير انتباه.

drop policy if exists order_items_insert_for_definer on public.order_items;
create policy order_items_insert_for_definer on public.order_items
  for insert to zell_definer with check (true);

-- ---------------------------------------------------------------------
-- (4) الدالة
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_items           jsonb,
  p_customer_name   text,
  p_customer_phone  text,
  p_governorate     text,
  p_address         text,
  p_notes           text,
  p_idempotency_key text,
  p_request_hash    text     -- SHA-256 hex محسوب في الباك إند
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_per_phone_day constant integer := 5;
  c_max_items         constant integer := 20;
  c_number_tries      constant integer := 5;

  v_existing   record;
  v_rates      jsonb;
  v_default    jsonb;
  v_free       jsonb;
  v_count      integer;
  v_order      record;
  v_constraint text;
begin
  ------------------------------------------------------------------
  -- (أ) مدخلات الـ idempotency
  ------------------------------------------------------------------
  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'ZELL_IDEMPOTENCY_REQUIRED' using errcode = '45001';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_REQUEST_HASH_INVALID' using errcode = '45004';
  end if;

  ------------------------------------------------------------------
  -- (ب) التحقق من المدخلات النصّية
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

  ------------------------------------------------------------------
  -- (ج) تحقق آمن من شكل السلة **قبل** أي cast
  ------------------------------------------------------------------
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count = 0 then
    raise exception 'ZELL_CART_EMPTY' using errcode = '45024';
  end if;
  if v_count > c_max_items then
    raise exception 'ZELL_CART_TOO_LARGE' using errcode = '45025';
  end if;

  -- كل عنصر لازم يكون object فيه رقمين صحيحين موجبين
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as e
    where pg_catalog.jsonb_typeof(e) <> 'object'
       or (e ->> 'productId') is null
       or (e ->> 'lengthCm')  is null
       or (e ->> 'productId') !~ '^[1-9][0-9]{0,8}$'
       or (e ->> 'lengthCm')  !~ '^[1-9][0-9]{0,6}$'
  ) then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  ------------------------------------------------------------------
  -- (د) إعدادات الشحن (اعتمادية موثّقة)
  ------------------------------------------------------------------
  select s.value into v_rates   from public.settings s where s.key = 'shipping_rates';
  select s.value into v_default from public.settings s where s.key = 'shipping_default_piastres';
  select s.value into v_free    from public.settings s where s.key = 'free_shipping_threshold_piastres';

  if v_rates is null or v_default is null or v_free is null
     or pg_catalog.jsonb_typeof(v_rates) <> 'object'
     or pg_catalog.jsonb_typeof(v_default) <> 'number'
     or pg_catalog.jsonb_typeof(v_free) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  if not (v_rates ? coalesce(p_governorate, '')) then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  ------------------------------------------------------------------
  -- (هـ) حد يومي لكل رقم (استعلام قراءة — مش عدّاد بيتلغي مع rollback)
  ------------------------------------------------------------------
  if (select pg_catalog.count(*) from public.orders o
       where o.customer_phone = p_customer_phone
         and o.created_at > now() - interval '1 day') >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45011';
  end if;

  ------------------------------------------------------------------
  -- (و) الإنشاء الذرّي + إعادة محاولة عند تصادم رقم الطلب
  ------------------------------------------------------------------
  for attempt in 1..c_number_tries loop
    begin
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
        select (v_rates ->> p_governorate)::integer as base_piastres,
               (v_free #>> '{}')::integer          as free_threshold
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
          case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold
               then 0 else sh.base_piastres end,
          t.subtotal + case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold
               then 0 else sh.base_piastres end,
          p_idempotency_key, p_request_hash
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

      exit;  -- نجح (أو رجع صفر صفوف بسبب on conflict) — نخرج من حلقة إعادة المحاولة

    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- تصادم رقم الطلب: نعيد المحاولة. أي قيد تاني: نرفع الخطأ زي ما هو.
      if v_constraint is distinct from 'orders_order_number_key' then
        raise;
      end if;
      if attempt = c_number_tries then
        raise exception 'ZELL_ORDER_NUMBER_EXHAUSTED' using errcode = '45050';
      end if;
    end;
  end loop;

  ------------------------------------------------------------------
  -- (ز) مفيش صف: يا replay يا رفض
  ------------------------------------------------------------------
  if v_order.order_number is null then
    select o.order_number, o.request_hash, o.subtotal_piastres, o.shipping_piastres, o.total_piastres
      into v_existing
    from public.orders o
    where o.idempotency_key = p_idempotency_key;

    if v_existing.order_number is not null then
      if v_existing.request_hash is distinct from p_request_hash then
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

alter function public.create_order(jsonb, text, text, text, text, text, text, text)
  owner to zell_definer;

-- ---------------------------------------------------------------------
-- (5) الصلاحيات — PUBLIC أولاً (بيتمنح تلقائياً من المحرّك)
-- ---------------------------------------------------------------------
revoke all on function public.create_order(jsonb, text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.create_order(jsonb, text, text, text, text, text, text, text)
  to postgres;   -- الباك إند الحالي في Retool

-- لاحقاً عند الفتح العام (غير منفّذ):
--   grant execute on function public.create_order(...) to zell_order;

commit;

-- =====================================================================
-- أكواد الأخطاء الثابتة
-- =====================================================================
--  45001 ZELL_IDEMPOTENCY_REQUIRED     45003 ZELL_IDEMPOTENCY_MISMATCH
--  45004 ZELL_REQUEST_HASH_INVALID     45011 ZELL_PHONE_DAILY_LIMIT
--  45020 ZELL_INVALID_NAME             45021 ZELL_INVALID_PHONE
--  45022 ZELL_INVALID_ADDRESS          45023 ZELL_CART_INVALID
--  45024 ZELL_CART_EMPTY               45025 ZELL_CART_TOO_LARGE
--  45030 ZELL_SETTINGS_MISSING         45031 ZELL_GOVERNORATE_NOT_SERVED
--  45040 ZELL_ITEM_UNAVAILABLE         45050 ZELL_ORDER_NUMBER_EXHAUSTED

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop function if exists public.create_order(jsonb, text, text, text, text, text, text, text);
--   drop policy if exists order_items_insert_for_definer on public.order_items;
--   drop policy if exists orders_read_for_definer on public.orders;
--   drop policy if exists orders_insert_for_definer on public.orders;
--   drop policy if exists settings_read_for_definer on public.settings;
--   drop policy if exists products_read_for_definer on public.products;
--   revoke all on schema public from zell_definer;
-- commit;

-- =====================================================================
-- مؤجّل بوعي (0005d لاحقاً)
-- =====================================================================
-- تحديد المعدل المتقدم (بصمة HMAC + نافذة زمنية): **مش في الداتابيز**.
-- السبب: أي رفض = raise = rollback = العدّاد بيرجع زي ما كان.
-- المكان الصح: الباك إند/الحافة (Redis أو مخزن Retool أو WAF)، خارج الـ transaction.
-- يتصمّم منفصلاً بعد ما الدالة دي تستقر.
