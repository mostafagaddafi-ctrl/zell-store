-- اختبارات 0018 — ممنوع تتنفّذ كـmigration.
-- كل DO: بنية 0018 + zell_create_order_ptest/zell_get_order_receipt_ptest + إعداد اختبار، وكل حالة في
-- كتلة فرعية بترجع، وفي الآخر raise exception 'ZELL_PTEST {...}' فكل حاجة ترجع (ولا الـalter بيفضل).
-- الدالة الحقيقية المعدّلة مابتتناداش. الدالة الحالية بتتنادى بس في A11/B0 للمقارنة (جوه نفس الـrollback).
-- القفل: lock_timeout 3s. النتيجة المتوقعة لكل حالة:
--   A1 — فني، القاهرة/مدينة نصر (انتقال 50ج)، مصنفر 500سم → ok|60000|5000|50000|5000|120000|مدينة نصر|true|10000|500
--   A2 — فني بفيلمين (مصنفر 500 + فاميه 300) — انتقال مرة واحدة → ok|120000|5000|80000|5000|210000|مدينة نصر|true|10000|800
--   A2b — فني + سكويجي ×2 — القطعة مش داخلة في الأطوال → ok|80000|5000|50000|5000|140000|مدينة نصر|true|10000|500
--   A2c — فني + فاميه بعرض 120 (مش الأساسي) → ok|105000|5000|30000|5000|145000|مدينة نصر|true|10000|300
--   A3 — انتقال 0 (المعادي) → ok|60000|5000|50000|0|115000|المعادي|true|10000|500
--   A4 — منطقة في الشحن ومش مفعّلة للفني (التجمع الخامس) → E45032
--   A5 — منطقة مفعّلة للفني واتشالت من الشحن → E45034
--   A6a — اتغير اسمها في الشحن — بالاسم الجديد → E45032
--   A6b — اتغير اسمها في الشحن — بالاسم القديم → E45034
--   A7 — فني والمنطقة null → E45032
--   A7b — فني، الإسكندرية (من غير مناطق) بمنطقة → E45034
--   A7c — فني، الإسكندرية من غير منطقة → E45032
--   A8a — انتقال -1 → E45032
--   A8b — انتقال 1.5 → E45032
--   A8c — انتقال "50" (نص) → E45032
--   A8d — انتقال null → E45032
--   A8e — انتقال 1000001 (فوق الحد) → E45032
--   A8f — انتقال 1000000 (على الحد) → ok|60000|5000|50000|1000000|1115000|مدينة نصر|true|10000|500
--   A9 — الفني متقفل (enabled=false) → E45032
--   A10a — سعر المتر 0 → E45030
--   A10b — سعر المتر "100" (نص) → E45030
--   A10c — سعر المتر مش موجود → E45030
--   A10d — سعر المتر 1000001 → E45030
--   A10e — سعر المتر 99.5 → E45030
--   A10f — سعر المتر بايظ + طلب من غير فني → ok|60000|5000|0|0|65000|مدينة نصر|false|-|-
--   A10g — إعداد الفني مش موجود خالص + من غير فني → ok|60000|5000|0|0|65000|-|false|-|-
--   A12a — من غير فني، منطقة غلط → E45034
--   A12b — من غير فني، الإسكندرية من غير منطقة → ok|60000|7000|0|0|67000|-|false|-|-
--   A13 — الدقي مع القاهرة (من محافظة تانية) → E45034
--   A14 — أكتوبر بصيغة NFD + مسافات (الجيزة، فني 75ج) → ok|60000|8000|50000|7500|125500|أكتوبر|true|10000|500
--   A16a — حد مجاني 700ج: أصناف 600ج + تركيب 500ج → الشحن مش مجاني → ok|60000|5000|50000|5000|120000|مدينة نصر|true|10000|500
--   A16b — حد مجاني 700ج: أصناف 720ج → شحن 0 والتركيب زي ما هو → ok|72000|0|60000|5000|137000|مدينة نصر|true|10000|600
--   A21 — فني والطلب كله قطع → E45033
--   A23 — منطقة 41 حرف → E45034
--   A24a — تقريب: سعر 9999 × 350سم = 34996.5 → 34997 → ok|112000|5000|34997|5000|156997|مدينة نصر|true|9999|350
--   A24b — تقريب: سعر 9999 × 300سم = 29997 بالظبط → ok|96000|5000|29997|5000|135997|مدينة نصر|true|9999|300
--   A15 — replay بعد تغيير الانتقال لـ9999 — يرجّع المحفوظ → true|5000|120000|ok|60000|5000|50000|5000|120000|مدينة نصر|true|10000|500
--   A22 — نفس المفتاح بهاش مختلف → E45003
--   A19 — الإيصال بيرجّع أعمدة التركيب ومن غير المنطقة → true|10000|500|50000|5000|120000|false|false
--   A11 — من غير فني: _ptest بمنطقة صريحة = الدالة الحالية بالمنطقة في العنوان → 165000|5000|170000 = 165000|5000|170000
--   B0 — الدالة الحالية (10 معاملات) على الجدول الجديد — الأعمدة الجديدة بالـdefault → ok|60000|5000|0|0|65000|-|false|-|-
--   A17a — insert مباشر: إجمالي مش متسق → E23514
--   A17b — insert مباشر: فني من غير منطقة → E23514
--   A17c — insert مباشر: أجر تركيب مش = السعر × الطول → E23514

do $ztest$
declare r jsonb; rc jsonb; v_out text; res jsonb := '{}'::jsonb;
        k text; k2 text; h1 text; h2 text; h3 text; h4 text;
begin
  perform pg_catalog.set_config('lock_timeout', '3000', true);
  perform pg_catalog.set_config('statement_timeout', '30000', true);
  execute $zts0$alter table public.orders
  add column if not exists shipping_area text,
  add column if not exists installation_requested boolean not null default false,
  add column if not exists installation_rate_piastres integer,
  add column if not exists installation_length_cm integer,
  add column if not exists installation_piastres integer not null default 0,
  add column if not exists installation_travel_piastres integer not null default 0$zts0$;
  execute $zts1$alter table public.orders
  drop constraint if exists orders_shipping_area_shape,
  drop constraint if exists orders_installation_shape,
  drop constraint if exists orders_total_consistent,
  add constraint orders_shipping_area_shape check (
    shipping_area is null
    or (char_length(shipping_area) between 1 and 40 and shipping_area = btrim(shipping_area))
  ),
  add constraint orders_installation_shape check (
    (installation_requested = false
       and installation_rate_piastres is null
       and installation_length_cm is null
       and installation_piastres = 0
       and installation_travel_piastres = 0)
    or
    (installation_requested = true
       and shipping_area is not null
       and installation_rate_piastres between 1 and 1000000
       and installation_length_cm > 0
       and installation_piastres = round((installation_rate_piastres::numeric * installation_length_cm::numeric) / 100.0)
       and installation_travel_piastres between 0 and 1000000)
  ),
  add constraint orders_total_consistent check (
    total_piastres::bigint = subtotal_piastres::bigint + shipping_piastres::bigint
                           + installation_piastres::bigint + installation_travel_piastres::bigint
  )$zts1$;
  execute $zts2$CREATE OR REPLACE FUNCTION public.zell_create_order_ptest(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_alphabet          constant text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c_max_items         constant integer := 20;
  c_max_notes         constant integer := 500;
  c_max_per_phone_day constant integer := 5;
  c_number_tries      constant integer := 5;
  c_receipt_days      constant integer := 7;
  c_int4_max          constant numeric := 2147483647;
  c_lock_ns           constant integer := 1951;

  v_lock_key    integer;
  v_req_count   integer;
  v_rates       jsonb;
  v_free        jsonb;
  v_disabled    jsonb;
  v_num         numeric;
  v_base        integer;
  v_threshold   integer;
  v_phone_count integer;
  v_order_no    text;
  v_order       record;
  v_existing    record;
  v_constraint  text;
  v_valid_count integer;
  v_subtotal    numeric;
  v_shipping    numeric;
  v_attempt     integer;
  -- 0018: المنطقة + فني التركيب
  c_max_area          constant integer := 40;
  c_money_cap         constant numeric := 1000000;
  v_install     boolean;
  v_area        text;
  v_areas       jsonb;
  v_inst        jsonb;
  v_travel_j    jsonb;
  v_rate        integer;
  v_travel      integer;
  v_inst_cm     numeric;
  v_inst_fee    numeric;
begin
  ------------------------------------------------------------------
  -- (أ) فحوصات ثابتة بلا داتابيز: المفتاح والهاشات التلاتة
  ------------------------------------------------------------------
  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'ZELL_IDEMPOTENCY_REQUIRED' using errcode = '45001';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_REQUEST_HASH_INVALID' using errcode = '45004';
  end if;
  if p_checkout_session_hash is null or p_checkout_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_SESSION_HASH_INVALID' using errcode = '45005';
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_RECEIPT_HASH_INVALID' using errcode = '45006';
  end if;

  ------------------------------------------------------------------
  -- (ب) الموبايل — مفتاح التسلسل في (ج) فلازم يسبق الحسم
  ------------------------------------------------------------------
  if coalesce(p_customer_phone, '') !~ '^01[0125][0-9]{8}$' then
    raise exception 'ZELL_INVALID_PHONE' using errcode = '45021';
  end if;

  ------------------------------------------------------------------
  -- (ج) تسلسل لكل رقم موبايل — قفل على مستوى المعاملة
  ------------------------------------------------------------------
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_customer_phone), 1, 8))::bit(32)::integer;
  perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_lock_key);

  ------------------------------------------------------------------
  -- (د) حسم الـidempotency — قبل أي فحص مُتغيّر
  --
  --     ⚠ 0006c: الـselect بقى بياخد receipt_expires_at كمان عشان الإسقاط.
  ------------------------------------------------------------------
  select o.order_number, o.request_hash, o.checkout_session_hash,
         o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
         o.receipt_expires_at,
         -- 0018
         o.shipping_area, o.installation_requested,
         o.installation_piastres, o.installation_travel_piastres
    into v_existing
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if v_existing.order_number is not null then

    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
    end if;

    if v_existing.checkout_session_hash is distinct from p_checkout_session_hash then
      raise exception 'ZELL_REPLAY_NOT_AUTHORIZED' using errcode = '45007';
    end if;

    -- replay مُصرَّح: تدوير بخانتين.
    -- ⚠ receipt_expires_at **غير مذكور** في الـupdate عن قصد — النافذة مربوطة
    --   بلحظة الإنشاء ومفيش أي طرف يقدر يمدّها. ده أهم سطر في الملف.
    update public.orders
       set receipt_token_hash_prev = receipt_token_hash,
           receipt_token_hash      = p_receipt_token_hash,
           updated_at              = pg_catalog.now()
     where idempotency_key = p_idempotency_key;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'order_number', v_existing.order_number,
      'subtotal_piastres', v_existing.subtotal_piastres,
      'shipping_piastres', v_existing.shipping_piastres,
      'total_piastres', v_existing.total_piastres,
      -- 0018: اللقطة المحفوظة — مش محسوبة تاني
      'shipping_area', v_existing.shipping_area,
      'installation_requested', v_existing.installation_requested,
      'installation_piastres', v_existing.installation_piastres,
      'installation_travel_piastres', v_existing.installation_travel_piastres,
      -- 0006c: القيمة **الأصلية** من وقت الإنشاء، مش محسوبة من now()
      'receipt_expires_at', v_existing.receipt_expires_at);
  end if;

  ------------------------------------------------------------------
  -- (هـ) باقي الفحوصات الثابتة
  ------------------------------------------------------------------
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_customer_name, ''))) < 3 then
    raise exception 'ZELL_INVALID_NAME' using errcode = '45020';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_address, ''))) < 8 then
    raise exception 'ZELL_INVALID_ADDRESS' using errcode = '45022';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > c_max_notes then
    raise exception 'ZELL_NOTES_TOO_LONG' using errcode = '45026';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  v_req_count := pg_catalog.jsonb_array_length(p_items);
  if v_req_count = 0 then
    raise exception 'ZELL_CART_EMPTY' using errcode = '45024';
  end if;
  if v_req_count > c_max_items then
    raise exception 'ZELL_CART_TOO_LARGE' using errcode = '45025';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as e
    where pg_catalog.jsonb_typeof(e) <> 'object'
       or (e ->> 'productId') is null
       or (e ->> 'productId') !~ '^[1-9][0-9]{0,8}$'
       -- 0016: الصنف يا بالطول (متر) يا بالعدد (قطعة) — واحد بس منهم
       or ((e ->> 'lengthCm') is null) = ((e ->> 'quantity') is null)
       or ((e ->> 'lengthCm') is not null and (e ->> 'lengthCm') !~ '^[1-9][0-9]{0,6}$')
       or ((e ->> 'quantity') is not null and (e ->> 'quantity') !~ '^[1-9][0-9]{0,3}$')
       or ((e ->> 'quantity') is not null and (e ->> 'widthCm') is not null)
       -- 0015: العرض اختياري — لو موجود لازم رقم صحيح موجب
       or ((e ->> 'widthCm') is not null and (e ->> 'widthCm') !~ '^[1-9][0-9]{0,6}$')
  ) then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  -- 0018: المنطقة معامل صريح (مش من نص العنوان) — NFC + trim، وفاضي = null
  v_install := coalesce(p_installation, false);
  v_area := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_area, ''), 'NFC')), '');
  if v_area is not null and pg_catalog.length(v_area) > c_max_area then
    raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
  end if;
  -- 0018: الفني على أطوال منتجات المقاس بس — طلب كله قطع مالوش تركيب
  if v_install and not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null
  ) then
    raise exception 'ZELL_INSTALLATION_NO_METERS' using errcode = '45033';
  end if;

  ------------------------------------------------------------------
  -- (و) إعدادات الشحن + المحافظة
  ------------------------------------------------------------------
  select s.value into v_rates    from public.settings s where s.key = 'shipping_rates';
  select s.value into v_free     from public.settings s where s.key = 'free_shipping_threshold_piastres';
  select s.value into v_disabled from public.settings s where s.key = 'shipping_disabled_governorates';

  if v_rates is null or v_free is null or v_disabled is null
     or pg_catalog.jsonb_typeof(v_rates)    <> 'object'
     or pg_catalog.jsonb_typeof(v_free)     <> 'number'
     or pg_catalog.jsonb_typeof(v_disabled) <> 'array' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  if not (v_rates ? coalesce(p_governorate, ''))
     or v_disabled ? coalesce(p_governorate, '') then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  v_num := (v_rates ->> p_governorate)::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_base := v_num::integer;

  v_num := (v_free #>> '{}')::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_threshold := v_num::integer;

  ------------------------------------------------------------------
  -- (و٢) 0018: المنطقة لازم تكون من مناطق الشحن للمحافظة دي
  ------------------------------------------------------------------
  if v_area is not null then
    select s.value into v_areas from public.settings s where s.key = 'shipping_areas';
    if v_areas is null
       or pg_catalog.jsonb_typeof(v_areas) <> 'object'
       or pg_catalog.jsonb_typeof(v_areas -> p_governorate) is distinct from 'array'
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_areas -> p_governorate) as a
         where pg_catalog.jsonb_typeof(a) = 'string'
           and pg_catalog.btrim(pg_catalog.normalize(a #>> '{}', 'NFC')) = v_area
       ) then
      raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
    end if;
  end if;

  ------------------------------------------------------------------
  -- (و٣) 0018: فني التركيب — بيتقري بس لو مطلوب، فالطلب العادي مابيتأثرش بإعداده
  ------------------------------------------------------------------
  if v_install then
    select s.value into v_inst from public.settings s where s.key = 'installation';
    if v_area is null
       or v_inst is null
       or pg_catalog.jsonb_typeof(v_inst) <> 'object'
       or pg_catalog.jsonb_typeof(v_inst -> 'enabled') is distinct from 'boolean'
       or (v_inst ->> 'enabled') <> 'true' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;

    if pg_catalog.jsonb_typeof(v_inst -> 'feePerMeterPiastres') is distinct from 'number' then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_num := (v_inst ->> 'feePerMeterPiastres')::numeric;
    if v_num < 1 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_rate := v_num::integer;

    -- الانتقال لكل منطقة: رقم صحيح 0..الحد، وغير كده = الفني مش متاح هناك
    v_travel_j := null;
    if pg_catalog.jsonb_typeof(v_inst #> array['areas', p_governorate]) = 'object' then
      select t.value into v_travel_j
      from pg_catalog.jsonb_each(v_inst #> array['areas', p_governorate]) as t
      where pg_catalog.btrim(pg_catalog.normalize(t.key, 'NFC')) = v_area
      limit 1;
    end if;
    if v_travel_j is null or pg_catalog.jsonb_typeof(v_travel_j) <> 'number' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_num := (v_travel_j #>> '{}')::numeric;
    if v_num < 0 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_travel := v_num::integer;
  end if;

  ------------------------------------------------------------------
  -- (ز) نافذة الموبايل — محمية بالقفل من (ج)
  --
  --     ⚠ مفيش فلتر على status عن قصد: الطلبات الملغية ('cancelled')
  --       **بتتحسب**. الحد حماية من الإساءة، ولو الإلغاء بيصفّر العدّاد يبقى
  --       أي مهاجم يقدر يلف عليه. ممنوع تغيير ده بصمت (§5.2).
  ------------------------------------------------------------------
  select pg_catalog.count(*)::integer into v_phone_count
  from public.orders o
  where o.customer_phone = p_customer_phone
    and o.created_at >= pg_catalog.now() - interval '24 hours';

  if v_phone_count >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45041';
  end if;

  ------------------------------------------------------------------
  -- (ح) الإدخال — عبارة CTE واحدة، مع إعادة المحاولة على تصادم الرقم
  ------------------------------------------------------------------
  for v_attempt in 1..c_number_tries loop
    begin
      select 'FLM-' || pg_catalog.string_agg(
               pg_catalog.substr(
                 c_alphabet,
                 (('x' || pg_catalog.substr(h.hex, 1 + (i - 1) * 2, 2))::bit(8)::integer % 32) + 1,
                 1),
               '' order by i)
        into v_order_no
      from (select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as hex) h,
           pg_catalog.generate_series(1, 6) as i;

      with req as (
        select (e ->> 'productId')::integer as product_id,
               (e ->> 'lengthCm')::integer  as length_cm,
               (e ->> 'widthCm')::integer   as width_cm,
               (e ->> 'quantity')::integer  as quantity
        from pg_catalog.jsonb_array_elements(p_items) as e
      ),
      priced as (
        -- 0015: عرض غير الأساسي = لازم صف شغّال في product_widths، والسعر منه.
        --       من غير عرض (أو العرض الأساسي) = نفس الحساب القديم بالحرف.
        -- 0016: المتر لمنتجات المتر بس، والقطعة فرع لوحده تحت.
        select p.id   as product_id,
               p.name_ar,
               p.image_url,
               coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres) as price_per_meter_piastres,
               coalesce(w.width_cm, p.width_cm) as width_cm,
               r.length_cm,
               1 as quantity,
               'meter'::text as sale_unit,
               pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric
                                 * r.length_cm::numeric) / 100.0) as line_total
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'meter'
         and r.length_cm between p.min_length_cm and p.max_length_cm
         and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
        left join public.product_widths w
          on w.product_id = p.id
         and w.width_cm = r.width_cm
         and w.is_active
         and r.width_cm <> p.width_cm
        where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
        union all
        -- 0016: القطعة — سعر المنتج × العدد، والعدد من ١ لأقصى عدد المنتج
        select p.id,
               p.name_ar,
               p.image_url,
               p.price_per_meter_piastres,
               null::integer,
               null::integer,
               r.quantity,
               'piece'::text,
               (p.price_per_meter_piastres::numeric * r.quantity::numeric)
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'piece'
         and r.quantity is not null
         and r.quantity between 1 and p.max_quantity
      ),
      totals as (
        select coalesce(pg_catalog.sum(line_total), 0)::numeric as subtotal,
               pg_catalog.count(*)::integer                     as ok_count
        from priced
      ),
      ship as (
        select t.subtotal,
               t.ok_count,
               case when v_threshold > 0 and t.subtotal >= v_threshold
                    then 0::numeric else v_base::numeric end as shipping
        from totals t
      ),
      -- 0018: أجر التركيب على مجموع أطوال المقاس المعتمدة (من priced) + الانتقال مرة واحدة
      fees as (
        select s.subtotal,
               s.ok_count,
               s.shipping,
               i.cm as inst_cm,
               case when v_install
                    then pg_catalog.round((v_rate::numeric * i.cm) / 100.0)
                    else 0::numeric end as inst_fee,
               case when v_install then v_travel::numeric else 0::numeric end as travel
        from ship s
        cross join (
          select coalesce(pg_catalog.sum(pr.length_cm) filter (where pr.sale_unit = 'meter'), 0)::numeric as cm
          from priced pr
        ) i
      ),
      new_order as (
        insert into public.orders (
          order_number, customer_name, customer_phone, governorate, address, notes,
          subtotal_piastres, shipping_piastres, total_piastres,
          idempotency_key, request_hash, checkout_session_hash,
          receipt_token_hash, receipt_expires_at,
          -- 0018
          shipping_area, installation_requested, installation_rate_piastres,
          installation_length_cm, installation_piastres, installation_travel_piastres
        )
        select
          v_order_no,
          pg_catalog.btrim(p_customer_name),
          p_customer_phone,
          p_governorate,
          pg_catalog.btrim(p_address),
          nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
          s.subtotal::integer,
          s.shipping::integer,
          (s.subtotal + s.shipping + s.inst_fee + s.travel)::integer,
          p_idempotency_key,
          p_request_hash,
          p_checkout_session_hash,
          p_receipt_token_hash,
          pg_catalog.now() + (c_receipt_days || ' days')::interval,
          v_area,
          v_install,
          case when v_install then v_rate end,
          case when v_install then s.inst_cm::integer end,
          s.inst_fee::integer,
          s.travel::integer
        from fees s
        where s.ok_count > 0
          and s.ok_count = v_req_count
          and s.subtotal >= 0
          and (s.subtotal + s.shipping + s.inst_fee + s.travel) <= c_int4_max
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        -- ⚠ 0006c: receipt_expires_at مضاف للـreturning
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres,
                  receipt_expires_at,
                  shipping_area, installation_requested, installation_piastres, installation_travel_piastres
      ),
      items_ins as (
        insert into public.order_items (
          order_id, product_id, product_name_ar, product_image_url,
          unit_price_piastres, length_cm, width_cm, line_total_piastres,
          sale_unit, quantity
        )
        select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
               pr.length_cm, pr.width_cm, pr.line_total::integer,
               pr.sale_unit, pr.quantity
        from new_order o cross join priced pr
        returning order_id
      )
      -- items_ins مش مُشار إليه عن قصد: عبارات التعديل جوه WITH بتتنفّذ مرة
      -- واحدة وبالكامل بغضّ النظر عن قراءة مخرجاتها.
      select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
             o.receipt_expires_at,
             o.shipping_area, o.installation_requested, o.installation_piastres, o.installation_travel_piastres
        into v_order
      from new_order o;

      exit;

    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'orders_order_number_key' then
        raise;
      end if;
      if v_attempt = c_number_tries then
        raise exception 'ZELL_ORDER_NUMBER_EXHAUSTED' using errcode = '45050';
      end if;
    end;
  end loop;

  ------------------------------------------------------------------
  -- (ط) النتيجة
  ------------------------------------------------------------------
  if v_order.order_number is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', false,
      'order_number', v_order.order_number,
      'subtotal_piastres', v_order.subtotal_piastres,
      'shipping_piastres', v_order.shipping_piastres,
      'total_piastres', v_order.total_piastres,
      -- 0018
      'shipping_area', v_order.shipping_area,
      'installation_requested', v_order.installation_requested,
      'installation_piastres', v_order.installation_piastres,
      'installation_travel_piastres', v_order.installation_travel_piastres,
      -- 0006c: القيمة المخزّنة فعلاً، جاية من RETURNING مش محسوبة تاني
      'receipt_expires_at', v_order.receipt_expires_at);
  end if;

  -- 0016: نفس قواعد الصلاحية بالظبط — متر + قطعة
  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(x.line_total), 0)
    into v_valid_count, v_subtotal
  from (
    select pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric * r.length_cm::numeric) / 100.0) as line_total
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'meter'
     and r.length_cm between p.min_length_cm and p.max_length_cm
     and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
    left join public.product_widths w
      on w.product_id = p.id
     and w.width_cm = r.width_cm
     and w.is_active
     and r.width_cm <> p.width_cm
    where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
    union all
    select (p.price_per_meter_piastres::numeric * r.quantity::numeric)
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'piece'
     and r.quantity is not null
     and r.quantity between 1 and p.max_quantity
  ) x;

  if v_valid_count <> v_req_count then
    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  v_shipping := case when v_threshold > 0 and v_subtotal >= v_threshold
                     then 0::numeric else v_base::numeric end;
  -- 0018: نفس التركيب والانتقال — كل الأصناف صالحة هنا، فأطوال المقاس = كل lengthCm
  v_inst_fee := 0;
  if v_install then
    select coalesce(pg_catalog.sum((e ->> 'lengthCm')::numeric), 0) into v_inst_cm
    from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null;
    v_inst_fee := pg_catalog.round((v_rate::numeric * v_inst_cm) / 100.0) + v_travel::numeric;
  end if;
  if (v_subtotal + v_shipping + v_inst_fee) > c_int4_max then
    raise exception 'ZELL_PRICE_OUT_OF_RANGE' using errcode = '45027';
  end if;

  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$function$$zts2$;
  execute $zts3$CREATE OR REPLACE FUNCTION public.zell_get_order_receipt_ptest(p_order_number text, p_receipt_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
begin
  -- أي مدخل مش مطابق للشكل = null. **نفس** نتيجة «مش موجود» بالظبط،
  -- عشان الدالة ما تبقاش oracle لتعداد أرقام الطلبات.
  if p_order_number is null
     or p_order_number !~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    return null;
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select o.id,
         o.order_number,
         o.subtotal_piastres,
         o.shipping_piastres,
         o.total_piastres,
         -- 0018 (المنطقة مش بترجع: جزء من العنوان)
         o.installation_requested,
         o.installation_rate_piastres,
         o.installation_length_cm,
         o.installation_piastres,
         o.installation_travel_piastres,
         o.created_at,
         o.governorate,
         pg_catalog.split_part(pg_catalog.btrim(o.customer_name), ' ', 1) as first_name,
         pg_catalog.right(o.customer_phone, 4)                            as phone_last4
    into v_row
  from public.orders o
  where o.order_number = p_order_number
    and o.receipt_expires_at is not null
    and o.receipt_expires_at > pg_catalog.now()
    -- الخانتين صالحتين (الحالية والسابقة) — ترتيب وصول الردود مش مهم.
    and (p_receipt_token_hash = o.receipt_token_hash
      or p_receipt_token_hash = o.receipt_token_hash_prev);

  if v_row.order_number is null then
    return null;
  end if;

  -- ممنوع يرجع: address (ولا جزء منه) · customer_phone كامل · internal_notes
  -- · notes · notified_at · notify_error · status · أي *_hash · idempotency_key
  return pg_catalog.jsonb_build_object(
    'order_number',      v_row.order_number,
    'created_at',        v_row.created_at,
    'governorate',       v_row.governorate,
    'first_name',        v_row.first_name,
    'phone_last4',       v_row.phone_last4,
    'subtotal_piastres', v_row.subtotal_piastres,
    'shipping_piastres', v_row.shipping_piastres,
    'total_piastres',    v_row.total_piastres,
    -- 0018
    'installation_requested',       v_row.installation_requested,
    'installation_rate_piastres',   v_row.installation_rate_piastres,
    'installation_length_cm',       v_row.installation_length_cm,
    'installation_piastres',        v_row.installation_piastres,
    'installation_travel_piastres', v_row.installation_travel_piastres,
    'items', (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'product_name_ar',     i.product_name_ar,
                   'length_cm',           i.length_cm,
                   'width_cm',            i.width_cm,
                   'line_total_piastres', i.line_total_piastres,
                   -- 0016: القطعة = عدد من غير طول/عرض
                   'quantity',            i.quantity,
                   'sale_unit',           i.sale_unit)
                 order by i.id),
               '[]'::jsonb)
      from public.order_items i
      where i.order_id = v_row.id
    ));
end;
$function$$zts3$;
  update public.settings set value = '{"enabled":true,"note":"","feePerMeterPiastres":10000,"areas":{"القاهرة":{"مدينة نصر":5000,"المعادي":0},"الجيزة":{"الدقي":5000,"أكتوبر":7500}},"governorates":["القاهرة","الجيزة"]}'::jsonb where key = 'installation';
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100002', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A1', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A1', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500},{"productId":3,"lengthCm":300}]'::jsonb, 'تجربة اختبار', '01599100003', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A2', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A2', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500},{"productId":21,"quantity":2}]'::jsonb, 'تجربة اختبار', '01599100004', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A2b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A2b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":3,"lengthCm":300,"widthCm":120}]'::jsonb, 'تجربة اختبار', '01599100005', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A2c', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A2c', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100006', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'المعادي', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A3', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A3', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100007', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'التجمع الخامس', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A4', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A4', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{القاهرة}', (value -> 'القاهرة') - 'مدينة نصر') where key = 'shipping_areas';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100008', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A5', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A5', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{القاهرة}', ((value -> 'القاهرة') - 'مدينة نصر') || '["مدينة نصر الجديدة"]'::jsonb) where key = 'shipping_areas';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100009', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر الجديدة', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A6a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A6a', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{القاهرة}', ((value -> 'القاهرة') - 'مدينة نصر') || '["مدينة نصر الجديدة"]'::jsonb) where key = 'shipping_areas';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100010', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A6b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A6b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100011', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, null, true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A7', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A7', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100012', 'الإسكندرية',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'سموحة', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A7b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A7b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100013', 'الإسكندرية',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, null, true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A7c', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A7c', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '-1'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100014', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8a', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '1.5'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100015', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8b', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '"50"'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100016', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8c', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8c', 'E' || SQLSTATE);
  end;
  raise exception 'ZELL_PTEST %', res::text;
end $ztest$;

do $ztest$
declare r jsonb; rc jsonb; v_out text; res jsonb := '{}'::jsonb;
        k text; k2 text; h1 text; h2 text; h3 text; h4 text;
begin
  perform pg_catalog.set_config('lock_timeout', '3000', true);
  perform pg_catalog.set_config('statement_timeout', '30000', true);
  execute $zts0$alter table public.orders
  add column if not exists shipping_area text,
  add column if not exists installation_requested boolean not null default false,
  add column if not exists installation_rate_piastres integer,
  add column if not exists installation_length_cm integer,
  add column if not exists installation_piastres integer not null default 0,
  add column if not exists installation_travel_piastres integer not null default 0$zts0$;
  execute $zts1$alter table public.orders
  drop constraint if exists orders_shipping_area_shape,
  drop constraint if exists orders_installation_shape,
  drop constraint if exists orders_total_consistent,
  add constraint orders_shipping_area_shape check (
    shipping_area is null
    or (char_length(shipping_area) between 1 and 40 and shipping_area = btrim(shipping_area))
  ),
  add constraint orders_installation_shape check (
    (installation_requested = false
       and installation_rate_piastres is null
       and installation_length_cm is null
       and installation_piastres = 0
       and installation_travel_piastres = 0)
    or
    (installation_requested = true
       and shipping_area is not null
       and installation_rate_piastres between 1 and 1000000
       and installation_length_cm > 0
       and installation_piastres = round((installation_rate_piastres::numeric * installation_length_cm::numeric) / 100.0)
       and installation_travel_piastres between 0 and 1000000)
  ),
  add constraint orders_total_consistent check (
    total_piastres::bigint = subtotal_piastres::bigint + shipping_piastres::bigint
                           + installation_piastres::bigint + installation_travel_piastres::bigint
  )$zts1$;
  execute $zts2$CREATE OR REPLACE FUNCTION public.zell_create_order_ptest(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_alphabet          constant text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c_max_items         constant integer := 20;
  c_max_notes         constant integer := 500;
  c_max_per_phone_day constant integer := 5;
  c_number_tries      constant integer := 5;
  c_receipt_days      constant integer := 7;
  c_int4_max          constant numeric := 2147483647;
  c_lock_ns           constant integer := 1951;

  v_lock_key    integer;
  v_req_count   integer;
  v_rates       jsonb;
  v_free        jsonb;
  v_disabled    jsonb;
  v_num         numeric;
  v_base        integer;
  v_threshold   integer;
  v_phone_count integer;
  v_order_no    text;
  v_order       record;
  v_existing    record;
  v_constraint  text;
  v_valid_count integer;
  v_subtotal    numeric;
  v_shipping    numeric;
  v_attempt     integer;
  -- 0018: المنطقة + فني التركيب
  c_max_area          constant integer := 40;
  c_money_cap         constant numeric := 1000000;
  v_install     boolean;
  v_area        text;
  v_areas       jsonb;
  v_inst        jsonb;
  v_travel_j    jsonb;
  v_rate        integer;
  v_travel      integer;
  v_inst_cm     numeric;
  v_inst_fee    numeric;
begin
  ------------------------------------------------------------------
  -- (أ) فحوصات ثابتة بلا داتابيز: المفتاح والهاشات التلاتة
  ------------------------------------------------------------------
  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'ZELL_IDEMPOTENCY_REQUIRED' using errcode = '45001';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_REQUEST_HASH_INVALID' using errcode = '45004';
  end if;
  if p_checkout_session_hash is null or p_checkout_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_SESSION_HASH_INVALID' using errcode = '45005';
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_RECEIPT_HASH_INVALID' using errcode = '45006';
  end if;

  ------------------------------------------------------------------
  -- (ب) الموبايل — مفتاح التسلسل في (ج) فلازم يسبق الحسم
  ------------------------------------------------------------------
  if coalesce(p_customer_phone, '') !~ '^01[0125][0-9]{8}$' then
    raise exception 'ZELL_INVALID_PHONE' using errcode = '45021';
  end if;

  ------------------------------------------------------------------
  -- (ج) تسلسل لكل رقم موبايل — قفل على مستوى المعاملة
  ------------------------------------------------------------------
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_customer_phone), 1, 8))::bit(32)::integer;
  perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_lock_key);

  ------------------------------------------------------------------
  -- (د) حسم الـidempotency — قبل أي فحص مُتغيّر
  --
  --     ⚠ 0006c: الـselect بقى بياخد receipt_expires_at كمان عشان الإسقاط.
  ------------------------------------------------------------------
  select o.order_number, o.request_hash, o.checkout_session_hash,
         o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
         o.receipt_expires_at,
         -- 0018
         o.shipping_area, o.installation_requested,
         o.installation_piastres, o.installation_travel_piastres
    into v_existing
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if v_existing.order_number is not null then

    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
    end if;

    if v_existing.checkout_session_hash is distinct from p_checkout_session_hash then
      raise exception 'ZELL_REPLAY_NOT_AUTHORIZED' using errcode = '45007';
    end if;

    -- replay مُصرَّح: تدوير بخانتين.
    -- ⚠ receipt_expires_at **غير مذكور** في الـupdate عن قصد — النافذة مربوطة
    --   بلحظة الإنشاء ومفيش أي طرف يقدر يمدّها. ده أهم سطر في الملف.
    update public.orders
       set receipt_token_hash_prev = receipt_token_hash,
           receipt_token_hash      = p_receipt_token_hash,
           updated_at              = pg_catalog.now()
     where idempotency_key = p_idempotency_key;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'order_number', v_existing.order_number,
      'subtotal_piastres', v_existing.subtotal_piastres,
      'shipping_piastres', v_existing.shipping_piastres,
      'total_piastres', v_existing.total_piastres,
      -- 0018: اللقطة المحفوظة — مش محسوبة تاني
      'shipping_area', v_existing.shipping_area,
      'installation_requested', v_existing.installation_requested,
      'installation_piastres', v_existing.installation_piastres,
      'installation_travel_piastres', v_existing.installation_travel_piastres,
      -- 0006c: القيمة **الأصلية** من وقت الإنشاء، مش محسوبة من now()
      'receipt_expires_at', v_existing.receipt_expires_at);
  end if;

  ------------------------------------------------------------------
  -- (هـ) باقي الفحوصات الثابتة
  ------------------------------------------------------------------
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_customer_name, ''))) < 3 then
    raise exception 'ZELL_INVALID_NAME' using errcode = '45020';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_address, ''))) < 8 then
    raise exception 'ZELL_INVALID_ADDRESS' using errcode = '45022';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > c_max_notes then
    raise exception 'ZELL_NOTES_TOO_LONG' using errcode = '45026';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  v_req_count := pg_catalog.jsonb_array_length(p_items);
  if v_req_count = 0 then
    raise exception 'ZELL_CART_EMPTY' using errcode = '45024';
  end if;
  if v_req_count > c_max_items then
    raise exception 'ZELL_CART_TOO_LARGE' using errcode = '45025';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as e
    where pg_catalog.jsonb_typeof(e) <> 'object'
       or (e ->> 'productId') is null
       or (e ->> 'productId') !~ '^[1-9][0-9]{0,8}$'
       -- 0016: الصنف يا بالطول (متر) يا بالعدد (قطعة) — واحد بس منهم
       or ((e ->> 'lengthCm') is null) = ((e ->> 'quantity') is null)
       or ((e ->> 'lengthCm') is not null and (e ->> 'lengthCm') !~ '^[1-9][0-9]{0,6}$')
       or ((e ->> 'quantity') is not null and (e ->> 'quantity') !~ '^[1-9][0-9]{0,3}$')
       or ((e ->> 'quantity') is not null and (e ->> 'widthCm') is not null)
       -- 0015: العرض اختياري — لو موجود لازم رقم صحيح موجب
       or ((e ->> 'widthCm') is not null and (e ->> 'widthCm') !~ '^[1-9][0-9]{0,6}$')
  ) then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  -- 0018: المنطقة معامل صريح (مش من نص العنوان) — NFC + trim، وفاضي = null
  v_install := coalesce(p_installation, false);
  v_area := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_area, ''), 'NFC')), '');
  if v_area is not null and pg_catalog.length(v_area) > c_max_area then
    raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
  end if;
  -- 0018: الفني على أطوال منتجات المقاس بس — طلب كله قطع مالوش تركيب
  if v_install and not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null
  ) then
    raise exception 'ZELL_INSTALLATION_NO_METERS' using errcode = '45033';
  end if;

  ------------------------------------------------------------------
  -- (و) إعدادات الشحن + المحافظة
  ------------------------------------------------------------------
  select s.value into v_rates    from public.settings s where s.key = 'shipping_rates';
  select s.value into v_free     from public.settings s where s.key = 'free_shipping_threshold_piastres';
  select s.value into v_disabled from public.settings s where s.key = 'shipping_disabled_governorates';

  if v_rates is null or v_free is null or v_disabled is null
     or pg_catalog.jsonb_typeof(v_rates)    <> 'object'
     or pg_catalog.jsonb_typeof(v_free)     <> 'number'
     or pg_catalog.jsonb_typeof(v_disabled) <> 'array' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  if not (v_rates ? coalesce(p_governorate, ''))
     or v_disabled ? coalesce(p_governorate, '') then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  v_num := (v_rates ->> p_governorate)::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_base := v_num::integer;

  v_num := (v_free #>> '{}')::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_threshold := v_num::integer;

  ------------------------------------------------------------------
  -- (و٢) 0018: المنطقة لازم تكون من مناطق الشحن للمحافظة دي
  ------------------------------------------------------------------
  if v_area is not null then
    select s.value into v_areas from public.settings s where s.key = 'shipping_areas';
    if v_areas is null
       or pg_catalog.jsonb_typeof(v_areas) <> 'object'
       or pg_catalog.jsonb_typeof(v_areas -> p_governorate) is distinct from 'array'
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_areas -> p_governorate) as a
         where pg_catalog.jsonb_typeof(a) = 'string'
           and pg_catalog.btrim(pg_catalog.normalize(a #>> '{}', 'NFC')) = v_area
       ) then
      raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
    end if;
  end if;

  ------------------------------------------------------------------
  -- (و٣) 0018: فني التركيب — بيتقري بس لو مطلوب، فالطلب العادي مابيتأثرش بإعداده
  ------------------------------------------------------------------
  if v_install then
    select s.value into v_inst from public.settings s where s.key = 'installation';
    if v_area is null
       or v_inst is null
       or pg_catalog.jsonb_typeof(v_inst) <> 'object'
       or pg_catalog.jsonb_typeof(v_inst -> 'enabled') is distinct from 'boolean'
       or (v_inst ->> 'enabled') <> 'true' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;

    if pg_catalog.jsonb_typeof(v_inst -> 'feePerMeterPiastres') is distinct from 'number' then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_num := (v_inst ->> 'feePerMeterPiastres')::numeric;
    if v_num < 1 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_rate := v_num::integer;

    -- الانتقال لكل منطقة: رقم صحيح 0..الحد، وغير كده = الفني مش متاح هناك
    v_travel_j := null;
    if pg_catalog.jsonb_typeof(v_inst #> array['areas', p_governorate]) = 'object' then
      select t.value into v_travel_j
      from pg_catalog.jsonb_each(v_inst #> array['areas', p_governorate]) as t
      where pg_catalog.btrim(pg_catalog.normalize(t.key, 'NFC')) = v_area
      limit 1;
    end if;
    if v_travel_j is null or pg_catalog.jsonb_typeof(v_travel_j) <> 'number' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_num := (v_travel_j #>> '{}')::numeric;
    if v_num < 0 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_travel := v_num::integer;
  end if;

  ------------------------------------------------------------------
  -- (ز) نافذة الموبايل — محمية بالقفل من (ج)
  --
  --     ⚠ مفيش فلتر على status عن قصد: الطلبات الملغية ('cancelled')
  --       **بتتحسب**. الحد حماية من الإساءة، ولو الإلغاء بيصفّر العدّاد يبقى
  --       أي مهاجم يقدر يلف عليه. ممنوع تغيير ده بصمت (§5.2).
  ------------------------------------------------------------------
  select pg_catalog.count(*)::integer into v_phone_count
  from public.orders o
  where o.customer_phone = p_customer_phone
    and o.created_at >= pg_catalog.now() - interval '24 hours';

  if v_phone_count >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45041';
  end if;

  ------------------------------------------------------------------
  -- (ح) الإدخال — عبارة CTE واحدة، مع إعادة المحاولة على تصادم الرقم
  ------------------------------------------------------------------
  for v_attempt in 1..c_number_tries loop
    begin
      select 'FLM-' || pg_catalog.string_agg(
               pg_catalog.substr(
                 c_alphabet,
                 (('x' || pg_catalog.substr(h.hex, 1 + (i - 1) * 2, 2))::bit(8)::integer % 32) + 1,
                 1),
               '' order by i)
        into v_order_no
      from (select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as hex) h,
           pg_catalog.generate_series(1, 6) as i;

      with req as (
        select (e ->> 'productId')::integer as product_id,
               (e ->> 'lengthCm')::integer  as length_cm,
               (e ->> 'widthCm')::integer   as width_cm,
               (e ->> 'quantity')::integer  as quantity
        from pg_catalog.jsonb_array_elements(p_items) as e
      ),
      priced as (
        -- 0015: عرض غير الأساسي = لازم صف شغّال في product_widths، والسعر منه.
        --       من غير عرض (أو العرض الأساسي) = نفس الحساب القديم بالحرف.
        -- 0016: المتر لمنتجات المتر بس، والقطعة فرع لوحده تحت.
        select p.id   as product_id,
               p.name_ar,
               p.image_url,
               coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres) as price_per_meter_piastres,
               coalesce(w.width_cm, p.width_cm) as width_cm,
               r.length_cm,
               1 as quantity,
               'meter'::text as sale_unit,
               pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric
                                 * r.length_cm::numeric) / 100.0) as line_total
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'meter'
         and r.length_cm between p.min_length_cm and p.max_length_cm
         and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
        left join public.product_widths w
          on w.product_id = p.id
         and w.width_cm = r.width_cm
         and w.is_active
         and r.width_cm <> p.width_cm
        where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
        union all
        -- 0016: القطعة — سعر المنتج × العدد، والعدد من ١ لأقصى عدد المنتج
        select p.id,
               p.name_ar,
               p.image_url,
               p.price_per_meter_piastres,
               null::integer,
               null::integer,
               r.quantity,
               'piece'::text,
               (p.price_per_meter_piastres::numeric * r.quantity::numeric)
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'piece'
         and r.quantity is not null
         and r.quantity between 1 and p.max_quantity
      ),
      totals as (
        select coalesce(pg_catalog.sum(line_total), 0)::numeric as subtotal,
               pg_catalog.count(*)::integer                     as ok_count
        from priced
      ),
      ship as (
        select t.subtotal,
               t.ok_count,
               case when v_threshold > 0 and t.subtotal >= v_threshold
                    then 0::numeric else v_base::numeric end as shipping
        from totals t
      ),
      -- 0018: أجر التركيب على مجموع أطوال المقاس المعتمدة (من priced) + الانتقال مرة واحدة
      fees as (
        select s.subtotal,
               s.ok_count,
               s.shipping,
               i.cm as inst_cm,
               case when v_install
                    then pg_catalog.round((v_rate::numeric * i.cm) / 100.0)
                    else 0::numeric end as inst_fee,
               case when v_install then v_travel::numeric else 0::numeric end as travel
        from ship s
        cross join (
          select coalesce(pg_catalog.sum(pr.length_cm) filter (where pr.sale_unit = 'meter'), 0)::numeric as cm
          from priced pr
        ) i
      ),
      new_order as (
        insert into public.orders (
          order_number, customer_name, customer_phone, governorate, address, notes,
          subtotal_piastres, shipping_piastres, total_piastres,
          idempotency_key, request_hash, checkout_session_hash,
          receipt_token_hash, receipt_expires_at,
          -- 0018
          shipping_area, installation_requested, installation_rate_piastres,
          installation_length_cm, installation_piastres, installation_travel_piastres
        )
        select
          v_order_no,
          pg_catalog.btrim(p_customer_name),
          p_customer_phone,
          p_governorate,
          pg_catalog.btrim(p_address),
          nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
          s.subtotal::integer,
          s.shipping::integer,
          (s.subtotal + s.shipping + s.inst_fee + s.travel)::integer,
          p_idempotency_key,
          p_request_hash,
          p_checkout_session_hash,
          p_receipt_token_hash,
          pg_catalog.now() + (c_receipt_days || ' days')::interval,
          v_area,
          v_install,
          case when v_install then v_rate end,
          case when v_install then s.inst_cm::integer end,
          s.inst_fee::integer,
          s.travel::integer
        from fees s
        where s.ok_count > 0
          and s.ok_count = v_req_count
          and s.subtotal >= 0
          and (s.subtotal + s.shipping + s.inst_fee + s.travel) <= c_int4_max
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        -- ⚠ 0006c: receipt_expires_at مضاف للـreturning
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres,
                  receipt_expires_at,
                  shipping_area, installation_requested, installation_piastres, installation_travel_piastres
      ),
      items_ins as (
        insert into public.order_items (
          order_id, product_id, product_name_ar, product_image_url,
          unit_price_piastres, length_cm, width_cm, line_total_piastres,
          sale_unit, quantity
        )
        select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
               pr.length_cm, pr.width_cm, pr.line_total::integer,
               pr.sale_unit, pr.quantity
        from new_order o cross join priced pr
        returning order_id
      )
      -- items_ins مش مُشار إليه عن قصد: عبارات التعديل جوه WITH بتتنفّذ مرة
      -- واحدة وبالكامل بغضّ النظر عن قراءة مخرجاتها.
      select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
             o.receipt_expires_at,
             o.shipping_area, o.installation_requested, o.installation_piastres, o.installation_travel_piastres
        into v_order
      from new_order o;

      exit;

    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'orders_order_number_key' then
        raise;
      end if;
      if v_attempt = c_number_tries then
        raise exception 'ZELL_ORDER_NUMBER_EXHAUSTED' using errcode = '45050';
      end if;
    end;
  end loop;

  ------------------------------------------------------------------
  -- (ط) النتيجة
  ------------------------------------------------------------------
  if v_order.order_number is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', false,
      'order_number', v_order.order_number,
      'subtotal_piastres', v_order.subtotal_piastres,
      'shipping_piastres', v_order.shipping_piastres,
      'total_piastres', v_order.total_piastres,
      -- 0018
      'shipping_area', v_order.shipping_area,
      'installation_requested', v_order.installation_requested,
      'installation_piastres', v_order.installation_piastres,
      'installation_travel_piastres', v_order.installation_travel_piastres,
      -- 0006c: القيمة المخزّنة فعلاً، جاية من RETURNING مش محسوبة تاني
      'receipt_expires_at', v_order.receipt_expires_at);
  end if;

  -- 0016: نفس قواعد الصلاحية بالظبط — متر + قطعة
  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(x.line_total), 0)
    into v_valid_count, v_subtotal
  from (
    select pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric * r.length_cm::numeric) / 100.0) as line_total
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'meter'
     and r.length_cm between p.min_length_cm and p.max_length_cm
     and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
    left join public.product_widths w
      on w.product_id = p.id
     and w.width_cm = r.width_cm
     and w.is_active
     and r.width_cm <> p.width_cm
    where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
    union all
    select (p.price_per_meter_piastres::numeric * r.quantity::numeric)
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'piece'
     and r.quantity is not null
     and r.quantity between 1 and p.max_quantity
  ) x;

  if v_valid_count <> v_req_count then
    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  v_shipping := case when v_threshold > 0 and v_subtotal >= v_threshold
                     then 0::numeric else v_base::numeric end;
  -- 0018: نفس التركيب والانتقال — كل الأصناف صالحة هنا، فأطوال المقاس = كل lengthCm
  v_inst_fee := 0;
  if v_install then
    select coalesce(pg_catalog.sum((e ->> 'lengthCm')::numeric), 0) into v_inst_cm
    from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null;
    v_inst_fee := pg_catalog.round((v_rate::numeric * v_inst_cm) / 100.0) + v_travel::numeric;
  end if;
  if (v_subtotal + v_shipping + v_inst_fee) > c_int4_max then
    raise exception 'ZELL_PRICE_OUT_OF_RANGE' using errcode = '45027';
  end if;

  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$function$$zts2$;
  execute $zts3$CREATE OR REPLACE FUNCTION public.zell_get_order_receipt_ptest(p_order_number text, p_receipt_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
begin
  -- أي مدخل مش مطابق للشكل = null. **نفس** نتيجة «مش موجود» بالظبط،
  -- عشان الدالة ما تبقاش oracle لتعداد أرقام الطلبات.
  if p_order_number is null
     or p_order_number !~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    return null;
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select o.id,
         o.order_number,
         o.subtotal_piastres,
         o.shipping_piastres,
         o.total_piastres,
         -- 0018 (المنطقة مش بترجع: جزء من العنوان)
         o.installation_requested,
         o.installation_rate_piastres,
         o.installation_length_cm,
         o.installation_piastres,
         o.installation_travel_piastres,
         o.created_at,
         o.governorate,
         pg_catalog.split_part(pg_catalog.btrim(o.customer_name), ' ', 1) as first_name,
         pg_catalog.right(o.customer_phone, 4)                            as phone_last4
    into v_row
  from public.orders o
  where o.order_number = p_order_number
    and o.receipt_expires_at is not null
    and o.receipt_expires_at > pg_catalog.now()
    -- الخانتين صالحتين (الحالية والسابقة) — ترتيب وصول الردود مش مهم.
    and (p_receipt_token_hash = o.receipt_token_hash
      or p_receipt_token_hash = o.receipt_token_hash_prev);

  if v_row.order_number is null then
    return null;
  end if;

  -- ممنوع يرجع: address (ولا جزء منه) · customer_phone كامل · internal_notes
  -- · notes · notified_at · notify_error · status · أي *_hash · idempotency_key
  return pg_catalog.jsonb_build_object(
    'order_number',      v_row.order_number,
    'created_at',        v_row.created_at,
    'governorate',       v_row.governorate,
    'first_name',        v_row.first_name,
    'phone_last4',       v_row.phone_last4,
    'subtotal_piastres', v_row.subtotal_piastres,
    'shipping_piastres', v_row.shipping_piastres,
    'total_piastres',    v_row.total_piastres,
    -- 0018
    'installation_requested',       v_row.installation_requested,
    'installation_rate_piastres',   v_row.installation_rate_piastres,
    'installation_length_cm',       v_row.installation_length_cm,
    'installation_piastres',        v_row.installation_piastres,
    'installation_travel_piastres', v_row.installation_travel_piastres,
    'items', (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'product_name_ar',     i.product_name_ar,
                   'length_cm',           i.length_cm,
                   'width_cm',            i.width_cm,
                   'line_total_piastres', i.line_total_piastres,
                   -- 0016: القطعة = عدد من غير طول/عرض
                   'quantity',            i.quantity,
                   'sale_unit',           i.sale_unit)
                 order by i.id),
               '[]'::jsonb)
      from public.order_items i
      where i.order_id = v_row.id
    ));
end;
$function$$zts3$;
  update public.settings set value = '{"enabled":true,"note":"","feePerMeterPiastres":10000,"areas":{"القاهرة":{"مدينة نصر":5000,"المعادي":0},"الجيزة":{"الدقي":5000,"أكتوبر":7500}},"governorates":["القاهرة","الجيزة"]}'::jsonb where key = 'installation';
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', 'null'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100017', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8d', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8d', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '1000001'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100018', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8e', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8e', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '1000000'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100019', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A8f', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A8f', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{enabled}', 'false'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100020', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A9', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A9', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '0'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100021', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10a', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '"100"'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100022', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10b', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = value - 'feePerMeterPiastres' where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100023', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10c', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10c', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '1000001'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100024', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10d', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10d', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '99.5'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100025', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10e', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10e', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '0'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100026', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10f', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10f', 'E' || SQLSTATE);
  end;
  begin
    delete from public.settings where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100027', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, null, false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A10g', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A10g', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100028', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'منطقة وهمية', false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A12a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A12a', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100029', 'الإسكندرية',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, null, false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A12b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A12b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100030', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'الدقي', false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A13', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A13', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100031', 'الجيزة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, '  أكتوبر ', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A14', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A14', 'E' || SQLSTATE);
  end;
  raise exception 'ZELL_PTEST %', res::text;
end $ztest$;

do $ztest$
declare r jsonb; rc jsonb; v_out text; res jsonb := '{}'::jsonb;
        k text; k2 text; h1 text; h2 text; h3 text; h4 text;
begin
  perform pg_catalog.set_config('lock_timeout', '3000', true);
  perform pg_catalog.set_config('statement_timeout', '30000', true);
  execute $zts0$alter table public.orders
  add column if not exists shipping_area text,
  add column if not exists installation_requested boolean not null default false,
  add column if not exists installation_rate_piastres integer,
  add column if not exists installation_length_cm integer,
  add column if not exists installation_piastres integer not null default 0,
  add column if not exists installation_travel_piastres integer not null default 0$zts0$;
  execute $zts1$alter table public.orders
  drop constraint if exists orders_shipping_area_shape,
  drop constraint if exists orders_installation_shape,
  drop constraint if exists orders_total_consistent,
  add constraint orders_shipping_area_shape check (
    shipping_area is null
    or (char_length(shipping_area) between 1 and 40 and shipping_area = btrim(shipping_area))
  ),
  add constraint orders_installation_shape check (
    (installation_requested = false
       and installation_rate_piastres is null
       and installation_length_cm is null
       and installation_piastres = 0
       and installation_travel_piastres = 0)
    or
    (installation_requested = true
       and shipping_area is not null
       and installation_rate_piastres between 1 and 1000000
       and installation_length_cm > 0
       and installation_piastres = round((installation_rate_piastres::numeric * installation_length_cm::numeric) / 100.0)
       and installation_travel_piastres between 0 and 1000000)
  ),
  add constraint orders_total_consistent check (
    total_piastres::bigint = subtotal_piastres::bigint + shipping_piastres::bigint
                           + installation_piastres::bigint + installation_travel_piastres::bigint
  )$zts1$;
  execute $zts2$CREATE OR REPLACE FUNCTION public.zell_create_order_ptest(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_alphabet          constant text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c_max_items         constant integer := 20;
  c_max_notes         constant integer := 500;
  c_max_per_phone_day constant integer := 5;
  c_number_tries      constant integer := 5;
  c_receipt_days      constant integer := 7;
  c_int4_max          constant numeric := 2147483647;
  c_lock_ns           constant integer := 1951;

  v_lock_key    integer;
  v_req_count   integer;
  v_rates       jsonb;
  v_free        jsonb;
  v_disabled    jsonb;
  v_num         numeric;
  v_base        integer;
  v_threshold   integer;
  v_phone_count integer;
  v_order_no    text;
  v_order       record;
  v_existing    record;
  v_constraint  text;
  v_valid_count integer;
  v_subtotal    numeric;
  v_shipping    numeric;
  v_attempt     integer;
  -- 0018: المنطقة + فني التركيب
  c_max_area          constant integer := 40;
  c_money_cap         constant numeric := 1000000;
  v_install     boolean;
  v_area        text;
  v_areas       jsonb;
  v_inst        jsonb;
  v_travel_j    jsonb;
  v_rate        integer;
  v_travel      integer;
  v_inst_cm     numeric;
  v_inst_fee    numeric;
begin
  ------------------------------------------------------------------
  -- (أ) فحوصات ثابتة بلا داتابيز: المفتاح والهاشات التلاتة
  ------------------------------------------------------------------
  if p_idempotency_key is null
     or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) not between 16 and 128 then
    raise exception 'ZELL_IDEMPOTENCY_REQUIRED' using errcode = '45001';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_REQUEST_HASH_INVALID' using errcode = '45004';
  end if;
  if p_checkout_session_hash is null or p_checkout_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_SESSION_HASH_INVALID' using errcode = '45005';
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ZELL_RECEIPT_HASH_INVALID' using errcode = '45006';
  end if;

  ------------------------------------------------------------------
  -- (ب) الموبايل — مفتاح التسلسل في (ج) فلازم يسبق الحسم
  ------------------------------------------------------------------
  if coalesce(p_customer_phone, '') !~ '^01[0125][0-9]{8}$' then
    raise exception 'ZELL_INVALID_PHONE' using errcode = '45021';
  end if;

  ------------------------------------------------------------------
  -- (ج) تسلسل لكل رقم موبايل — قفل على مستوى المعاملة
  ------------------------------------------------------------------
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_customer_phone), 1, 8))::bit(32)::integer;
  perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_lock_key);

  ------------------------------------------------------------------
  -- (د) حسم الـidempotency — قبل أي فحص مُتغيّر
  --
  --     ⚠ 0006c: الـselect بقى بياخد receipt_expires_at كمان عشان الإسقاط.
  ------------------------------------------------------------------
  select o.order_number, o.request_hash, o.checkout_session_hash,
         o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
         o.receipt_expires_at,
         -- 0018
         o.shipping_area, o.installation_requested,
         o.installation_piastres, o.installation_travel_piastres
    into v_existing
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if v_existing.order_number is not null then

    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
    end if;

    if v_existing.checkout_session_hash is distinct from p_checkout_session_hash then
      raise exception 'ZELL_REPLAY_NOT_AUTHORIZED' using errcode = '45007';
    end if;

    -- replay مُصرَّح: تدوير بخانتين.
    -- ⚠ receipt_expires_at **غير مذكور** في الـupdate عن قصد — النافذة مربوطة
    --   بلحظة الإنشاء ومفيش أي طرف يقدر يمدّها. ده أهم سطر في الملف.
    update public.orders
       set receipt_token_hash_prev = receipt_token_hash,
           receipt_token_hash      = p_receipt_token_hash,
           updated_at              = pg_catalog.now()
     where idempotency_key = p_idempotency_key;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'order_number', v_existing.order_number,
      'subtotal_piastres', v_existing.subtotal_piastres,
      'shipping_piastres', v_existing.shipping_piastres,
      'total_piastres', v_existing.total_piastres,
      -- 0018: اللقطة المحفوظة — مش محسوبة تاني
      'shipping_area', v_existing.shipping_area,
      'installation_requested', v_existing.installation_requested,
      'installation_piastres', v_existing.installation_piastres,
      'installation_travel_piastres', v_existing.installation_travel_piastres,
      -- 0006c: القيمة **الأصلية** من وقت الإنشاء، مش محسوبة من now()
      'receipt_expires_at', v_existing.receipt_expires_at);
  end if;

  ------------------------------------------------------------------
  -- (هـ) باقي الفحوصات الثابتة
  ------------------------------------------------------------------
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_customer_name, ''))) < 3 then
    raise exception 'ZELL_INVALID_NAME' using errcode = '45020';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_address, ''))) < 8 then
    raise exception 'ZELL_INVALID_ADDRESS' using errcode = '45022';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > c_max_notes then
    raise exception 'ZELL_NOTES_TOO_LONG' using errcode = '45026';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  v_req_count := pg_catalog.jsonb_array_length(p_items);
  if v_req_count = 0 then
    raise exception 'ZELL_CART_EMPTY' using errcode = '45024';
  end if;
  if v_req_count > c_max_items then
    raise exception 'ZELL_CART_TOO_LARGE' using errcode = '45025';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as e
    where pg_catalog.jsonb_typeof(e) <> 'object'
       or (e ->> 'productId') is null
       or (e ->> 'productId') !~ '^[1-9][0-9]{0,8}$'
       -- 0016: الصنف يا بالطول (متر) يا بالعدد (قطعة) — واحد بس منهم
       or ((e ->> 'lengthCm') is null) = ((e ->> 'quantity') is null)
       or ((e ->> 'lengthCm') is not null and (e ->> 'lengthCm') !~ '^[1-9][0-9]{0,6}$')
       or ((e ->> 'quantity') is not null and (e ->> 'quantity') !~ '^[1-9][0-9]{0,3}$')
       or ((e ->> 'quantity') is not null and (e ->> 'widthCm') is not null)
       -- 0015: العرض اختياري — لو موجود لازم رقم صحيح موجب
       or ((e ->> 'widthCm') is not null and (e ->> 'widthCm') !~ '^[1-9][0-9]{0,6}$')
  ) then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
  end if;

  -- 0018: المنطقة معامل صريح (مش من نص العنوان) — NFC + trim، وفاضي = null
  v_install := coalesce(p_installation, false);
  v_area := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_area, ''), 'NFC')), '');
  if v_area is not null and pg_catalog.length(v_area) > c_max_area then
    raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
  end if;
  -- 0018: الفني على أطوال منتجات المقاس بس — طلب كله قطع مالوش تركيب
  if v_install and not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null
  ) then
    raise exception 'ZELL_INSTALLATION_NO_METERS' using errcode = '45033';
  end if;

  ------------------------------------------------------------------
  -- (و) إعدادات الشحن + المحافظة
  ------------------------------------------------------------------
  select s.value into v_rates    from public.settings s where s.key = 'shipping_rates';
  select s.value into v_free     from public.settings s where s.key = 'free_shipping_threshold_piastres';
  select s.value into v_disabled from public.settings s where s.key = 'shipping_disabled_governorates';

  if v_rates is null or v_free is null or v_disabled is null
     or pg_catalog.jsonb_typeof(v_rates)    <> 'object'
     or pg_catalog.jsonb_typeof(v_free)     <> 'number'
     or pg_catalog.jsonb_typeof(v_disabled) <> 'array' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  if not (v_rates ? coalesce(p_governorate, ''))
     or v_disabled ? coalesce(p_governorate, '') then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  v_num := (v_rates ->> p_governorate)::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_base := v_num::integer;

  v_num := (v_free #>> '{}')::numeric;
  if v_num < 0 or v_num > c_int4_max or v_num <> pg_catalog.trunc(v_num) then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;
  v_threshold := v_num::integer;

  ------------------------------------------------------------------
  -- (و٢) 0018: المنطقة لازم تكون من مناطق الشحن للمحافظة دي
  ------------------------------------------------------------------
  if v_area is not null then
    select s.value into v_areas from public.settings s where s.key = 'shipping_areas';
    if v_areas is null
       or pg_catalog.jsonb_typeof(v_areas) <> 'object'
       or pg_catalog.jsonb_typeof(v_areas -> p_governorate) is distinct from 'array'
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_areas -> p_governorate) as a
         where pg_catalog.jsonb_typeof(a) = 'string'
           and pg_catalog.btrim(pg_catalog.normalize(a #>> '{}', 'NFC')) = v_area
       ) then
      raise exception 'ZELL_AREA_INVALID' using errcode = '45034';
    end if;
  end if;

  ------------------------------------------------------------------
  -- (و٣) 0018: فني التركيب — بيتقري بس لو مطلوب، فالطلب العادي مابيتأثرش بإعداده
  ------------------------------------------------------------------
  if v_install then
    select s.value into v_inst from public.settings s where s.key = 'installation';
    if v_area is null
       or v_inst is null
       or pg_catalog.jsonb_typeof(v_inst) <> 'object'
       or pg_catalog.jsonb_typeof(v_inst -> 'enabled') is distinct from 'boolean'
       or (v_inst ->> 'enabled') <> 'true' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;

    if pg_catalog.jsonb_typeof(v_inst -> 'feePerMeterPiastres') is distinct from 'number' then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_num := (v_inst ->> 'feePerMeterPiastres')::numeric;
    if v_num < 1 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
    end if;
    v_rate := v_num::integer;

    -- الانتقال لكل منطقة: رقم صحيح 0..الحد، وغير كده = الفني مش متاح هناك
    v_travel_j := null;
    if pg_catalog.jsonb_typeof(v_inst #> array['areas', p_governorate]) = 'object' then
      select t.value into v_travel_j
      from pg_catalog.jsonb_each(v_inst #> array['areas', p_governorate]) as t
      where pg_catalog.btrim(pg_catalog.normalize(t.key, 'NFC')) = v_area
      limit 1;
    end if;
    if v_travel_j is null or pg_catalog.jsonb_typeof(v_travel_j) <> 'number' then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_num := (v_travel_j #>> '{}')::numeric;
    if v_num < 0 or v_num > c_money_cap or v_num <> pg_catalog.trunc(v_num) then
      raise exception 'ZELL_INSTALLATION_NOT_AVAILABLE' using errcode = '45032';
    end if;
    v_travel := v_num::integer;
  end if;

  ------------------------------------------------------------------
  -- (ز) نافذة الموبايل — محمية بالقفل من (ج)
  --
  --     ⚠ مفيش فلتر على status عن قصد: الطلبات الملغية ('cancelled')
  --       **بتتحسب**. الحد حماية من الإساءة، ولو الإلغاء بيصفّر العدّاد يبقى
  --       أي مهاجم يقدر يلف عليه. ممنوع تغيير ده بصمت (§5.2).
  ------------------------------------------------------------------
  select pg_catalog.count(*)::integer into v_phone_count
  from public.orders o
  where o.customer_phone = p_customer_phone
    and o.created_at >= pg_catalog.now() - interval '24 hours';

  if v_phone_count >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45041';
  end if;

  ------------------------------------------------------------------
  -- (ح) الإدخال — عبارة CTE واحدة، مع إعادة المحاولة على تصادم الرقم
  ------------------------------------------------------------------
  for v_attempt in 1..c_number_tries loop
    begin
      select 'FLM-' || pg_catalog.string_agg(
               pg_catalog.substr(
                 c_alphabet,
                 (('x' || pg_catalog.substr(h.hex, 1 + (i - 1) * 2, 2))::bit(8)::integer % 32) + 1,
                 1),
               '' order by i)
        into v_order_no
      from (select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as hex) h,
           pg_catalog.generate_series(1, 6) as i;

      with req as (
        select (e ->> 'productId')::integer as product_id,
               (e ->> 'lengthCm')::integer  as length_cm,
               (e ->> 'widthCm')::integer   as width_cm,
               (e ->> 'quantity')::integer  as quantity
        from pg_catalog.jsonb_array_elements(p_items) as e
      ),
      priced as (
        -- 0015: عرض غير الأساسي = لازم صف شغّال في product_widths، والسعر منه.
        --       من غير عرض (أو العرض الأساسي) = نفس الحساب القديم بالحرف.
        -- 0016: المتر لمنتجات المتر بس، والقطعة فرع لوحده تحت.
        select p.id   as product_id,
               p.name_ar,
               p.image_url,
               coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres) as price_per_meter_piastres,
               coalesce(w.width_cm, p.width_cm) as width_cm,
               r.length_cm,
               1 as quantity,
               'meter'::text as sale_unit,
               pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric
                                 * r.length_cm::numeric) / 100.0) as line_total
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'meter'
         and r.length_cm between p.min_length_cm and p.max_length_cm
         and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
        left join public.product_widths w
          on w.product_id = p.id
         and w.width_cm = r.width_cm
         and w.is_active
         and r.width_cm <> p.width_cm
        where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
        union all
        -- 0016: القطعة — سعر المنتج × العدد، والعدد من ١ لأقصى عدد المنتج
        select p.id,
               p.name_ar,
               p.image_url,
               p.price_per_meter_piastres,
               null::integer,
               null::integer,
               r.quantity,
               'piece'::text,
               (p.price_per_meter_piastres::numeric * r.quantity::numeric)
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and p.sale_unit = 'piece'
         and r.quantity is not null
         and r.quantity between 1 and p.max_quantity
      ),
      totals as (
        select coalesce(pg_catalog.sum(line_total), 0)::numeric as subtotal,
               pg_catalog.count(*)::integer                     as ok_count
        from priced
      ),
      ship as (
        select t.subtotal,
               t.ok_count,
               case when v_threshold > 0 and t.subtotal >= v_threshold
                    then 0::numeric else v_base::numeric end as shipping
        from totals t
      ),
      -- 0018: أجر التركيب على مجموع أطوال المقاس المعتمدة (من priced) + الانتقال مرة واحدة
      fees as (
        select s.subtotal,
               s.ok_count,
               s.shipping,
               i.cm as inst_cm,
               case when v_install
                    then pg_catalog.round((v_rate::numeric * i.cm) / 100.0)
                    else 0::numeric end as inst_fee,
               case when v_install then v_travel::numeric else 0::numeric end as travel
        from ship s
        cross join (
          select coalesce(pg_catalog.sum(pr.length_cm) filter (where pr.sale_unit = 'meter'), 0)::numeric as cm
          from priced pr
        ) i
      ),
      new_order as (
        insert into public.orders (
          order_number, customer_name, customer_phone, governorate, address, notes,
          subtotal_piastres, shipping_piastres, total_piastres,
          idempotency_key, request_hash, checkout_session_hash,
          receipt_token_hash, receipt_expires_at,
          -- 0018
          shipping_area, installation_requested, installation_rate_piastres,
          installation_length_cm, installation_piastres, installation_travel_piastres
        )
        select
          v_order_no,
          pg_catalog.btrim(p_customer_name),
          p_customer_phone,
          p_governorate,
          pg_catalog.btrim(p_address),
          nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
          s.subtotal::integer,
          s.shipping::integer,
          (s.subtotal + s.shipping + s.inst_fee + s.travel)::integer,
          p_idempotency_key,
          p_request_hash,
          p_checkout_session_hash,
          p_receipt_token_hash,
          pg_catalog.now() + (c_receipt_days || ' days')::interval,
          v_area,
          v_install,
          case when v_install then v_rate end,
          case when v_install then s.inst_cm::integer end,
          s.inst_fee::integer,
          s.travel::integer
        from fees s
        where s.ok_count > 0
          and s.ok_count = v_req_count
          and s.subtotal >= 0
          and (s.subtotal + s.shipping + s.inst_fee + s.travel) <= c_int4_max
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        -- ⚠ 0006c: receipt_expires_at مضاف للـreturning
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres,
                  receipt_expires_at,
                  shipping_area, installation_requested, installation_piastres, installation_travel_piastres
      ),
      items_ins as (
        insert into public.order_items (
          order_id, product_id, product_name_ar, product_image_url,
          unit_price_piastres, length_cm, width_cm, line_total_piastres,
          sale_unit, quantity
        )
        select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
               pr.length_cm, pr.width_cm, pr.line_total::integer,
               pr.sale_unit, pr.quantity
        from new_order o cross join priced pr
        returning order_id
      )
      -- items_ins مش مُشار إليه عن قصد: عبارات التعديل جوه WITH بتتنفّذ مرة
      -- واحدة وبالكامل بغضّ النظر عن قراءة مخرجاتها.
      select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
             o.receipt_expires_at,
             o.shipping_area, o.installation_requested, o.installation_piastres, o.installation_travel_piastres
        into v_order
      from new_order o;

      exit;

    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'orders_order_number_key' then
        raise;
      end if;
      if v_attempt = c_number_tries then
        raise exception 'ZELL_ORDER_NUMBER_EXHAUSTED' using errcode = '45050';
      end if;
    end;
  end loop;

  ------------------------------------------------------------------
  -- (ط) النتيجة
  ------------------------------------------------------------------
  if v_order.order_number is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', false,
      'order_number', v_order.order_number,
      'subtotal_piastres', v_order.subtotal_piastres,
      'shipping_piastres', v_order.shipping_piastres,
      'total_piastres', v_order.total_piastres,
      -- 0018
      'shipping_area', v_order.shipping_area,
      'installation_requested', v_order.installation_requested,
      'installation_piastres', v_order.installation_piastres,
      'installation_travel_piastres', v_order.installation_travel_piastres,
      -- 0006c: القيمة المخزّنة فعلاً، جاية من RETURNING مش محسوبة تاني
      'receipt_expires_at', v_order.receipt_expires_at);
  end if;

  -- 0016: نفس قواعد الصلاحية بالظبط — متر + قطعة
  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(x.line_total), 0)
    into v_valid_count, v_subtotal
  from (
    select pg_catalog.round((coalesce(w.price_per_meter_piastres, p.price_per_meter_piastres)::numeric * r.length_cm::numeric) / 100.0) as line_total
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'meter'
     and r.length_cm between p.min_length_cm and p.max_length_cm
     and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
    left join public.product_widths w
      on w.product_id = p.id
     and w.width_cm = r.width_cm
     and w.is_active
     and r.width_cm <> p.width_cm
    where r.width_cm is null or r.width_cm = p.width_cm or w.id is not null
    union all
    select (p.price_per_meter_piastres::numeric * r.quantity::numeric)
    from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm,
           (e ->> 'widthCm')::integer   as width_cm,
           (e ->> 'quantity')::integer  as quantity
    from pg_catalog.jsonb_array_elements(p_items) as e
    ) r
    join public.products p
      on p.id = r.product_id
     and p.is_active
     and p.sale_unit = 'piece'
     and r.quantity is not null
     and r.quantity between 1 and p.max_quantity
  ) x;

  if v_valid_count <> v_req_count then
    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  v_shipping := case when v_threshold > 0 and v_subtotal >= v_threshold
                     then 0::numeric else v_base::numeric end;
  -- 0018: نفس التركيب والانتقال — كل الأصناف صالحة هنا، فأطوال المقاس = كل lengthCm
  v_inst_fee := 0;
  if v_install then
    select coalesce(pg_catalog.sum((e ->> 'lengthCm')::numeric), 0) into v_inst_cm
    from pg_catalog.jsonb_array_elements(p_items) as e
    where (e ->> 'lengthCm') is not null;
    v_inst_fee := pg_catalog.round((v_rate::numeric * v_inst_cm) / 100.0) + v_travel::numeric;
  end if;
  if (v_subtotal + v_shipping + v_inst_fee) > c_int4_max then
    raise exception 'ZELL_PRICE_OUT_OF_RANGE' using errcode = '45027';
  end if;

  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$function$$zts2$;
  execute $zts3$CREATE OR REPLACE FUNCTION public.zell_get_order_receipt_ptest(p_order_number text, p_receipt_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
begin
  -- أي مدخل مش مطابق للشكل = null. **نفس** نتيجة «مش موجود» بالظبط،
  -- عشان الدالة ما تبقاش oracle لتعداد أرقام الطلبات.
  if p_order_number is null
     or p_order_number !~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    return null;
  end if;
  if p_receipt_token_hash is null or p_receipt_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select o.id,
         o.order_number,
         o.subtotal_piastres,
         o.shipping_piastres,
         o.total_piastres,
         -- 0018 (المنطقة مش بترجع: جزء من العنوان)
         o.installation_requested,
         o.installation_rate_piastres,
         o.installation_length_cm,
         o.installation_piastres,
         o.installation_travel_piastres,
         o.created_at,
         o.governorate,
         pg_catalog.split_part(pg_catalog.btrim(o.customer_name), ' ', 1) as first_name,
         pg_catalog.right(o.customer_phone, 4)                            as phone_last4
    into v_row
  from public.orders o
  where o.order_number = p_order_number
    and o.receipt_expires_at is not null
    and o.receipt_expires_at > pg_catalog.now()
    -- الخانتين صالحتين (الحالية والسابقة) — ترتيب وصول الردود مش مهم.
    and (p_receipt_token_hash = o.receipt_token_hash
      or p_receipt_token_hash = o.receipt_token_hash_prev);

  if v_row.order_number is null then
    return null;
  end if;

  -- ممنوع يرجع: address (ولا جزء منه) · customer_phone كامل · internal_notes
  -- · notes · notified_at · notify_error · status · أي *_hash · idempotency_key
  return pg_catalog.jsonb_build_object(
    'order_number',      v_row.order_number,
    'created_at',        v_row.created_at,
    'governorate',       v_row.governorate,
    'first_name',        v_row.first_name,
    'phone_last4',       v_row.phone_last4,
    'subtotal_piastres', v_row.subtotal_piastres,
    'shipping_piastres', v_row.shipping_piastres,
    'total_piastres',    v_row.total_piastres,
    -- 0018
    'installation_requested',       v_row.installation_requested,
    'installation_rate_piastres',   v_row.installation_rate_piastres,
    'installation_length_cm',       v_row.installation_length_cm,
    'installation_piastres',        v_row.installation_piastres,
    'installation_travel_piastres', v_row.installation_travel_piastres,
    'items', (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'product_name_ar',     i.product_name_ar,
                   'length_cm',           i.length_cm,
                   'width_cm',            i.width_cm,
                   'line_total_piastres', i.line_total_piastres,
                   -- 0016: القطعة = عدد من غير طول/عرض
                   'quantity',            i.quantity,
                   'sale_unit',           i.sale_unit)
                 order by i.id),
               '[]'::jsonb)
      from public.order_items i
      where i.order_id = v_row.id
    ));
end;
$function$$zts3$;
  update public.settings set value = '{"enabled":true,"note":"","feePerMeterPiastres":10000,"areas":{"القاهرة":{"مدينة نصر":5000,"المعادي":0},"الجيزة":{"الدقي":5000,"أكتوبر":7500}},"governorates":["القاهرة","الجيزة"]}'::jsonb where key = 'installation';
  begin
    update public.settings set value = '70000'::jsonb where key = 'free_shipping_threshold_piastres';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100032', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A16a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A16a', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = '70000'::jsonb where key = 'free_shipping_threshold_piastres';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":600}]'::jsonb, 'تجربة اختبار', '01599100033', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A16b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A16b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":21,"quantity":1}]'::jsonb, 'تجربة اختبار', '01599100034', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A21', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A21', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100035', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'ممممممممممممممممممممممممممممممممممممممممم', false);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A23', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A23', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '9999'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":1,"lengthCm":350}]'::jsonb, 'تجربة اختبار', '01599100036', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A24a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A24a', 'E' || SQLSTATE);
  end;
  begin
    update public.settings set value = pg_catalog.jsonb_set(value, '{feePerMeterPiastres}', '9999'::jsonb) where key = 'installation';
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":1,"lengthCm":300}]'::jsonb, 'تجربة اختبار', '01599100037', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A24b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A24b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599900001', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    update public.settings set value = pg_catalog.jsonb_set(value, '{areas,القاهرة,مدينة نصر}', '9999'::jsonb) where key = 'installation';
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599900001', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h4, 'مدينة نصر', true);
    v_out := (r ->> 'replayed') || '|' || (r ->> 'installation_travel_piastres') || '|' || (r ->> 'total_piastres') || '|' || (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A15', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A15', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599900002', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599900002', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h4, h2, h3, 'مدينة نصر', false);
    v_out := 'no-error';
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A22', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A22', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599100001', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3, 'مدينة نصر', true);
    rc := public.zell_get_order_receipt_ptest(r ->> 'order_number', h3);
    v_out := pg_catalog.concat_ws('|', rc ->> 'installation_requested', rc ->> 'installation_rate_piastres', rc ->> 'installation_length_cm',
      rc ->> 'installation_piastres', rc ->> 'installation_travel_piastres', rc ->> 'total_piastres', (rc ? 'shipping_area')::text, (rc ? 'address')::text);
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A19', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A19', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order('[{"productId":2,"lengthCm":500},{"productId":3,"lengthCm":300,"widthCm":120}]'::jsonb, 'تجربة اختبار', '01599900003', 'القاهرة',
      'مدينة نصر — شارع الاختبار ١٢٣', null, k, h1, h2, h3);
    v_out := (select pg_catalog.concat_ws('|', o.subtotal_piastres, o.shipping_piastres, o.total_piastres) from public.orders o where o.order_number = r ->> 'order_number');
    r := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500},{"productId":3,"lengthCm":300,"widthCm":120}]'::jsonb, 'تجربة اختبار', '01599900004', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k2, h1, h2, h3, 'مدينة نصر', false);
    v_out := v_out || ' = ' || (select pg_catalog.concat_ws('|', o.subtotal_piastres, o.shipping_piastres, o.total_piastres) from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A11', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A11', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    r := public.zell_create_order('[{"productId":2,"lengthCm":500}]'::jsonb, 'تجربة اختبار', '01599900005', 'القاهرة',
      'شارع الاختبار ١٢٣', null, k, h1, h2, h3);
    v_out := (select pg_catalog.concat_ws('|', 'ok', o.subtotal_piastres, o.shipping_piastres, o.installation_piastres,
      o.installation_travel_piastres, o.total_piastres, coalesce(o.shipping_area, '-'), o.installation_requested::text,
      coalesce(o.installation_rate_piastres::text, '-'), coalesce(o.installation_length_cm::text, '-'))
    from public.orders o where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('B0', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('B0', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres)
      values ('FLM-PTST01', 'تجربة', '01599900006', 'القاهرة', 'شارع الاختبار ١٢٣', 1000, 500, 1600);
    v_out := 'inserted';
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A17a', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A17a', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres,
        installation_requested, installation_rate_piastres, installation_length_cm, installation_piastres, installation_travel_piastres)
      values ('FLM-PTST02', 'تجربة', '01599900007', 'القاهرة', 'شارع الاختبار ١٢٣', 1000, 500, 56500, true, 10000, 500, 50000, 5000);
    v_out := 'inserted';
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A17b', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A17b', 'E' || SQLSTATE);
  end;
  begin
    
    k := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    k2 := 'ptest-' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
    h1 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h2 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h3 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    h4 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')), 'hex');
    insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres,
        shipping_area, installation_requested, installation_rate_piastres, installation_length_cm, installation_piastres, installation_travel_piastres)
      values ('FLM-PTST03', 'تجربة', '01599900008', 'القاهرة', 'شارع الاختبار ١٢٣', 1000, 500, 56501, 'مدينة نصر', true, 10000, 500, 50001, 5000);
    v_out := 'inserted';
    raise exception using errcode = 'ZT001', message = coalesce(v_out, 'null');
  exception
    when sqlstate 'ZT001' then res := res || pg_catalog.jsonb_build_object('A17c', SQLERRM);
    when others then res := res || pg_catalog.jsonb_build_object('A17c', 'E' || SQLSTATE);
  end;
  raise exception 'ZELL_PTEST %', res::text;
end $ztest$;
