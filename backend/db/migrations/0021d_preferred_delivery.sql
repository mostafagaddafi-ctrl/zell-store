-- 0021-D — موعد التسليم المفضّل في Checkout (لقطة على الطلب، منفصلة عن الموعد المؤكد)
--
-- العقد: docs/contracts/0021-A.md (§٢-٨ · §٦ · §٨ D · §٩ D). التفاصيل التنفيذية في §١٦ منه.
--   • orders: preferred_delivery_date · preferred_delivery_period (morning|noon|evening|null) · preferred_delivery_note (≤ 200)،
--     فاضيين للأوردرات القديمة، وقيد شكل orders_preferred_delivery_shape.
--   • zell_create_order: معامل واحد جديد p_preferred_delivery jsonb DEFAULT NULL (14 معامل). التعريف القديم (13) بيتشال في
--     نفس المعاملة (مفيش overload — PGRST203)، والنداء القديم من غير المعامل = نفس النتيجة بالحرف. التعديل = استبدال نص
--     بالظبط على التعريف الحالي (0019، والـ preflight بيتأكد من بصمة prosrc الحية). المالك والصلاحيات وprosecdef
--     وsearch_path زي ما هم. الموعد مابيغيّرش أي مبلغ. موعد غلط = ZELL_PREFERRED_DELIVERY_INVALID (45415) قبل أي إدخال.
--   • zell_get_order_receipt: مفتاح preferred_delivery (null من غير موعد). الباقي بالحرف.
--   • zell_checkout_delivery_periods(): أوقات الفترات من order_delivery_periods للـ Checkout (service_role بس)، مالكها
--     zell_order_definer.
--   • الأكواد: 45415 (نطاق 0021-أ). الـ preflight والـ postflight: ZELL_0021D_*.
--
-- التحقق: 0021d_preferred_delivery_verify.sql · الرجوع: 0021d_preferred_delivery_rollback.sql
-- الاختبار قبل التطبيق: 0021d_preferred_delivery_ptest.sql · CI: backend/db/ci/0021d_sql_ci.sh
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد backup، وقت طلبات قليلة، و**قبل** نشر كود المتجر اللي بيبعت الموعد.

begin;
-- >>> 0021D BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight: A1 متطبّق، D لأ، والدالتين زي التعريف المحفوظ في الريبو بالحرف (بصمة prosrc).
do $d0pre$
declare
  v_oid   oid;
  v_r     oid;
  v_n     integer;
  v_owner text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021D_WRONG_CALLER';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0021D_SERVER_VERSION';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null or pg_catalog.to_regclass('public.order_delivery_periods') is null then
    raise exception 'ZELL_0021D_A1_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                and a.attname in ('preferred_delivery_date', 'preferred_delivery_period', 'preferred_delivery_note'))
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()') is not null then
    raise exception 'ZELL_0021D_ALREADY_APPLIED';
  end if;
  select pg_catalog.count(*) into v_n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order';
  if v_n <> 1 then
    raise exception 'ZELL_0021D_CREATE_ORDER_OVERLOADS %', v_n;
  end if;
  select p.oid, pg_catalog.pg_get_userbyid(p.proowner) into v_oid, v_owner
    from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order';
  if pg_catalog.pg_get_function_identity_arguments(v_oid) <> 'p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text, p_installation boolean, p_coupon_code text' then
    raise exception 'ZELL_0021D_CREATE_ORDER_SIGNATURE';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_oid) <> '3e9de2663e97ed6225778c053ce65380' then
    raise exception 'ZELL_0021D_CREATE_ORDER_DRIFT';
  end if;
  if not (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = v_oid) then
    raise exception 'ZELL_0021D_CREATE_ORDER_SHAPE';
  end if;
  if v_owner <> current_user and not pg_catalog.pg_has_role(current_user, v_owner, 'SET') then
    raise exception 'ZELL_0021D_OWNER_UNREACHABLE %', v_owner;
  end if;
  v_r := pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)');
  if v_r is null or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_r) <> '711a5447be1c289cfb8bafe19199f1ce' then
    raise exception 'ZELL_0021D_RECEIPT_DRIFT';
  end if;
  if not pg_catalog.pg_has_role(current_user, (select p.proowner from pg_catalog.pg_proc p where p.oid = v_r), 'USAGE') then
    raise exception 'ZELL_0021D_RECEIPT_OWNER';
  end if;
  -- المالك والصلاحيات بيتحفظوا للمعاملة دي بس، وبيترجعوا بالظبط بعد الاستبدال.
  perform pg_catalog.set_config('zell.d_owner', v_owner, true);
  perform pg_catalog.set_config('zell.d_acl', coalesce((select p.proacl::text from pg_catalog.pg_proc p where p.oid = v_oid), ''), true);
end
$d0pre$;

-- (1) orders: لقطة الموعد المفضّل (فاضية للأوردرات القديمة).
alter table public.orders
  add column preferred_delivery_date date,
  add column preferred_delivery_period text,
  add column preferred_delivery_note text,
  add constraint orders_preferred_delivery_shape check (
    (preferred_delivery_date is null and preferred_delivery_period is null and preferred_delivery_note is null)
    or (preferred_delivery_date is not null
        and (preferred_delivery_period is null or preferred_delivery_period in ('morning', 'noon', 'evening'))
        and (preferred_delivery_note is null
             or (pg_catalog.char_length(preferred_delivery_note) between 1 and 200
                 and preferred_delivery_note = pg_catalog.btrim(preferred_delivery_note))))
  );

-- (2) zell_create_order: القديم (13) بيتشال، والجديد (14) = نفس النص + المعامل والتحقق والأعمدة التلاتة.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text, p_preferred_delivery jsonb DEFAULT NULL::jsonb)
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
  -- 0019: كود الخصم — كوبون واحد بس لكل أوردر، والداتابيز هي الحكم
  v_code         text;
  v_cp_enabled   jsonb;
  v_cp_id        bigint;
  v_cp_active    boolean;
  v_cp_kind      text;
  v_cp_percent   integer;
  v_cp_amount    integer;
  v_cp_max       integer;
  v_cp_min       integer;
  v_cp_starts    timestamptz;
  v_cp_ends      timestamptz;
  v_cp_uses      integer;
  v_cp_per_phone integer;
  v_cp_used      integer;
  v_discount     numeric;
  -- 0021-D: موعد التسليم المفضّل
  v_pref_date    date;
  v_pref_period  text;
  v_pref_note    text;
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
         o.installation_piastres, o.installation_travel_piastres,
         -- 0019
         o.discount_piastres, o.coupon_code
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
      -- 0019: اللقطة المحفوظة — الكود مابيتفحصش تاني ومفيش استخدام جديد
      'discount_piastres', v_existing.discount_piastres,
      'coupon_code', v_existing.coupon_code,
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

  -- 0021-D: موعد التسليم المفضّل (اختياري) — لقطة على الطلب، ومابيغيّرش أي مبلغ.
  --   NULL (أو JSON null) = النداء القديم بالحرف. غير كده: {date: "YYYY-MM-DD", period?: morning|noon|evening|null,
  --   note?: نص ≤ 200|null}، والتاريخ من النهارده (القاهرة) لحد 60 يوم. أي حاجة تانية = 45415 قبل أي إدخال.
  if p_preferred_delivery is not null and p_preferred_delivery <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_preferred_delivery) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(p_preferred_delivery) as k
                   where k not in ('date', 'period', 'note'))
       or pg_catalog.jsonb_typeof(p_preferred_delivery -> 'date') is distinct from 'string'
       or (p_preferred_delivery ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(pg_catalog.jsonb_typeof(p_preferred_delivery -> 'period'), 'null') not in ('string', 'null')
       or coalesce(pg_catalog.jsonb_typeof(p_preferred_delivery -> 'note'), 'null') not in ('string', 'null') then
      raise exception 'ZELL_PREFERRED_DELIVERY_INVALID' using errcode = '45415';
    end if;
    begin
      v_pref_date := (p_preferred_delivery ->> 'date')::date;
    exception when others then
      raise exception 'ZELL_PREFERRED_DELIVERY_INVALID' using errcode = '45415';
    end;
    if pg_catalog.to_char(v_pref_date, 'YYYY-MM-DD') <> (p_preferred_delivery ->> 'date') then
      raise exception 'ZELL_PREFERRED_DELIVERY_INVALID' using errcode = '45415';
    end if;
    v_pref_period := nullif(p_preferred_delivery ->> 'period', '');
    v_pref_note := nullif(pg_catalog.btrim(coalesce(p_preferred_delivery ->> 'note', '')), '');
    if v_pref_date < (pg_catalog.now() at time zone 'Africa/Cairo')::date
       or v_pref_date > (pg_catalog.now() at time zone 'Africa/Cairo')::date + 60
       or (v_pref_period is not null and v_pref_period not in ('morning', 'noon', 'evening'))
       or (v_pref_note is not null and pg_catalog.char_length(v_pref_note) > 200) then
      raise exception 'ZELL_PREFERRED_DELIVERY_INVALID' using errcode = '45415';
    end if;
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
  -- (ز٢) 0019: كود الخصم — كوبون واحد، والحكم هنا مش في المتصفح
  --
  --     ⚠ الكوبون بيتقفل FOR UPDATE بعد قفل الموبايل (ج): كل الأوردرات اللي بتستخدم نفس
  --       الكود بتمشي واحد ورا التاني لحد الـcommit، فالعدّ تحت مايعدّيش max_uses.
  --     ⚠ الاستخدام بيتعد من الأوردرات نفسها غير الملغية — مفيش عدّاد يتلخبط، والإلغاء بيحرر
  --       الاستخدام. والإلغاء نهائي (trigger orders_cancelled_final) فمايرجعش يعدّي الحد.
  --     ⚠ من غير كود: ولا سطر هنا بيتنفذ، والمسار زي القديم بالحرف.
  ------------------------------------------------------------------
  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_coupon_code, ''), 'NFC'))), '');
  v_discount := 0;
  if v_code is not null then
    select s.value into v_cp_enabled from public.settings s where s.key = 'coupons_enabled';
    if v_cp_enabled is null or v_cp_enabled <> 'true'::jsonb then
      raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
    end if;
    if v_code !~ '^[A-Z0-9_-]{4,32}$' then
      raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
    end if;

    select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
           c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses, c.max_uses_per_phone
      into v_cp_id, v_cp_active, v_cp_kind, v_cp_percent, v_cp_amount, v_cp_max,
           v_cp_min, v_cp_starts, v_cp_ends, v_cp_uses, v_cp_per_phone
    from public.coupons c
    where c.code = v_code
    for update;

    if v_cp_id is null or not v_cp_active then
      raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
    end if;
    -- نصف مفتوح: starts_at <= now() < ends_at
    if (v_cp_starts is not null and pg_catalog.now() < v_cp_starts)
       or (v_cp_ends is not null and pg_catalog.now() >= v_cp_ends) then
      raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
    end if;
    if v_cp_uses is not null then
      select pg_catalog.count(*)::integer into v_cp_used
      from public.orders o
      where o.coupon_id = v_cp_id and o.status <> 'cancelled';
      if v_cp_used >= v_cp_uses then
        raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
      end if;
    end if;
    if v_cp_per_phone is not null then
      select pg_catalog.count(*)::integer into v_cp_used
      from public.orders o
      where o.coupon_id = v_cp_id and o.customer_phone = p_customer_phone and o.status <> 'cancelled';
      if v_cp_used >= v_cp_per_phone then
        raise exception 'ZELL_COUPON_PHONE_LIMIT' using errcode = '45074';
      end if;
    end if;
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
      -- 0019: الخصم على الأصناف بس — مش على الشحن ولا التركيب ولا الانتقال. الشحن المجاني
      --       فوق (ship) على subtotal قبل الخصم. نفس المعادلة في قيد orders_discount_shape.
      disc as (
        select f.*,
               case
                 when v_code is null then 0::numeric
                 when v_cp_kind = 'percent' then
                   least(pg_catalog.round((f.subtotal * v_cp_percent::numeric) / 100.0),
                         coalesce(v_cp_max::numeric, f.subtotal),
                         f.subtotal)
                 else least(v_cp_amount::numeric, f.subtotal)
               end as discount
        from fees f
      ),
      new_order as (
        insert into public.orders (
          order_number, customer_name, customer_phone, governorate, address, notes,
          subtotal_piastres, shipping_piastres, total_piastres,
          idempotency_key, request_hash, checkout_session_hash,
          receipt_token_hash, receipt_expires_at,
          -- 0018
          shipping_area, installation_requested, installation_rate_piastres,
          installation_length_cm, installation_piastres, installation_travel_piastres,
          -- 0019
          coupon_id, coupon_code, coupon_kind, coupon_percent, coupon_amount_piastres,
          coupon_max_discount_piastres, discount_piastres,
          -- 0021-D
          preferred_delivery_date, preferred_delivery_period, preferred_delivery_note
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
          (s.subtotal - s.discount + s.shipping + s.inst_fee + s.travel)::integer,
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
          s.travel::integer,
          -- 0019: لقطة الكوبون وقت الأوردر
          v_cp_id,
          v_code,
          v_cp_kind,
          case when v_cp_kind = 'percent' then v_cp_percent end,
          case when v_cp_kind = 'fixed' then v_cp_amount end,
          case when v_cp_kind = 'percent' then v_cp_max end,
          s.discount::integer,
          v_pref_date, v_pref_period, v_pref_note
        from disc s
        where s.ok_count > 0
          and s.ok_count = v_req_count
          and s.subtotal >= 0
          and (s.subtotal + s.shipping + s.inst_fee + s.travel) <= c_int4_max
          -- 0019: الحد الأدنى على الأصناف قبل الخصم، والخصم لازم ≥ ١ قرش. غير كده مفيش إدخال،
          --       والسبب بيتحدد تحت (ط) بعد فحوصات القديم زي ما هي.
          and (v_code is null or (s.subtotal >= v_cp_min and s.discount >= 1))
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        -- ⚠ 0006c: receipt_expires_at مضاف للـreturning
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres,
                  receipt_expires_at,
                  shipping_area, installation_requested, installation_piastres, installation_travel_piastres,
                  discount_piastres, coupon_code
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
             o.shipping_area, o.installation_requested, o.installation_piastres, o.installation_travel_piastres,
             o.discount_piastres, o.coupon_code
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
      -- 0019
      'discount_piastres', v_order.discount_piastres,
      'coupon_code', v_order.coupon_code,
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

  -- 0019: سبب رفض الكود — الأصناف كلها صالحة هنا، فـv_subtotal هو نفس subtotal الإدخال.
  --       الرسالة كود بس (من غير أرقام) — المتجر بيبني نص العميل من بياناته هو.
  if v_code is not null then
    if v_subtotal < v_cp_min then
      raise exception 'ZELL_COUPON_MIN_SUBTOTAL' using errcode = '45073';
    end if;
    v_discount := case
      when v_cp_kind = 'percent' then
        least(pg_catalog.round((v_subtotal * v_cp_percent::numeric) / 100.0),
              coalesce(v_cp_max::numeric, v_subtotal),
              v_subtotal)
      else least(v_cp_amount::numeric, v_subtotal)
    end;
    if v_discount < 1 then
      raise exception 'ZELL_COUPON_NOT_APPLICABLE' using errcode = '45075';
    end if;
  end if;

  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$function$
;

-- المالك والصلاحيات زي القديم بالظبط (proacl اتحفظ في الـ preflight).
do $d2own$
declare
  v_owner text := pg_catalog.current_setting('zell.d_owner');
  v_acl   aclitem[] := nullif(pg_catalog.current_setting('zell.d_acl'), '')::aclitem[];
  v_fn    text := 'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)';
  v_tmp   boolean := false;
  r       record;
begin
  execute 'revoke all on function ' || v_fn || ' from public, anon, authenticated, service_role';
  if v_acl is null then
    execute 'grant execute on function ' || v_fn || ' to public';
  else
    for r in
      select distinct a.grantee from pg_catalog.aclexplode(v_acl) a
       where a.privilege_type = 'EXECUTE' and a.grantee <> (select o.oid from pg_catalog.pg_roles o where o.rolname = v_owner)
    loop
      execute 'grant execute on function ' || v_fn || ' to '
              || case when r.grantee = 0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(r.grantee)) end;
    end loop;
  end if;
  if v_owner <> current_user then
    if not pg_catalog.has_schema_privilege(v_owner, 'public', 'CREATE') then
      execute pg_catalog.format('grant create on schema public to %I', v_owner);
      v_tmp := true;
    end if;
    execute pg_catalog.format('alter function %s owner to %I', v_fn, v_owner);
    if v_tmp then
      execute pg_catalog.format('revoke create on schema public from %I', v_owner);
    end if;
  end if;
end
$d2own$;

-- (3) الإيصال: مفتاح preferred_delivery بس (CREATE OR REPLACE = نفس المالك والصلاحيات).
CREATE OR REPLACE FUNCTION public.zell_get_order_receipt(p_order_number text, p_receipt_token_hash text)
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
         -- 0019
         o.discount_piastres,
         o.coupon_code,
         -- 0021-D: الموعد المفضّل (لقطة الطلب)
         o.preferred_delivery_date,
         o.preferred_delivery_period,
         o.preferred_delivery_note,
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
    -- 0019
    'discount_piastres',            v_row.discount_piastres,
    'coupon_code',                  v_row.coupon_code,
    -- 0021-D: «موعد مفضل — بانتظار التأكيد» (null للأوردرات من غير موعد)
    'preferred_delivery', case when v_row.preferred_delivery_date is null then null
      else pg_catalog.jsonb_build_object('date', pg_catalog.to_char(v_row.preferred_delivery_date, 'YYYY-MM-DD'),
                                         'period', v_row.preferred_delivery_period,
                                         'note', v_row.preferred_delivery_note) end,
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
$function$
;

-- (4) أوقات الفترات للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_role بس.
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create function public.zell_checkout_delivery_periods()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'period', p.period,
           'starts_at', pg_catalog.to_char(p.starts_at, 'HH24:MI'),
           'ends_at', pg_catalog.to_char(p.ends_at, 'HH24:MI'))
         order by case p.period when 'morning' then 1 when 'noon' then 2 else 3 end), '[]'::jsonb)
    from public.order_delivery_periods p
$fn$;
revoke all on function public.zell_checkout_delivery_periods() from public, anon, authenticated, service_role;
grant execute on function public.zell_checkout_delivery_periods() to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (5) postflight
do $d5post$
declare
  v_owner text := pg_catalog.current_setting('zell.d_owner');
  v_acl   aclitem[] := nullif(pg_catalog.current_setting('zell.d_acl'), '')::aclitem[];
  v_oid   oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)');
  v_r     oid := pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)');
  v_c     oid := pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()');
  v_old   text;
  v_new   text;
begin
  if v_oid is null or (select pg_catalog.count(*) from pg_catalog.pg_proc p
                        where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1
     or pg_catalog.pg_get_function_identity_arguments(v_oid) <> 'p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text, p_installation boolean, p_coupon_code text, p_preferred_delivery jsonb' then
    raise exception 'ZELL_0021D_POST_SIGNATURE';
  end if;
  if not (select pg_catalog.pg_get_userbyid(p.proowner) = v_owner and p.prosecdef and p.proconfig = array['search_path=""']
            from pg_catalog.pg_proc p where p.oid = v_oid) then
    raise exception 'ZELL_0021D_POST_SHAPE';
  end if;
  select coalesce(pg_catalog.string_agg(x, ',' order by x), '') into v_old from (
    select distinct case when a.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(a.grantee) end || ':' || a.privilege_type as x
      from pg_catalog.aclexplode(coalesce(v_acl, pg_catalog.acldefault('f', (select o.oid from pg_catalog.pg_roles o where o.rolname = v_owner)))) a) s;
  select coalesce(pg_catalog.string_agg(x, ',' order by x), '') into v_new from (
    select distinct case when a.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(a.grantee) end || ':' || a.privilege_type as x
      from pg_catalog.pg_proc p,
           pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     where p.oid = v_oid) s;
  if v_old <> v_new then
    raise exception 'ZELL_0021D_POST_ACL % <> %', v_new, v_old;
  end if;
  if not (pg_catalog.has_column_privilege(v_owner, 'public.orders', 'preferred_delivery_date', 'INSERT')
          and pg_catalog.has_column_privilege(v_owner, 'public.orders', 'preferred_delivery_period', 'INSERT')
          and pg_catalog.has_column_privilege(v_owner, 'public.orders', 'preferred_delivery_note', 'INSERT')) then
    raise exception 'ZELL_0021D_POST_OWNER_COLUMNS';
  end if;
  if v_r is null or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_r) = '711a5447be1c289cfb8bafe19199f1ce'
     or (select p.prosrc from pg_catalog.pg_proc p where p.oid = v_r) not like '%preferred_delivery%'
     or not pg_catalog.has_column_privilege((select p.proowner from pg_catalog.pg_proc p where p.oid = v_r), 'public.orders', 'preferred_delivery_date', 'SELECT') then
    raise exception 'ZELL_0021D_POST_RECEIPT';
  end if;
  if v_c is null
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_c) <> 'zell_order_definer'
     or not pg_catalog.has_function_privilege('service_role', v_c, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_c, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_c, 'EXECUTE') then
    raise exception 'ZELL_0021D_POST_PERIODS';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_preferred_delivery_shape') then
    raise exception 'ZELL_0021D_POST_CONSTRAINT';
  end if;
end
$d5post$;
-- <<< 0021D BODY
commit;
