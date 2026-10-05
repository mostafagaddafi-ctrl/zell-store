-- اختبارات 0019 — ممنوع تتنفّذ كـmigration. كل DO هنا بيخلص بـraise exception فكل حاجة بترجع.
--
-- ⚠ مفيش أي نداء للدالة الحقيقية public.zell_create_order ولا public.zell_get_order_receipt — ولا جوه الـrollback.
--   الاختبار على نسخ: zell_create_order_ptest_old (من التعريف الحالي قبل الـmigration) و zell_create_order_ptest
--   (من التعريف الجديد بعدها)، بتتعمل وتتشال جوه نفس المعاملة.
-- ⚠ الـsequences (orders_id_seq · order_items_id_seq · coupons_id_seq) مابترجعش مع الـrollback — فجوات عادية.
-- ⚠ الـmigration جوه كل DO بتاخد قفل على orders لثانية أو اتنين (ALTER TABLE) — أوردرات المتجر بتستنى ومابتضيعش.
-- ⚠ نتيجة كل DO قصيرة عن قصد (رسالة الخطأ بتتقص بعد ~2KB في بعض الأدوات).
--
-- (1)  DRY-RUN   — الـmigration ×2 + الرجوع ×2 + RB_BLOCK + الصلاحيات.
-- (2a) PARITY_A  — من غير كود: الجديدة = القديمة (أرقام + بصمة صف الأوردر والأصناف) + أخطاء الرفض.
-- (2b) PARITY_B  — الشحن المجاني · overflow · replay · الإيصال · أشكال النداء (10 معامل · named 12).
-- (3)  COUPONS   — نسبة/ثابت/سقف/حد أدنى/تواريخ نصف مفتوحة/تفعيل/شكل الكود/تقريب/شحن مجاني/فني/خصم صفر/اللقطة.
-- (4a) USAGE_A   — max_uses · لكل موبايل · الإلغاء بيحرر · الإلغاء نهائي في الداتابيز · replay · نفس المفتاح بهاش تاني.
-- (4b) USAGE_B   — المعاينة (مابتكتبش) · قيود الجدول · الصلاحيات والفهارس وترتيب الأقفال.

-- (1) DRY-RUN: migration ×2 + rollback ×2 + RB_BLOCK. مفيش نداء لأي zell_create_order.
--     المتوقع: same_before_after=true · same_mig=true · rbblock=ZELL_0019_ROLLBACK_HAS_COUPON_ORDERS ·
--     new=3e9de266… · receipt=711a5447… · old=∅ بعد الـmigration و 635e6613… بعد الرجوع.
do $zdry$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  v_rb text := $zrb$
-- (0) preflight: قفل الأوردرات عشان مفيش أوردر بكوبون يدخل بين الفحص والرجوع،
--     ووقف كامل لو في أي أوردر استخدم كوبون، أو التعريف الحالي مش بتاع 0019.
lock table public.orders in share row exclusive mode;
do $zrbpre$
begin
  if exists (select 1 from public.orders o where o.coupon_id is not null or o.discount_piastres <> 0) then
    raise exception 'ZELL_0019_ROLLBACK_HAS_COUPON_ORDERS';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')) is distinct from '3e9de2663e97ed6225778c053ce65380' then
    raise exception 'ZELL_0019_ROLLBACK_UNEXPECTED_ORDER_FUNCTION';
  end if;
end
$zrbpre$;

-- (1) سلوك الحالات القديم: الإلغاء يرجع يتعدّل زي قبل 0019
drop trigger orders_cancelled_final on public.orders;
drop function public.zell_orders_cancelled_final();

-- (2) الدوال: المعاينة تتشال، والأوردر والإيصال يرجعوا بتعريفهم القديم بالحرف
drop function public.zell_preview_coupon(text);
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false)
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
$function$;
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean) to service_role, zell_order_writer;
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
$function$;
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (3) القيود والفهارس والأعمدة
alter table public.orders drop constraint orders_discount_shape;
alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent CHECK (((total_piastres)::bigint = ((((subtotal_piastres)::bigint + (shipping_piastres)::bigint) + (installation_piastres)::bigint) + (installation_travel_piastres)::bigint)));
drop index public.orders_coupon_phone_active_idx;
drop index public.orders_coupon_active_idx;
alter table public.orders
  drop column discount_piastres,
  drop column coupon_max_discount_piastres,
  drop column coupon_amount_piastres,
  drop column coupon_percent,
  drop column coupon_kind,
  drop column coupon_code,
  drop column coupon_id;

-- (4) الجدول والمفتاح
drop table public.coupons;
delete from public.settings where key = 'coupons_enabled';

notify pgrst, 'reload schema';

$zrb$;
  b text; m1 text; m2 text; a1 text; a2 text; rbblock text; privs text;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  b := (select pg_catalog.concat_ws(' ~ ',
    'old=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')), '∅'),
    'new=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')), '∅'),
    'receipt=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')), '∅'),
    'preview=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')), '∅'),
    'final_fn=' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                              where p.oid = pg_catalog.to_regprocedure('public.zell_orders_cancelled_final()')), '∅'),
    'coupons=' || coalesce(pg_catalog.to_regclass('public.coupons')::text, '∅'),
    'total=' || coalesce((select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
                           where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent'), '∅'),
    'shape=' || (select pg_catalog.count(*) from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_discount_shape')::text,
    'cols=' || (select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped),
    'triggers=' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal)::text,
    'idx=' || (select pg_catalog.count(*) from pg_catalog.pg_indexes i
                where i.schemaname = 'public' and i.indexname in ('orders_coupon_active_idx', 'orders_coupon_phone_active_idx'))::text,
    'setting=' || (select pg_catalog.count(*) from public.settings s where s.key = 'coupons_enabled')::text,
    'rows=' || (select pg_catalog.count(*) from public.orders)::text || '/' || (select pg_catalog.count(*) from public.order_items)::text));
  execute v_mig;
  m1 := (select pg_catalog.concat_ws(' ~ ',
    'old=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')), '∅'),
    'new=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')), '∅'),
    'receipt=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')), '∅'),
    'preview=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')), '∅'),
    'final_fn=' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                              where p.oid = pg_catalog.to_regprocedure('public.zell_orders_cancelled_final()')), '∅'),
    'coupons=' || coalesce(pg_catalog.to_regclass('public.coupons')::text, '∅'),
    'total=' || coalesce((select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
                           where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent'), '∅'),
    'shape=' || (select pg_catalog.count(*) from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_discount_shape')::text,
    'cols=' || (select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped),
    'triggers=' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal)::text,
    'idx=' || (select pg_catalog.count(*) from pg_catalog.pg_indexes i
                where i.schemaname = 'public' and i.indexname in ('orders_coupon_active_idx', 'orders_coupon_phone_active_idx'))::text,
    'setting=' || (select pg_catalog.count(*) from public.settings s where s.key = 'coupons_enabled')::text,
    'rows=' || (select pg_catalog.count(*) from public.orders)::text || '/' || (select pg_catalog.count(*) from public.order_items)::text));
  privs := (select pg_catalog.concat_ws(' ',
    'anon_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('anon', 'public.coupons', 'select')::text, 1),
    'auth_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('authenticated', 'public.coupons', 'select')::text, 1),
    'sr_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'select')::text, 1),
    'sr_ins=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'insert')::text, 1),
    'sr_upd=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'update')::text, 1),
    'sr_del=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'delete')::text, 1),
    'sr_trunc=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'truncate')::text, 1),
    'anon_seq=' || pg_catalog.left(pg_catalog.has_sequence_privilege('anon', 'public.coupons_id_seq', 'usage')::text, 1),
    'sr_seq=' || pg_catalog.left(pg_catalog.has_sequence_privilege('service_role', 'public.coupons_id_seq', 'usage')::text, 1),
    'rls=' || (select pg_catalog.left(c.relrowsecurity::text, 1) from pg_catalog.pg_class c where c.oid = 'public.coupons'::regclass),
    'fn_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_auth=' || pg_catalog.left(pg_catalog.has_function_privilege('authenticated', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_sr=' || pg_catalog.left(pg_catalog.has_function_privilege('service_role', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_writer=' || pg_catalog.left(pg_catalog.has_function_privilege('zell_order_writer', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'pv_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_auth=' || pg_catalog.left(pg_catalog.has_function_privilege('authenticated', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_sr=' || pg_catalog.left(pg_catalog.has_function_privilege('service_role', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_writer=' || pg_catalog.left(pg_catalog.has_function_privilege('zell_order_writer', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'rc_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_get_order_receipt(text,text)', 'execute')::text, 1),
    'final_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_orders_cancelled_final()', 'execute')::text, 1),
    'pv_secdef=' || (select pg_catalog.left(p.prosecdef::text, 1) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')),
    'pv_vol=' || (select p.provolatile::text from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')),
    'lock_order=' || (select pg_catalog.left((pg_catalog.strpos(p.prosrc, 'for update') > pg_catalog.strpos(p.prosrc, 'pg_advisory_xact_lock')
                        and pg_catalog.strpos(p.prosrc, 'pg_advisory_xact_lock') > 0)::text, 1)
                      from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'idx_total=' || coalesce((select pg_catalog.left((i.indexdef like '%(coupon_id) WHERE ((coupon_id IS NOT NULL) AND (status <> ''cancelled''::text))')::text, 1)
                               from pg_catalog.pg_indexes i where i.indexname = 'orders_coupon_active_idx'), '∅'),
    'idx_phone=' || coalesce((select pg_catalog.left((i.indexdef like '%(coupon_id, customer_phone) WHERE ((coupon_id IS NOT NULL) AND (status <> ''cancelled''::text))')::text, 1)
                               from pg_catalog.pg_indexes i where i.indexname = 'orders_coupon_phone_active_idx'), '∅'),
    'trigger=' || (select pg_catalog.count(*)::text from pg_catalog.pg_trigger t
                    where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_cancelled_final' and not t.tgisinternal)));
  begin
    insert into public.coupons (code, kind, percent_off) values ('RBTEST', 'percent', 10);
    insert into public.orders (order_number, customer_name, customer_phone, governorate, address,
                               subtotal_piastres, shipping_piastres, total_piastres,
                               coupon_id, coupon_code, coupon_kind, coupon_percent, discount_piastres)
    select 'FLM-RBTST2', 'تجربة', '01000000000', 'القاهرة', 'شارع التجربة ١٢٣', 10000, 0, 9000,
           c.id, 'RBTEST', 'percent', 10, 1000
    from public.coupons c where c.code = 'RBTEST';
    execute v_rb;
    rbblock := 'NOT_BLOCKED';
  exception when others then
    rbblock := sqlerrm;
  end;
  execute v_rb;
  a1 := (select pg_catalog.concat_ws(' ~ ',
    'old=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')), '∅'),
    'new=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')), '∅'),
    'receipt=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')), '∅'),
    'preview=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')), '∅'),
    'final_fn=' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                              where p.oid = pg_catalog.to_regprocedure('public.zell_orders_cancelled_final()')), '∅'),
    'coupons=' || coalesce(pg_catalog.to_regclass('public.coupons')::text, '∅'),
    'total=' || coalesce((select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
                           where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent'), '∅'),
    'shape=' || (select pg_catalog.count(*) from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_discount_shape')::text,
    'cols=' || (select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped),
    'triggers=' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal)::text,
    'idx=' || (select pg_catalog.count(*) from pg_catalog.pg_indexes i
                where i.schemaname = 'public' and i.indexname in ('orders_coupon_active_idx', 'orders_coupon_phone_active_idx'))::text,
    'setting=' || (select pg_catalog.count(*) from public.settings s where s.key = 'coupons_enabled')::text,
    'rows=' || (select pg_catalog.count(*) from public.orders)::text || '/' || (select pg_catalog.count(*) from public.order_items)::text));
  execute v_mig;
  m2 := (select pg_catalog.concat_ws(' ~ ',
    'old=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')), '∅'),
    'new=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')), '∅'),
    'receipt=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')), '∅'),
    'preview=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')), '∅'),
    'final_fn=' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                              where p.oid = pg_catalog.to_regprocedure('public.zell_orders_cancelled_final()')), '∅'),
    'coupons=' || coalesce(pg_catalog.to_regclass('public.coupons')::text, '∅'),
    'total=' || coalesce((select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
                           where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent'), '∅'),
    'shape=' || (select pg_catalog.count(*) from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_discount_shape')::text,
    'cols=' || (select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped),
    'triggers=' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal)::text,
    'idx=' || (select pg_catalog.count(*) from pg_catalog.pg_indexes i
                where i.schemaname = 'public' and i.indexname in ('orders_coupon_active_idx', 'orders_coupon_phone_active_idx'))::text,
    'setting=' || (select pg_catalog.count(*) from public.settings s where s.key = 'coupons_enabled')::text,
    'rows=' || (select pg_catalog.count(*) from public.orders)::text || '/' || (select pg_catalog.count(*) from public.order_items)::text));
  execute v_rb;
  a2 := (select pg_catalog.concat_ws(' ~ ',
    'old=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')), '∅'),
    'new=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, '-')
                         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')), '∅'),
    'receipt=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')), '∅'),
    'preview=' || coalesce((select pg_catalog.md5(p.prosrc) || ' ' || p.proacl::text from pg_catalog.pg_proc p
                             where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')), '∅'),
    'final_fn=' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                              where p.oid = pg_catalog.to_regprocedure('public.zell_orders_cancelled_final()')), '∅'),
    'coupons=' || coalesce(pg_catalog.to_regclass('public.coupons')::text, '∅'),
    'total=' || coalesce((select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
                           where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent'), '∅'),
    'shape=' || (select pg_catalog.count(*) from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_discount_shape')::text,
    'cols=' || (select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped),
    'triggers=' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal)::text,
    'idx=' || (select pg_catalog.count(*) from pg_catalog.pg_indexes i
                where i.schemaname = 'public' and i.indexname in ('orders_coupon_active_idx', 'orders_coupon_phone_active_idx'))::text,
    'setting=' || (select pg_catalog.count(*) from public.settings s where s.key = 'coupons_enabled')::text,
    'rows=' || (select pg_catalog.count(*) from public.orders)::text || '/' || (select pg_catalog.count(*) from public.order_items)::text));
  raise exception 'ZDRY%', E'\nsame_before_after=' || (b = a1 and b = a2)::text
    || E'\nsame_mig=' || (m1 = m2)::text
    || E'\nrbblock=' || rbblock
    || E'\nbefore_md5=' || pg_catalog.md5(b) || ' after1_md5=' || pg_catalog.md5(a1) || ' after2_md5=' || pg_catalog.md5(a2)
    || E'\nmig_new=' || substring(m1 from 'new=([0-9a-f]{32})') || ' receipt=' || substring(m1 from 'receipt=([0-9a-f]{32})')
    || ' preview=' || substring(m1 from 'preview=([0-9a-f]{32})') || ' old=' || substring(m1 from 'old=(\S+)')
    || E'\nmig_acl_new=' || substring(m1 from 'new=[0-9a-f]{32} (\{[^}]*\}) ')
    || E'\nmig_total=' || substring(m1 from 'total=(CHECK.*?\)\)\)) ~')
    || E'\nmig_tail=' || substring(m1 from '(shape=.*)$')
    || E'\nafter_old=' || substring(a2 from 'old=([0-9a-f]{32})') || ' after_receipt=' || substring(a2 from 'receipt=([0-9a-f]{32})')
    || E'\nprivs=' || privs;
end
$zdry$;

-- (2a) PARITY: من غير كود الجديدة = نسخة القديمة (الأرقام + بصمة صف الأوردر والأصناف). المتوقع كله SAME.
do $zpa$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  res text[] := '{}';
  o text; n text; o2 text; n2 text; k text; rq text; ord text; t text;
  r1 jsonb; r2 jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest_old(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest_old(');
  execute v_mig;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest(');
  create function pg_temp.zt(p_fn text, p_items jsonb, p_phone text, p_gov text, p_area text, p_inst boolean,
                             p_code text, p_keep boolean default false, p_key text default null, p_req text default null)
  returns text language plpgsql as $zt$
  declare
    r jsonb;
    v_out text;
    v_md5 text;
    v_key text := coalesce(p_key, 'ptest-' || pg_catalog.gen_random_uuid()::text);
    v_req text := coalesce(p_req, pg_catalog.md5(pg_catalog.gen_random_uuid()::text) || pg_catalog.md5(pg_catalog.gen_random_uuid()::text));
  begin
    begin
      if p_fn = 'new' then
        r := public.zell_create_order_ptest(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst, p_code);
      else
        r := public.zell_create_order_ptest_old(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst);
      end if;
      select pg_catalog.md5(
               (pg_catalog.to_jsonb(o) - array['id', 'order_number', 'created_at', 'updated_at', 'receipt_expires_at',
                 'idempotency_key', 'request_hash', 'checkout_session_hash', 'receipt_token_hash', 'receipt_token_hash_prev',
                 'coupon_id', 'coupon_code', 'coupon_kind', 'coupon_percent', 'coupon_amount_piastres',
                 'coupon_max_discount_piastres', 'discount_piastres']::text[])::text
               || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - array['id', 'order_id']::text[] order by i.id)::text
                            from public.order_items i where i.order_id = o.id), '[]'))
        into v_md5
      from public.orders o where o.order_number = r ->> 'order_number';
      v_out := pg_catalog.concat_ws('|', 'ok', r ->> 'subtotal_piastres', r ->> 'shipping_piastres',
                 coalesce(r ->> 'discount_piastres', '-'), r ->> 'installation_piastres', r ->> 'installation_travel_piastres',
                 r ->> 'total_piastres', coalesce(r ->> 'coupon_code', '-'), r ->> 'replayed', pg_catalog.left(v_md5, 8));
      if not p_keep then
        raise exception 'ZT_ROLLBACK';
      end if;
    exception when others then
      if sqlerrm <> 'ZT_ROLLBACK' then
        v_out := 'E' || sqlstate;
      end if;
    end;
    return v_out;
  end
  $zt$;

  create function pg_temp.zpar(o text, n text) returns text language sql as $zp$
    select case
      when pg_catalog.left(o, 1) = 'E' or pg_catalog.left(n, 1) = 'E' then case when o = n then 'SAME' else 'DIFF old=' || o || ' new=' || n end
      when pg_catalog.split_part(o, '|', 2) = pg_catalog.split_part(n, '|', 2)
       and pg_catalog.split_part(o, '|', 3) = pg_catalog.split_part(n, '|', 3)
       and pg_catalog.split_part(o, '|', 5) = pg_catalog.split_part(n, '|', 5)
       and pg_catalog.split_part(o, '|', 6) = pg_catalog.split_part(n, '|', 6)
       and pg_catalog.split_part(o, '|', 7) = pg_catalog.split_part(n, '|', 7)
       and pg_catalog.split_part(o, '|', 9) = pg_catalog.split_part(n, '|', 9)
       and pg_catalog.split_part(o, '|', 10) = pg_catalog.split_part(n, '|', 10)
       and pg_catalog.split_part(n, '|', 4) = '0'
       and pg_catalog.split_part(n, '|', 8) = '-' then 'SAME'
      else 'DIFF old=' || o || ' new=' || n end
  $zp$;

  create function pg_temp.zshort(n text) returns text language sql as $zs$
    select case when pg_catalog.left(n, 1) = 'E' then n
      else pg_catalog.concat_ws('|', pg_catalog.split_part(n, '|', 2), pg_catalog.split_part(n, '|', 3), pg_catalog.split_part(n, '|', 4),
             pg_catalog.split_part(n, '|', 5), pg_catalog.split_part(n, '|', 6), pg_catalog.split_part(n, '|', 7),
             pg_catalog.split_part(n, '|', 8))
           || case when pg_catalog.split_part(n, '|', 9) = 'true' then '|R' else '' end end
  $zs$;

  o := pg_temp.zt('old', '[{"productId":1,"lengthCm":300}]', '01000000101', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":1,"lengthCm":300}]', '01000000101', 'القاهرة', null, false, null);
  res := res || ('N1 ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":3,"lengthCm":350,"widthCm":120}]', '01000000102', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":3,"lengthCm":350,"widthCm":120}]', '01000000102', 'القاهرة', null, false, null);
  res := res || ('N2 ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500},{"productId":21,"quantity":2}]', '01000000103', 'الجيزة', 'فيصل', false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500},{"productId":21,"quantity":2}]', '01000000103', 'الجيزة', 'فيصل', false, null);
  res := res || ('N3 ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000104', 'الجيزة', 'الهرم', true, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000104', 'الجيزة', 'الهرم', true, null);
  res := res || ('N4 ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500},{"productId":3,"lengthCm":300},{"productId":21,"quantity":1}]', '01000000105', 'الجيزة', 'أكتوبر', true, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500},{"productId":3,"lengthCm":300},{"productId":21,"quantity":1}]', '01000000105', 'الجيزة', 'أكتوبر', true, null);
  res := res || ('N5 ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000107', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000107', 'القاهرة', null, false, '');
  res := res || ('N7a ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000108', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000108', 'القاهرة', null, false, '   ');
  res := res || ('N7b ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '0123', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '0123', 'القاهرة', null, false, null);
  res := res || ('N8a ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[]', '01000000110', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[]', '01000000110', 'القاهرة', null, false, null);
  res := res || ('N8b ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":550}]', '01000000111', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":550}]', '01000000111', 'القاهرة', null, false, null);
  res := res || ('N8c ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000112', 'مكان مجهول', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000112', 'مكان مجهول', null, false, null);
  res := res || ('N8d ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000113', 'القاهرة', 'الدقي', false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000113', 'القاهرة', 'الدقي', false, null);
  res := res || ('N8e ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":21,"quantity":1}]', '01000000114', 'الجيزة', 'الهرم', true, null);
  n := pg_temp.zt('new', '[{"productId":21,"quantity":1}]', '01000000114', 'الجيزة', 'الهرم', true, null);
  res := res || ('N8f ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000115', 'القاهرة', 'مدينة نصر', true, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000115', 'القاهرة', 'مدينة نصر', true, null);
  res := res || ('N8g ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));

  raise exception 'ZRESULT PARITY_A%', E'\n' || pg_catalog.array_to_string(res, E'\n');
end
$zpa$;

-- (2b) PARITY: الشحن المجاني · overflow · replay · الإيصال · أشكال النداء (10 معامل · named 12).
do $zpb$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  res text[] := '{}';
  o text; n text; o2 text; n2 text; k text; rq text; ord text; t text;
  r1 jsonb; r2 jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest_old(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest_old(');
  execute v_mig;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest(');
  create function pg_temp.zt(p_fn text, p_items jsonb, p_phone text, p_gov text, p_area text, p_inst boolean,
                             p_code text, p_keep boolean default false, p_key text default null, p_req text default null)
  returns text language plpgsql as $zt$
  declare
    r jsonb;
    v_out text;
    v_md5 text;
    v_key text := coalesce(p_key, 'ptest-' || pg_catalog.gen_random_uuid()::text);
    v_req text := coalesce(p_req, pg_catalog.md5(pg_catalog.gen_random_uuid()::text) || pg_catalog.md5(pg_catalog.gen_random_uuid()::text));
  begin
    begin
      if p_fn = 'new' then
        r := public.zell_create_order_ptest(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst, p_code);
      else
        r := public.zell_create_order_ptest_old(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst);
      end if;
      select pg_catalog.md5(
               (pg_catalog.to_jsonb(o) - array['id', 'order_number', 'created_at', 'updated_at', 'receipt_expires_at',
                 'idempotency_key', 'request_hash', 'checkout_session_hash', 'receipt_token_hash', 'receipt_token_hash_prev',
                 'coupon_id', 'coupon_code', 'coupon_kind', 'coupon_percent', 'coupon_amount_piastres',
                 'coupon_max_discount_piastres', 'discount_piastres']::text[])::text
               || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - array['id', 'order_id']::text[] order by i.id)::text
                            from public.order_items i where i.order_id = o.id), '[]'))
        into v_md5
      from public.orders o where o.order_number = r ->> 'order_number';
      v_out := pg_catalog.concat_ws('|', 'ok', r ->> 'subtotal_piastres', r ->> 'shipping_piastres',
                 coalesce(r ->> 'discount_piastres', '-'), r ->> 'installation_piastres', r ->> 'installation_travel_piastres',
                 r ->> 'total_piastres', coalesce(r ->> 'coupon_code', '-'), r ->> 'replayed', pg_catalog.left(v_md5, 8));
      if not p_keep then
        raise exception 'ZT_ROLLBACK';
      end if;
    exception when others then
      if sqlerrm <> 'ZT_ROLLBACK' then
        v_out := 'E' || sqlstate;
      end if;
    end;
    return v_out;
  end
  $zt$;

  create function pg_temp.zpar(o text, n text) returns text language sql as $zp$
    select case
      when pg_catalog.left(o, 1) = 'E' or pg_catalog.left(n, 1) = 'E' then case when o = n then 'SAME' else 'DIFF old=' || o || ' new=' || n end
      when pg_catalog.split_part(o, '|', 2) = pg_catalog.split_part(n, '|', 2)
       and pg_catalog.split_part(o, '|', 3) = pg_catalog.split_part(n, '|', 3)
       and pg_catalog.split_part(o, '|', 5) = pg_catalog.split_part(n, '|', 5)
       and pg_catalog.split_part(o, '|', 6) = pg_catalog.split_part(n, '|', 6)
       and pg_catalog.split_part(o, '|', 7) = pg_catalog.split_part(n, '|', 7)
       and pg_catalog.split_part(o, '|', 9) = pg_catalog.split_part(n, '|', 9)
       and pg_catalog.split_part(o, '|', 10) = pg_catalog.split_part(n, '|', 10)
       and pg_catalog.split_part(n, '|', 4) = '0'
       and pg_catalog.split_part(n, '|', 8) = '-' then 'SAME'
      else 'DIFF old=' || o || ' new=' || n end
  $zp$;

  create function pg_temp.zshort(n text) returns text language sql as $zs$
    select case when pg_catalog.left(n, 1) = 'E' then n
      else pg_catalog.concat_ws('|', pg_catalog.split_part(n, '|', 2), pg_catalog.split_part(n, '|', 3), pg_catalog.split_part(n, '|', 4),
             pg_catalog.split_part(n, '|', 5), pg_catalog.split_part(n, '|', 6), pg_catalog.split_part(n, '|', 7),
             pg_catalog.split_part(n, '|', 8))
           || case when pg_catalog.split_part(n, '|', 9) = 'true' then '|R' else '' end end
  $zs$;

  begin
    update public.settings set value = '60000'::jsonb where key = 'free_shipping_threshold_piastres';
  o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000106', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000106', 'القاهرة', null, false, null);
  res := res || ('N6a ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
  o := pg_temp.zt('old', '[{"productId":21,"quantity":5}]', '01000000116', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":21,"quantity":5}]', '01000000116', 'القاهرة', null, false, null);
  res := res || ('N6b ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('N6 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    update public.products set max_length_cm = 6000000 where id = 5;
  o := pg_temp.zt('old', '[{"productId":5,"lengthCm":5000000}]', '01000000117', 'القاهرة', null, false, null);
  n := pg_temp.zt('new', '[{"productId":5,"lengthCm":5000000}]', '01000000117', 'القاهرة', null, false, null);
  res := res || ('N8h ' || pg_temp.zpar(o, n) || ' ' || pg_temp.zshort(n));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('N8h ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    rq := pg_catalog.md5('n9') || pg_catalog.md5('n9b');
    k := 'ptest-replay-old-' || pg_catalog.gen_random_uuid()::text;
    o := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000118', 'القاهرة', null, false, null, true, k, rq);
    o2 := pg_temp.zt('old', '[{"productId":2,"lengthCm":500}]', '01000000118', 'القاهرة', null, false, null, true, k, rq);
    k := 'ptest-replay-new-' || pg_catalog.gen_random_uuid()::text;
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000118', 'القاهرة', null, false, null, true, k, rq);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000118', 'القاهرة', null, false, null, true, k, rq);
    res := res || ('N9 replay ' || pg_temp.zpar(o2, n2) || ' ' || pg_temp.zshort(n2));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('N9 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    r1 := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]', 'عميل تجربة', '01000000120', 'القاهرة', 'شارع التجربة رقم ١٢٣', null,
            'ptest-rc-' || pg_catalog.gen_random_uuid()::text, pg_catalog.repeat('c', 64), pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64));
    ord := r1 ->> 'order_number';
    r1 := public.zell_get_order_receipt_ptest_old(ord, pg_catalog.repeat('b', 64));
    r2 := public.zell_get_order_receipt_ptest(ord, pg_catalog.repeat('b', 64));
    res := res || ('N10 receipt same_old_keys=' || ((r2 - array['discount_piastres', 'coupon_code']::text[]) = r1)::text
                   || ' discount=' || (r2 ->> 'discount_piastres') || ' code=' || coalesce(r2 ->> 'coupon_code', 'null'));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('N10 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    r1 := public.zell_create_order_ptest('[{"productId":2,"lengthCm":500}]', 'عميل تجربة', '01000000121', 'القاهرة', 'شارع التجربة رقم ١٢٣', null,
            'ptest-a10-' || pg_catalog.gen_random_uuid()::text, pg_catalog.repeat('d', 64), pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64));
    t := 'args10=' || (r1 ->> 'total_piastres');
    r1 := public.zell_create_order_ptest(p_items => '[{"productId":2,"lengthCm":500}]', p_customer_name => 'عميل تجربة', p_customer_phone => '01000000122',
            p_governorate => 'الجيزة', p_address => 'شارع التجربة رقم ١٢٣', p_notes => null,
            p_idempotency_key => 'ptest-n12-' || pg_catalog.gen_random_uuid()::text, p_request_hash => pg_catalog.repeat('e', 64),
            p_checkout_session_hash => pg_catalog.repeat('a', 64), p_receipt_token_hash => pg_catalog.repeat('b', 64),
            p_area => 'الهرم', p_installation => true);
    t := t || ' named12=' || (r1 ->> 'total_piastres') || '/inst=' || (r1 ->> 'installation_piastres');
    res := res || ('N11 call shapes ' || t);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('N11 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  raise exception 'ZRESULT PARITY_B%', E'\n' || pg_catalog.array_to_string(res, E'\n');
end
$zpb$;

-- (3) COUPONS: قواعد الكود على نسخة الجديدة. النتيجة: sub|ship|disc|inst|travel|total|code أو E<sqlstate>.
do $zcp$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  res text[] := '{}';
  o text; n text; o2 text; n2 text; k text; rq text; ord text; t text;
  r1 jsonb; r2 jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest_old(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest_old(');
  execute v_mig;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest(');
  create function pg_temp.zt(p_fn text, p_items jsonb, p_phone text, p_gov text, p_area text, p_inst boolean,
                             p_code text, p_keep boolean default false, p_key text default null, p_req text default null)
  returns text language plpgsql as $zt$
  declare
    r jsonb;
    v_out text;
    v_md5 text;
    v_key text := coalesce(p_key, 'ptest-' || pg_catalog.gen_random_uuid()::text);
    v_req text := coalesce(p_req, pg_catalog.md5(pg_catalog.gen_random_uuid()::text) || pg_catalog.md5(pg_catalog.gen_random_uuid()::text));
  begin
    begin
      if p_fn = 'new' then
        r := public.zell_create_order_ptest(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst, p_code);
      else
        r := public.zell_create_order_ptest_old(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst);
      end if;
      select pg_catalog.md5(
               (pg_catalog.to_jsonb(o) - array['id', 'order_number', 'created_at', 'updated_at', 'receipt_expires_at',
                 'idempotency_key', 'request_hash', 'checkout_session_hash', 'receipt_token_hash', 'receipt_token_hash_prev',
                 'coupon_id', 'coupon_code', 'coupon_kind', 'coupon_percent', 'coupon_amount_piastres',
                 'coupon_max_discount_piastres', 'discount_piastres']::text[])::text
               || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - array['id', 'order_id']::text[] order by i.id)::text
                            from public.order_items i where i.order_id = o.id), '[]'))
        into v_md5
      from public.orders o where o.order_number = r ->> 'order_number';
      v_out := pg_catalog.concat_ws('|', 'ok', r ->> 'subtotal_piastres', r ->> 'shipping_piastres',
                 coalesce(r ->> 'discount_piastres', '-'), r ->> 'installation_piastres', r ->> 'installation_travel_piastres',
                 r ->> 'total_piastres', coalesce(r ->> 'coupon_code', '-'), r ->> 'replayed', pg_catalog.left(v_md5, 8));
      if not p_keep then
        raise exception 'ZT_ROLLBACK';
      end if;
    exception when others then
      if sqlerrm <> 'ZT_ROLLBACK' then
        v_out := 'E' || sqlstate;
      end if;
    end;
    return v_out;
  end
  $zt$;

  create function pg_temp.zpar(o text, n text) returns text language sql as $zp$
    select case
      when pg_catalog.left(o, 1) = 'E' or pg_catalog.left(n, 1) = 'E' then case when o = n then 'SAME' else 'DIFF old=' || o || ' new=' || n end
      when pg_catalog.split_part(o, '|', 2) = pg_catalog.split_part(n, '|', 2)
       and pg_catalog.split_part(o, '|', 3) = pg_catalog.split_part(n, '|', 3)
       and pg_catalog.split_part(o, '|', 5) = pg_catalog.split_part(n, '|', 5)
       and pg_catalog.split_part(o, '|', 6) = pg_catalog.split_part(n, '|', 6)
       and pg_catalog.split_part(o, '|', 7) = pg_catalog.split_part(n, '|', 7)
       and pg_catalog.split_part(o, '|', 9) = pg_catalog.split_part(n, '|', 9)
       and pg_catalog.split_part(o, '|', 10) = pg_catalog.split_part(n, '|', 10)
       and pg_catalog.split_part(n, '|', 4) = '0'
       and pg_catalog.split_part(n, '|', 8) = '-' then 'SAME'
      else 'DIFF old=' || o || ' new=' || n end
  $zp$;

  create function pg_temp.zshort(n text) returns text language sql as $zs$
    select case when pg_catalog.left(n, 1) = 'E' then n
      else pg_catalog.concat_ws('|', pg_catalog.split_part(n, '|', 2), pg_catalog.split_part(n, '|', 3), pg_catalog.split_part(n, '|', 4),
             pg_catalog.split_part(n, '|', 5), pg_catalog.split_part(n, '|', 6), pg_catalog.split_part(n, '|', 7),
             pg_catalog.split_part(n, '|', 8))
           || case when pg_catalog.split_part(n, '|', 9) = 'true' then '|R' else '' end end
  $zs$;

  update public.settings set value = 'true'::jsonb where key = 'coupons_enabled';
  insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres,
                              starts_at, ends_at, max_uses, max_uses_per_phone, is_active) values
    ('ZELL10',   'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('HALF50',   'percent', 50,   null,    10000, 0,     null, null, null, null, true),
    ('FIX5000',  'fixed',   null, 5000,    null,  0,     null, null, null, null, true),
    ('FIXBIG',   'fixed',   null, 9999999, null,  0,     null, null, null, null, true),
    ('MIN60000', 'percent', 10,   null,    null,  60000, null, null, null, null, true),
    ('MIN60001', 'percent', 10,   null,    null,  60001, null, null, null, null, true),
    ('FUTURE',   'percent', 10,   null,    null,  0,     pg_catalog.now() + interval '1 day', null, null, null, true),
    ('ENDNOW',   'percent', 10,   null,    null,  0,     null, pg_catalog.now(), null, null, true),
    ('STARTNOW', 'percent', 10,   null,    null,  0,     pg_catalog.now(), pg_catalog.now() + interval '1 hour', null, null, true),
    ('OFF10',    'percent', 10,   null,    null,  0,     null, null, null, null, false),
    ('ONCE',     'percent', 10,   null,    null,  0,     null, null, 1,    null, true),
    ('NOLIMIT',  'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('ONE1PCT',  'percent', 1,    null,    null,  0,     null, null, null, null, true);
  insert into public.coupons (code, kind, percent_off) values ('PHONE1', 'percent', 10);
  res := res || ('C1 10% ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000201', 'القاهرة', null, false, 'ZELL10')));
  res := res || ('C3 50%cap10000 ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000203', 'القاهرة', null, false, 'HALF50')));
  res := res || ('C4 fixed5000 ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000204', 'القاهرة', null, false, 'FIX5000')));
  res := res || ('C5 fixed>items ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000205', 'القاهرة', null, false, 'FIXBIG')));
  res := res || ('C6 min=items ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000206', 'القاهرة', null, false, 'MIN60000')));
  res := res || ('C7 min+1 ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000207', 'القاهرة', null, false, 'MIN60001')));
  res := res || ('C8 future ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000208', 'القاهرة', null, false, 'FUTURE')));
  res := res || ('C9 ends=now ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000209', 'القاهرة', null, false, 'ENDNOW')));
  res := res || ('C10 starts=now ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000210', 'القاهرة', null, false, 'STARTNOW')));
  res := res || ('C11 inactive ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000211', 'القاهرة', null, false, 'OFF10')));
  res := res || ('C12 missing ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000212', 'القاهرة', null, false, 'NOPE99')));
  res := res || ('C13 format ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000213', 'القاهرة', null, false, 'AB')));
  res := res || ('C14 lower+spaces ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000214', 'القاهرة', null, false, '  zell10 ')));
  res := res || ('C14b arabic ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000215', 'القاهرة', null, false, 'خصم10')));
  res := res || ('C24 installer+code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000224', 'الجيزة', 'الهرم', true, 'ZELL10')));
  res := res || ('C24b film+tool+code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500},{"productId":21,"quantity":2}]', '01000000225', 'القاهرة', null, false, 'ZELL10')));
  begin
    update public.products set price_per_meter_piastres = 12345 where id = 2;
  res := res || ('C2 round 6172.5 ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000202', 'القاهرة', null, false, 'ZELL10')));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C2 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    update public.settings set value = '60000'::jsonb where key = 'free_shipping_threshold_piastres';
  res := res || ('C23 free ship pre-discount ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000223', 'القاهرة', null, false, 'ZELL10')));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C23 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    update public.products set price_per_meter_piastres = 10 where id = 21;
  res := res || ('C25 discount 0 ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":21,"quantity":1}]', '01000000226', 'القاهرة', null, false, 'ONE1PCT')));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C25 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    update public.products set max_length_cm = 6000000 where id = 5;
  res := res || ('C27 overflow+code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":5,"lengthCm":5000000}]', '01000000232', 'القاهرة', null, false, 'ZELL10')));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C27 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    update public.settings set value = 'false'::jsonb where key = 'coupons_enabled';
  res := res || ('C15a disabled+code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000227', 'القاهرة', null, false, 'ZELL10')));
  res := res || ('C15b disabled no code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000228', 'القاهرة', null, false, null)));
    delete from public.settings where key = 'coupons_enabled';
  res := res || ('C15c no key+code ' || pg_temp.zshort(pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000229', 'القاهرة', null, false, 'ZELL10')));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C15 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000230', 'القاهرة', null, false, 'HALF50', true);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000231', 'القاهرة', null, false, 'FIX5000', true);
    select pg_catalog.string_agg(pg_catalog.concat_ws('|', o.coupon_code, o.coupon_kind, coalesce(o.coupon_percent::text, '-'),
             coalesce(o.coupon_amount_piastres::text, '-'), coalesce(o.coupon_max_discount_piastres::text, '-'),
             o.discount_piastres::text, o.subtotal_piastres::text, o.total_piastres::text, (o.coupon_id is not null)::text), ' ; ' order by o.coupon_code)
      into t
    from public.orders o where o.customer_phone in ('01000000230', '01000000231');
    res := res || ('C26 snapshot ' || t);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C26 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  raise exception 'ZRESULT COUPONS%', E'\n' || pg_catalog.array_to_string(res, E'\n');
end
$zcp$;

-- (4a) USAGE: max_uses · لكل موبايل · الإلغاء بيحرر · الإلغاء نهائي (DB) · replay · نفس المفتاح بهاش تاني.
do $zua$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  res text[] := '{}';
  o text; n text; o2 text; n2 text; k text; rq text; ord text; t text;
  r1 jsonb; r2 jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest_old(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest_old(');
  execute v_mig;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest(');
  create function pg_temp.zt(p_fn text, p_items jsonb, p_phone text, p_gov text, p_area text, p_inst boolean,
                             p_code text, p_keep boolean default false, p_key text default null, p_req text default null)
  returns text language plpgsql as $zt$
  declare
    r jsonb;
    v_out text;
    v_md5 text;
    v_key text := coalesce(p_key, 'ptest-' || pg_catalog.gen_random_uuid()::text);
    v_req text := coalesce(p_req, pg_catalog.md5(pg_catalog.gen_random_uuid()::text) || pg_catalog.md5(pg_catalog.gen_random_uuid()::text));
  begin
    begin
      if p_fn = 'new' then
        r := public.zell_create_order_ptest(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst, p_code);
      else
        r := public.zell_create_order_ptest_old(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst);
      end if;
      select pg_catalog.md5(
               (pg_catalog.to_jsonb(o) - array['id', 'order_number', 'created_at', 'updated_at', 'receipt_expires_at',
                 'idempotency_key', 'request_hash', 'checkout_session_hash', 'receipt_token_hash', 'receipt_token_hash_prev',
                 'coupon_id', 'coupon_code', 'coupon_kind', 'coupon_percent', 'coupon_amount_piastres',
                 'coupon_max_discount_piastres', 'discount_piastres']::text[])::text
               || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - array['id', 'order_id']::text[] order by i.id)::text
                            from public.order_items i where i.order_id = o.id), '[]'))
        into v_md5
      from public.orders o where o.order_number = r ->> 'order_number';
      v_out := pg_catalog.concat_ws('|', 'ok', r ->> 'subtotal_piastres', r ->> 'shipping_piastres',
                 coalesce(r ->> 'discount_piastres', '-'), r ->> 'installation_piastres', r ->> 'installation_travel_piastres',
                 r ->> 'total_piastres', coalesce(r ->> 'coupon_code', '-'), r ->> 'replayed', pg_catalog.left(v_md5, 8));
      if not p_keep then
        raise exception 'ZT_ROLLBACK';
      end if;
    exception when others then
      if sqlerrm <> 'ZT_ROLLBACK' then
        v_out := 'E' || sqlstate;
      end if;
    end;
    return v_out;
  end
  $zt$;

  create function pg_temp.zpar(o text, n text) returns text language sql as $zp$
    select case
      when pg_catalog.left(o, 1) = 'E' or pg_catalog.left(n, 1) = 'E' then case when o = n then 'SAME' else 'DIFF old=' || o || ' new=' || n end
      when pg_catalog.split_part(o, '|', 2) = pg_catalog.split_part(n, '|', 2)
       and pg_catalog.split_part(o, '|', 3) = pg_catalog.split_part(n, '|', 3)
       and pg_catalog.split_part(o, '|', 5) = pg_catalog.split_part(n, '|', 5)
       and pg_catalog.split_part(o, '|', 6) = pg_catalog.split_part(n, '|', 6)
       and pg_catalog.split_part(o, '|', 7) = pg_catalog.split_part(n, '|', 7)
       and pg_catalog.split_part(o, '|', 9) = pg_catalog.split_part(n, '|', 9)
       and pg_catalog.split_part(o, '|', 10) = pg_catalog.split_part(n, '|', 10)
       and pg_catalog.split_part(n, '|', 4) = '0'
       and pg_catalog.split_part(n, '|', 8) = '-' then 'SAME'
      else 'DIFF old=' || o || ' new=' || n end
  $zp$;

  create function pg_temp.zshort(n text) returns text language sql as $zs$
    select case when pg_catalog.left(n, 1) = 'E' then n
      else pg_catalog.concat_ws('|', pg_catalog.split_part(n, '|', 2), pg_catalog.split_part(n, '|', 3), pg_catalog.split_part(n, '|', 4),
             pg_catalog.split_part(n, '|', 5), pg_catalog.split_part(n, '|', 6), pg_catalog.split_part(n, '|', 7),
             pg_catalog.split_part(n, '|', 8))
           || case when pg_catalog.split_part(n, '|', 9) = 'true' then '|R' else '' end end
  $zs$;

  update public.settings set value = 'true'::jsonb where key = 'coupons_enabled';
  insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres,
                              starts_at, ends_at, max_uses, max_uses_per_phone, is_active) values
    ('ZELL10',   'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('HALF50',   'percent', 50,   null,    10000, 0,     null, null, null, null, true),
    ('FIX5000',  'fixed',   null, 5000,    null,  0,     null, null, null, null, true),
    ('FIXBIG',   'fixed',   null, 9999999, null,  0,     null, null, null, null, true),
    ('MIN60000', 'percent', 10,   null,    null,  60000, null, null, null, null, true),
    ('MIN60001', 'percent', 10,   null,    null,  60001, null, null, null, null, true),
    ('FUTURE',   'percent', 10,   null,    null,  0,     pg_catalog.now() + interval '1 day', null, null, null, true),
    ('ENDNOW',   'percent', 10,   null,    null,  0,     null, pg_catalog.now(), null, null, true),
    ('STARTNOW', 'percent', 10,   null,    null,  0,     pg_catalog.now(), pg_catalog.now() + interval '1 hour', null, null, true),
    ('OFF10',    'percent', 10,   null,    null,  0,     null, null, null, null, false),
    ('ONCE',     'percent', 10,   null,    null,  0,     null, null, 1,    null, true),
    ('NOLIMIT',  'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('ONE1PCT',  'percent', 1,    null,    null,  0,     null, null, null, null, true);
  insert into public.coupons (code, kind, percent_off) values ('PHONE1', 'percent', 10);
  begin
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000301', 'القاهرة', null, false, 'ONCE', true);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000302', 'القاهرة', null, false, 'ONCE', true);
    res := res || ('C16 max_uses=1 A=' || pg_temp.zshort(n) || ' B=' || pg_temp.zshort(n2));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C16 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000303', 'القاهرة', null, false, 'PHONE1', true);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000303', 'القاهرة', null, false, 'PHONE1', true);
    o := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000304', 'القاهرة', null, false, 'PHONE1', true);
    res := res || ('C17 per_phone=1 A=' || pg_temp.zshort(n) || ' same_phone=' || pg_temp.zshort(n2) || ' other_phone=' || pg_temp.zshort(o));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C17 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000305', 'القاهرة', null, false, 'NOLIMIT', true);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000305', 'القاهرة', null, false, 'NOLIMIT', true);
    res := res || ('C18 per_phone=null A=' || pg_temp.zshort(n) || ' B=' || pg_temp.zshort(n2));
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C18 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000306', 'القاهرة', null, false, 'ONCE', true);
    t := 'A=' || pg_temp.zshort(n);
    update public.orders set status = 'cancelled', updated_at = pg_catalog.now() where customer_phone = '01000000306';
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000307', 'القاهرة', null, false, 'ONCE', true);
    t := t || ' cancelA→B=' || pg_temp.zshort(n2);
    begin
      update public.orders set status = 'new', updated_at = pg_catalog.now() where customer_phone = '01000000306';
      t := t || ' A→new=ALLOWED';
    exception when others then t := t || ' A→new=E' || sqlstate; end;
    begin
      update public.orders set status = 'confirmed', updated_at = pg_catalog.now() where customer_phone = '01000000306';
      t := t || ' A→confirmed=ALLOWED';
    exception when others then t := t || ' A→confirmed=E' || sqlstate; end;
    begin
      update public.orders set status = 'cancelled', updated_at = pg_catalog.now() where customer_phone = '01000000306';
      t := t || ' A→cancelled=ok';
    exception when others then t := t || ' A→cancelled=E' || sqlstate; end;
    begin
      execute 'set role service_role';
      update public.orders set status = 'new', updated_at = pg_catalog.now() where customer_phone = '01000000306';
      execute 'reset role';
      t := t || ' sr:A→new=ALLOWED';
    exception when others then t := t || ' sr:A→new=E' || sqlstate; end;
    execute 'reset role';
    begin
      update public.orders set status = 'confirmed', updated_at = pg_catalog.now() where customer_phone = '01000000307';
      t := t || ' B→confirmed=ok';
    exception when others then t := t || ' B→confirmed=E' || sqlstate; end;
    o := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000308', 'القاهرة', null, false, 'ONCE', true);
    select pg_catalog.count(*)::text into o2 from public.orders x where x.coupon_code = 'ONCE' and x.status <> 'cancelled';
    res := res || ('C19/C20 ' || t || ' third=' || pg_temp.zshort(o) || ' active_uses=' || o2);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C19 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    k := 'ptest-cp-replay-' || pg_catalog.gen_random_uuid()::text;
    rq := pg_catalog.md5('c21') || pg_catalog.md5('c21b');
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000309', 'القاهرة', null, false, 'ONCE', true, k, rq);
    n2 := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000309', 'القاهرة', null, false, 'ONCE', true, k, rq);
    o := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000309', 'القاهرة', null, false, 'ZELL10', true, k, pg_catalog.md5('other') || pg_catalog.md5('otherb'));
    select pg_catalog.count(*)::text into t from public.orders x where x.coupon_code = 'ONCE';
    res := res || ('C21 first=' || pg_temp.zshort(n) || ' replay=' || pg_temp.zshort(n2) || ' rows=' || t || ' | C22 same_key_other_hash=' || o);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C21 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  raise exception 'ZRESULT USAGE_A%', E'\n' || pg_catalog.array_to_string(res, E'\n');
end
$zua$;

-- (4b) PREVIEW + قيود الجدول + الصلاحيات.
do $zub$
declare
  v_mig text := $zmig$
-- (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده
do $zpre$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')) is distinct from '635e6613dea916eb89882bc03880f274' then
    raise exception 'ZELL_0019_UNEXPECTED_ORDER_FUNCTION';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')) is distinct from '038aae824bd7288056971ac0484b894b' then
    raise exception 'ZELL_0019_UNEXPECTED_RECEIPT_FUNCTION';
  end if;
  if pg_catalog.to_regclass('public.coupons') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)') is not null then
    raise exception 'ZELL_0019_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- (1) جدول الكوبونات
create table public.coupons (
  id                     bigint      generated always as identity primary key,
  code                   text        not null,
  kind                   text        not null,
  percent_off            integer,
  amount_off_piastres    integer,
  max_discount_piastres  integer,
  min_subtotal_piastres  integer     not null default 0,
  starts_at              timestamptz,
  ends_at                timestamptz,
  max_uses               integer,
  max_uses_per_phone     integer     default 1,
  is_active              boolean     not null default true,
  internal_note          text,
  created_at             timestamptz not null default pg_catalog.now(),
  updated_at             timestamptz not null default pg_catalog.now(),
  constraint coupons_code_key unique (code),
  constraint coupons_code_shape check (code ~ '^[A-Z0-9_-]{4,32}$'),
  constraint coupons_kind_shape check (
    (kind = 'percent' and percent_off between 1 and 90 and amount_off_piastres is null
       and (max_discount_piastres is null or max_discount_piastres between 1 and 10000000))
    or
    (kind = 'fixed' and amount_off_piastres between 1 and 10000000 and percent_off is null
       and max_discount_piastres is null)
  ),
  constraint coupons_min_subtotal_range check (min_subtotal_piastres between 0 and 100000000),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_max_uses_range check (max_uses is null or max_uses >= 1),
  constraint coupons_max_uses_per_phone_range check (max_uses_per_phone is null or max_uses_per_phone >= 1),
  constraint coupons_internal_note_length check (internal_note is null or pg_catalog.char_length(internal_note) <= 500)
);

-- ⚠ الصلاحيات الافتراضية في public بتدّي anon/authenticated كل حاجة — بتتشال صراحة.
--   v1 مفيش hard delete: service_role ماعندوش delete ولا truncate.
alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
revoke all on sequence public.coupons_id_seq from public, anon, authenticated;
revoke delete, truncate on table public.coupons from service_role;
grant select, insert, update on table public.coupons to service_role;
grant usage, select on sequence public.coupons_id_seq to service_role;

-- (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0)
alter table public.orders
  add column coupon_id                    bigint references public.coupons (id) on delete restrict,
  add column coupon_code                  text,
  add column coupon_kind                  text,
  add column coupon_percent               integer,
  add column coupon_amount_piastres       integer,
  add column coupon_max_discount_piastres integer,
  add column discount_piastres            integer not null default 0;

alter table public.orders drop constraint orders_total_consistent;
alter table public.orders add constraint orders_total_consistent check (
  (total_piastres)::bigint = (subtotal_piastres)::bigint - (discount_piastres)::bigint + (shipping_piastres)::bigint
                             + (installation_piastres)::bigint + (installation_travel_piastres)::bigint
);
alter table public.orders add constraint orders_discount_shape check (
  (coupon_id is null and coupon_code is null and coupon_kind is null and coupon_percent is null
     and coupon_amount_piastres is null and coupon_max_discount_piastres is null and discount_piastres = 0)
  or
  (coupon_id is not null and coupon_code ~ '^[A-Z0-9_-]{4,32}$'
     and discount_piastres >= 1 and discount_piastres <= subtotal_piastres
     and (
       (coupon_kind = 'percent' and coupon_percent between 1 and 90 and coupon_amount_piastres is null
          and (coupon_max_discount_piastres is null or coupon_max_discount_piastres >= 1)
          and (discount_piastres)::numeric = least(round(((subtotal_piastres)::numeric * (coupon_percent)::numeric) / 100.0),
                                                   (coalesce(coupon_max_discount_piastres, subtotal_piastres))::numeric,
                                                   (subtotal_piastres)::numeric))
       or
       (coupon_kind = 'fixed' and coupon_amount_piastres >= 1 and coupon_percent is null
          and coupon_max_discount_piastres is null
          and discount_piastres = least(coupon_amount_piastres, subtotal_piastres))
     ))
);

-- الاستخدام الإجمالي ولكل موبايل — للأوردرات غير الملغية بس
create index orders_coupon_active_idx on public.orders (coupon_id)
  where coupon_id is not null and status <> 'cancelled';
create index orders_coupon_phone_active_idx on public.orders (coupon_id, customer_phone)
  where coupon_id is not null and status <> 'cancelled';

-- (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST)
CREATE FUNCTION public.zell_orders_cancelled_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- 0019: الإلغاء نهائي في v1 — الأوردر الملغي بيحرر استخدام الكوبون، فرجوعه كان هيعدّي
  --       max_uses و max_uses_per_phone. المنع هنا في الداتابيز لأي مسار كتابة.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end;
$function$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final
  before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();

-- (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول.
insert into public.settings (key, value, updated_at)
select 'coupons_enabled', 'false'::jsonb, pg_catalog.now()
where not exists (select 1 from public.settings s where s.key = 'coupons_enabled');

-- (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة،
--     ومفيش نسختين جنب بعض تلخبط PostgREST). النداء القديم بـ10 أو 12 معامل شغال بالـdefaults.
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text)
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
          coupon_max_discount_piastres, discount_piastres
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
          s.discount::integer
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
revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role, zell_order_writer;

-- (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code
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
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;

-- (7) معاينة الكود (تقديرية)
CREATE FUNCTION public.zell_preview_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enabled jsonb;
  v_code    text;
  v_id      bigint;
  v_active  boolean;
  v_kind    text;
  v_percent integer;
  v_amount  integer;
  v_max     integer;
  v_min     integer;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_uses    integer;
  v_used    integer;
begin
  -- 0019: معاينة تقديرية بس — مابتكتبش ومابتقفلش ومابتستهلكش استخدام.
  --       الحكم النهائي zell_create_order. مابترجعش id ولا عدّادات ولا تواريخ ولا ملاحظات.
  select s.value into v_enabled from public.settings s where s.key = 'coupons_enabled';
  if v_enabled is null or v_enabled <> 'true'::jsonb then
    raise exception 'ZELL_COUPONS_DISABLED' using errcode = '45076';
  end if;

  v_code := nullif(pg_catalog.upper(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_code, ''), 'NFC'))), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{4,32}$' then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;

  select c.id, c.is_active, c.kind, c.percent_off, c.amount_off_piastres, c.max_discount_piastres,
         c.min_subtotal_piastres, c.starts_at, c.ends_at, c.max_uses
    into v_id, v_active, v_kind, v_percent, v_amount, v_max, v_min, v_starts, v_ends, v_uses
  from public.coupons c
  where c.code = v_code;

  if v_id is null or not v_active then
    raise exception 'ZELL_COUPON_INVALID' using errcode = '45070';
  end if;
  if (v_starts is not null and pg_catalog.now() < v_starts)
     or (v_ends is not null and pg_catalog.now() >= v_ends) then
    raise exception 'ZELL_COUPON_EXPIRED' using errcode = '45071';
  end if;
  if v_uses is not null then
    select pg_catalog.count(*)::integer into v_used
    from public.orders o
    where o.coupon_id = v_id and o.status <> 'cancelled';
    if v_used >= v_uses then
      raise exception 'ZELL_COUPON_EXHAUSTED' using errcode = '45072';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', v_code,
    'kind', v_kind,
    'percent_off', case when v_kind = 'percent' then v_percent end,
    'amount_off_piastres', case when v_kind = 'fixed' then v_amount end,
    'max_discount_piastres', case when v_kind = 'percent' then v_max end,
    'min_subtotal_piastres', v_min);
end;
$function$;
revoke all on function public.zell_preview_coupon(text) from public, anon, authenticated;
grant execute on function public.zell_preview_coupon(text) to service_role, zell_order_writer;

-- (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس)
notify pgrst, 'reload schema';

$zmig$;
  res text[] := '{}';
  o text; n text; o2 text; n2 text; k text; rq text; ord text; t text;
  r1 jsonb; r2 jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest_old(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest_old(');
  execute v_mig;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'FUNCTION public.zell_create_order(', 'FUNCTION public.zell_create_order_ptest(');
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.zell_get_order_receipt(text,text)')),
    'FUNCTION public.zell_get_order_receipt(', 'FUNCTION public.zell_get_order_receipt_ptest(');
  create function pg_temp.zt(p_fn text, p_items jsonb, p_phone text, p_gov text, p_area text, p_inst boolean,
                             p_code text, p_keep boolean default false, p_key text default null, p_req text default null)
  returns text language plpgsql as $zt$
  declare
    r jsonb;
    v_out text;
    v_md5 text;
    v_key text := coalesce(p_key, 'ptest-' || pg_catalog.gen_random_uuid()::text);
    v_req text := coalesce(p_req, pg_catalog.md5(pg_catalog.gen_random_uuid()::text) || pg_catalog.md5(pg_catalog.gen_random_uuid()::text));
  begin
    begin
      if p_fn = 'new' then
        r := public.zell_create_order_ptest(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst, p_code);
      else
        r := public.zell_create_order_ptest_old(p_items, 'عميل تجربة', p_phone, p_gov, 'شارع التجربة رقم ١٢٣', null,
               v_key, v_req, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64), p_area, p_inst);
      end if;
      select pg_catalog.md5(
               (pg_catalog.to_jsonb(o) - array['id', 'order_number', 'created_at', 'updated_at', 'receipt_expires_at',
                 'idempotency_key', 'request_hash', 'checkout_session_hash', 'receipt_token_hash', 'receipt_token_hash_prev',
                 'coupon_id', 'coupon_code', 'coupon_kind', 'coupon_percent', 'coupon_amount_piastres',
                 'coupon_max_discount_piastres', 'discount_piastres']::text[])::text
               || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - array['id', 'order_id']::text[] order by i.id)::text
                            from public.order_items i where i.order_id = o.id), '[]'))
        into v_md5
      from public.orders o where o.order_number = r ->> 'order_number';
      v_out := pg_catalog.concat_ws('|', 'ok', r ->> 'subtotal_piastres', r ->> 'shipping_piastres',
                 coalesce(r ->> 'discount_piastres', '-'), r ->> 'installation_piastres', r ->> 'installation_travel_piastres',
                 r ->> 'total_piastres', coalesce(r ->> 'coupon_code', '-'), r ->> 'replayed', pg_catalog.left(v_md5, 8));
      if not p_keep then
        raise exception 'ZT_ROLLBACK';
      end if;
    exception when others then
      if sqlerrm <> 'ZT_ROLLBACK' then
        v_out := 'E' || sqlstate;
      end if;
    end;
    return v_out;
  end
  $zt$;

  create function pg_temp.zpar(o text, n text) returns text language sql as $zp$
    select case
      when pg_catalog.left(o, 1) = 'E' or pg_catalog.left(n, 1) = 'E' then case when o = n then 'SAME' else 'DIFF old=' || o || ' new=' || n end
      when pg_catalog.split_part(o, '|', 2) = pg_catalog.split_part(n, '|', 2)
       and pg_catalog.split_part(o, '|', 3) = pg_catalog.split_part(n, '|', 3)
       and pg_catalog.split_part(o, '|', 5) = pg_catalog.split_part(n, '|', 5)
       and pg_catalog.split_part(o, '|', 6) = pg_catalog.split_part(n, '|', 6)
       and pg_catalog.split_part(o, '|', 7) = pg_catalog.split_part(n, '|', 7)
       and pg_catalog.split_part(o, '|', 9) = pg_catalog.split_part(n, '|', 9)
       and pg_catalog.split_part(o, '|', 10) = pg_catalog.split_part(n, '|', 10)
       and pg_catalog.split_part(n, '|', 4) = '0'
       and pg_catalog.split_part(n, '|', 8) = '-' then 'SAME'
      else 'DIFF old=' || o || ' new=' || n end
  $zp$;

  create function pg_temp.zshort(n text) returns text language sql as $zs$
    select case when pg_catalog.left(n, 1) = 'E' then n
      else pg_catalog.concat_ws('|', pg_catalog.split_part(n, '|', 2), pg_catalog.split_part(n, '|', 3), pg_catalog.split_part(n, '|', 4),
             pg_catalog.split_part(n, '|', 5), pg_catalog.split_part(n, '|', 6), pg_catalog.split_part(n, '|', 7),
             pg_catalog.split_part(n, '|', 8))
           || case when pg_catalog.split_part(n, '|', 9) = 'true' then '|R' else '' end end
  $zs$;

  update public.settings set value = 'true'::jsonb where key = 'coupons_enabled';
  insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres,
                              starts_at, ends_at, max_uses, max_uses_per_phone, is_active) values
    ('ZELL10',   'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('HALF50',   'percent', 50,   null,    10000, 0,     null, null, null, null, true),
    ('FIX5000',  'fixed',   null, 5000,    null,  0,     null, null, null, null, true),
    ('FIXBIG',   'fixed',   null, 9999999, null,  0,     null, null, null, null, true),
    ('MIN60000', 'percent', 10,   null,    null,  60000, null, null, null, null, true),
    ('MIN60001', 'percent', 10,   null,    null,  60001, null, null, null, null, true),
    ('FUTURE',   'percent', 10,   null,    null,  0,     pg_catalog.now() + interval '1 day', null, null, null, true),
    ('ENDNOW',   'percent', 10,   null,    null,  0,     null, pg_catalog.now(), null, null, true),
    ('STARTNOW', 'percent', 10,   null,    null,  0,     pg_catalog.now(), pg_catalog.now() + interval '1 hour', null, null, true),
    ('OFF10',    'percent', 10,   null,    null,  0,     null, null, null, null, false),
    ('ONCE',     'percent', 10,   null,    null,  0,     null, null, 1,    null, true),
    ('NOLIMIT',  'percent', 10,   null,    null,  0,     null, null, null, null, true),
    ('ONE1PCT',  'percent', 1,    null,    null,  0,     null, null, null, null, true);
  insert into public.coupons (code, kind, percent_off) values ('PHONE1', 'percent', 10);
  begin
    select pg_catalog.count(*)::text || '/' || (select pg_catalog.count(*) from public.orders)::text into o2 from public.coupons;
    t := 'ZELL10=' || public.zell_preview_coupon(' zell10 ')::text;
    t := t || ' HALF50=' || (public.zell_preview_coupon('HALF50') - array['ok', 'code']::text[])::text;
    t := t || ' FIX5000=' || (public.zell_preview_coupon('FIX5000') - array['ok', 'code']::text[])::text;
    begin t := t || ' FUTURE=' || public.zell_preview_coupon('FUTURE')::text; exception when others then t := t || ' FUTURE=E' || sqlstate; end;
    begin t := t || ' OFF10=' || public.zell_preview_coupon('OFF10')::text; exception when others then t := t || ' OFF10=E' || sqlstate; end;
    begin t := t || ' AB=' || public.zell_preview_coupon('AB')::text; exception when others then t := t || ' AB=E' || sqlstate; end;
    begin t := t || ' NOPE99=' || public.zell_preview_coupon('NOPE99')::text; exception when others then t := t || ' NOPE99=E' || sqlstate; end;
    n := pg_temp.zt('new', '[{"productId":2,"lengthCm":500}]', '01000000310', 'القاهرة', null, false, 'ONCE', true);
    begin t := t || ' ONCE_used=' || public.zell_preview_coupon('ONCE')::text; exception when others then t := t || ' ONCE_used=E' || sqlstate; end;
    update public.settings set value = 'false'::jsonb where key = 'coupons_enabled';
    begin t := t || ' disabled=' || public.zell_preview_coupon('ZELL10')::text; exception when others then t := t || ' disabled=E' || sqlstate; end;
    select pg_catalog.count(*)::text || '/' || ((select pg_catalog.count(*) from public.orders) - 1)::text into n2 from public.coupons;
    res := res || ('C29 ' || t || ' | writes before=' || o2 || ' after=' || n2);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C29 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    t := '';
    begin insert into public.coupons (code, kind, percent_off) values ('PCT91', 'percent', 91); t := t || ' pct91=ALLOWED';
    exception when others then t := t || ' pct91=E' || sqlstate; end;
    begin insert into public.coupons (code, kind, percent_off, amount_off_piastres) values ('MIXED1', 'fixed', 10, 500); t := t || ' mixed=ALLOWED';
    exception when others then t := t || ' mixed=E' || sqlstate; end;
    begin insert into public.coupons (code, kind, amount_off_piastres, max_discount_piastres) values ('FIXMAX', 'fixed', 500, 100); t := t || ' fixed+max=ALLOWED';
    exception when others then t := t || ' fixed+max=E' || sqlstate; end;
    begin insert into public.coupons (code, kind, percent_off) values ('lower1', 'percent', 10); t := t || ' lowercase=ALLOWED';
    exception when others then t := t || ' lowercase=E' || sqlstate; end;
    begin insert into public.coupons (code, kind, percent_off, starts_at, ends_at) values ('WIN1', 'percent', 10, pg_catalog.now(), pg_catalog.now()); t := t || ' ends=starts=ALLOWED';
    exception when others then t := t || ' ends=starts=E' || sqlstate; end;
    begin insert into public.coupons (code, kind, percent_off) values ('ZELL10', 'percent', 10); t := t || ' duplicate=ALLOWED';
    exception when others then t := t || ' duplicate=E' || sqlstate; end;
    select coalesce(c.max_uses_per_phone::text, 'null') into o from public.coupons c where c.code = 'PHONE1';
    t := t || ' default_per_phone=' || o;
    begin
      insert into public.orders (order_number, customer_name, customer_phone, governorate, address,
                                 subtotal_piastres, shipping_piastres, total_piastres,
                                 coupon_id, coupon_code, coupon_kind, coupon_amount_piastres, discount_piastres)
      select 'FLM-SHAPE2', 'تجربة', '01000000399', 'القاهرة', 'شارع التجربة ١٢٣', 60000, 0, 56000, c.id, 'FIX5000', 'fixed', 5000, 4000
      from public.coupons c where c.code = 'FIX5000';
      t := t || ' wrong_discount=ALLOWED';
    exception when others then t := t || ' wrong_discount=E' || sqlstate; end;
    begin
      insert into public.orders (order_number, customer_name, customer_phone, governorate, address,
                                 subtotal_piastres, shipping_piastres, total_piastres, discount_piastres)
      values ('FLM-SHAPE3', 'تجربة', '01000000398', 'القاهرة', 'شارع التجربة ١٢٣', 60000, 0, 55000, 5000);
      t := t || ' discount_no_coupon=ALLOWED';
    exception when others then t := t || ' discount_no_coupon=E' || sqlstate; end;
    begin
      execute 'set role service_role';
      delete from public.coupons where code = 'OFF10';
      execute 'reset role';
      t := t || ' sr_delete=ALLOWED';
    exception when others then t := t || ' sr_delete=E' || sqlstate; end;
    execute 'reset role';
    begin
      execute 'set role anon';
      perform 1 from public.coupons limit 1;
      execute 'reset role';
      t := t || ' anon_select=ALLOWED';
    exception when others then t := t || ' anon_select=E' || sqlstate; end;
    execute 'reset role';
    res := res || ('C30' || t);
    raise exception 'ZSUB';
  exception when others then
    if sqlerrm <> 'ZSUB' then res := res || ('C30 ERROR ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  res := res || ('C31 ' || (select pg_catalog.concat_ws(' ',
    'anon_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('anon', 'public.coupons', 'select')::text, 1),
    'auth_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('authenticated', 'public.coupons', 'select')::text, 1),
    'sr_sel=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'select')::text, 1),
    'sr_ins=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'insert')::text, 1),
    'sr_upd=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'update')::text, 1),
    'sr_del=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'delete')::text, 1),
    'sr_trunc=' || pg_catalog.left(pg_catalog.has_table_privilege('service_role', 'public.coupons', 'truncate')::text, 1),
    'anon_seq=' || pg_catalog.left(pg_catalog.has_sequence_privilege('anon', 'public.coupons_id_seq', 'usage')::text, 1),
    'sr_seq=' || pg_catalog.left(pg_catalog.has_sequence_privilege('service_role', 'public.coupons_id_seq', 'usage')::text, 1),
    'rls=' || (select pg_catalog.left(c.relrowsecurity::text, 1) from pg_catalog.pg_class c where c.oid = 'public.coupons'::regclass),
    'fn_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_auth=' || pg_catalog.left(pg_catalog.has_function_privilege('authenticated', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_sr=' || pg_catalog.left(pg_catalog.has_function_privilege('service_role', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'fn_writer=' || pg_catalog.left(pg_catalog.has_function_privilege('zell_order_writer', 'public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)', 'execute')::text, 1),
    'pv_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_auth=' || pg_catalog.left(pg_catalog.has_function_privilege('authenticated', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_sr=' || pg_catalog.left(pg_catalog.has_function_privilege('service_role', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'pv_writer=' || pg_catalog.left(pg_catalog.has_function_privilege('zell_order_writer', 'public.zell_preview_coupon(text)', 'execute')::text, 1),
    'rc_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_get_order_receipt(text,text)', 'execute')::text, 1),
    'final_anon=' || pg_catalog.left(pg_catalog.has_function_privilege('anon', 'public.zell_orders_cancelled_final()', 'execute')::text, 1),
    'pv_secdef=' || (select pg_catalog.left(p.prosecdef::text, 1) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')),
    'pv_vol=' || (select p.provolatile::text from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_preview_coupon(text)')),
    'lock_order=' || (select pg_catalog.left((pg_catalog.strpos(p.prosrc, 'for update') > pg_catalog.strpos(p.prosrc, 'pg_advisory_xact_lock')
                        and pg_catalog.strpos(p.prosrc, 'pg_advisory_xact_lock') > 0)::text, 1)
                      from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb,text,text,text,text,text,text,text,text,text,text,boolean,text)')),
    'idx_total=' || coalesce((select pg_catalog.left((i.indexdef like '%(coupon_id) WHERE ((coupon_id IS NOT NULL) AND (status <> ''cancelled''::text))')::text, 1)
                               from pg_catalog.pg_indexes i where i.indexname = 'orders_coupon_active_idx'), '∅'),
    'idx_phone=' || coalesce((select pg_catalog.left((i.indexdef like '%(coupon_id, customer_phone) WHERE ((coupon_id IS NOT NULL) AND (status <> ''cancelled''::text))')::text, 1)
                               from pg_catalog.pg_indexes i where i.indexname = 'orders_coupon_phone_active_idx'), '∅'),
    'trigger=' || (select pg_catalog.count(*)::text from pg_catalog.pg_trigger t
                    where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_cancelled_final' and not t.tgisinternal))));

  raise exception 'ZRESULT USAGE_B%', E'\n' || pg_catalog.array_to_string(res, E'\n');
end
$zub$;
