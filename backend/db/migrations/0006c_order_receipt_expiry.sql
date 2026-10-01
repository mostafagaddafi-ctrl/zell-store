-- =====================================================================
-- 0006c — receipt_expires_at في إسقاط zell_create_order
--
--  الحالة: ✅ **مُنفّذة على Supabase Production** بتاريخ 2026-10-01،
--          واتختبرت فعلياً بنجاح. متحقَّق منها قراءة فقط من المحرّك:
--          الإسقاط بيذكر receipt_expires_at، والـupdate بتاع الـreplay
--          **لسه مش بيلمسه**، والدالة لسه VOLATILE و security definer
--          و search_path="" ومملوكة لـpostgres، والصلاحيات زي ما هي
--          (service_role و zell_order_writer بس).
--
--  Smoke test: receipt_expires_at رجع في الإنشاء والـreplay و**نفس القيمة
--  حرفياً** في الردين (2026-10-08T13:16:52.500255+00:00) — يعني مفيش تمديد.
--  والـreplay عمل صفر طلبات إضافية، والتدوير صح. وبيانات الاختبار اتحذفت
--  بالكامل (orders = 0 و order_items = 0).
--  الخطة:  docs/plans/ORDER-FLOW-PLAN.md §6.4ب
--  شرط مسبق: 0006a و 0006b منفّذتين بنجاح.
--  الترتيب: 0006a ← 0006b ← 0006c.
--
--  **تغيير واحد في السلوك الظاهر، وصفر تغيير في المنطق:**
--  الإسقاط الراجع بقى فيه مفتاح زيادة `receipt_expires_at` في المسارين
--  (إنشاء و replay). ولا سطر منطق اتغيّر: مفيش تمديد للنافذة، مفيش تعديل
--  على ترتيب الحسم، مفيش تعديل على التسعير ولا القفل ولا التدوير.
--
--  **ليه:** الراوت كان بيضبط كوكي الإيصال بـMax-Age ثابت ٧ أيام على **كل**
--  replay، بينما receipt_expires_at بيتكتب مرة واحدة عند الإنشاء و**ما
--  بيتمدّش** عن قصد (ب١٠). فـreplay في اليوم السادس كان بيدّي كوكي بتدّعي
--  صلاحية لحد اليوم الـ١٣ والداتابيز بتقفل في السابع. فاشل-مقفول — مش ثغرة
--  وصول — بس تجربة مربكة. دلوقتي الراوت بيحسب:
--      Max-Age = min(604800, max(0, floor(receipt_expires_at - now)))
--
--  **الإسقاط ده ما بيسرّبش حاجة:** النافذة معروفة ضمناً (٧ أيام من الإنشاء)،
--  وحامل كوكي الجلسة أصلاً هو صاحب الطلب. ولا رمز ولا هاش بيترجع.
--
--  ⚠️ create or replace **بيحافظ** على المالك وعلى الصلاحيات، بس **بيستبدل**
--     كل خصائص الدالة. عشان كده security definer و set search_path = ''
--     مكتوبين هنا صريح — لو اتنسوا، الدالة بتفقد ترقية الصلاحية وتبقى
--     عرضة لـsearch_path hijacking. التحقق الذاتي في (3) بيفشل لو حصل.
--
--  ⚠️ الدالة لازم تفضل **VOLATILE** (مفيش marker). التحويل لـSTABLE بيكسر حسم
--     الـreplay بالكامل (§3.4). التحقق الذاتي بيفرض ده.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) شرط مسبق — 0006a و 0006b لازم يكونوا منفّذين
-- ---------------------------------------------------------------------
do $prereq$
declare
  v_count integer;
begin
  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_attribute
  where attrelid = 'public.orders'::regclass
    and not attisdropped
    and attname in ('idempotency_key', 'request_hash', 'checkout_session_hash',
                    'receipt_token_hash', 'receipt_token_hash_prev', 'receipt_expires_at');
  if v_count <> 6 then
    raise exception 'ZELL_MIGRATION_0006C_NEEDS_0006A: expected 6 columns, found %', v_count;
  end if;

  if not exists (select 1 from pg_catalog.pg_proc p
                 join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'zell_create_order') then
    raise exception 'ZELL_MIGRATION_0006C_NEEDS_0006B: zell_create_order is missing';
  end if;
end
$prereq$;

-- ---------------------------------------------------------------------
-- (2) zell_create_order — نفس الجسم + receipt_expires_at في الإسقاط
-- ---------------------------------------------------------------------
create or replace function public.zell_create_order(
  p_items                 jsonb,
  p_customer_name         text,
  p_customer_phone        text,
  p_governorate           text,
  p_address               text,
  p_notes                 text,
  p_idempotency_key       text,
  p_request_hash          text,
  p_checkout_session_hash text,
  p_receipt_token_hash    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_order$
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
         o.receipt_expires_at
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
       or (e ->> 'lengthCm')  is null
       or (e ->> 'productId') !~ '^[1-9][0-9]{0,8}$'
       or (e ->> 'lengthCm')  !~ '^[1-9][0-9]{0,6}$'
  ) then
    raise exception 'ZELL_CART_INVALID' using errcode = '45023';
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
               (e ->> 'lengthCm')::integer  as length_cm
        from pg_catalog.jsonb_array_elements(p_items) as e
      ),
      priced as (
        select p.id   as product_id,
               p.name_ar,
               p.image_url,
               p.price_per_meter_piastres,
               p.width_cm,
               r.length_cm,
               pg_catalog.round((p.price_per_meter_piastres::numeric
                                 * r.length_cm::numeric) / 100.0) as line_total
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and r.length_cm between p.min_length_cm and p.max_length_cm
         and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
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
      new_order as (
        insert into public.orders (
          order_number, customer_name, customer_phone, governorate, address, notes,
          subtotal_piastres, shipping_piastres, total_piastres,
          idempotency_key, request_hash, checkout_session_hash,
          receipt_token_hash, receipt_expires_at
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
          (s.subtotal + s.shipping)::integer,
          p_idempotency_key,
          p_request_hash,
          p_checkout_session_hash,
          p_receipt_token_hash,
          pg_catalog.now() + (c_receipt_days || ' days')::interval
        from ship s
        where s.ok_count > 0
          and s.ok_count = v_req_count
          and s.subtotal >= 0
          and (s.subtotal + s.shipping) <= c_int4_max
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        -- ⚠ 0006c: receipt_expires_at مضاف للـreturning
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres,
                  receipt_expires_at
      ),
      items_ins as (
        insert into public.order_items (
          order_id, product_id, product_name_ar, product_image_url,
          unit_price_piastres, length_cm, width_cm, line_total_piastres
        )
        select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
               pr.length_cm, pr.width_cm, pr.line_total::integer
        from new_order o cross join priced pr
        returning order_id
      )
      -- items_ins مش مُشار إليه عن قصد: عبارات التعديل جوه WITH بتتنفّذ مرة
      -- واحدة وبالكامل بغضّ النظر عن قراءة مخرجاتها.
      select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
             o.receipt_expires_at
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
      -- 0006c: القيمة المخزّنة فعلاً، جاية من RETURNING مش محسوبة تاني
      'receipt_expires_at', v_order.receipt_expires_at);
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.sum(pg_catalog.round((p.price_per_meter_piastres::numeric
                                                   * r.length_cm::numeric) / 100.0)), 0)
    into v_valid_count, v_subtotal
  from (
    select (e ->> 'productId')::integer as product_id,
           (e ->> 'lengthCm')::integer  as length_cm
    from pg_catalog.jsonb_array_elements(p_items) as e
  ) r
  join public.products p
    on p.id = r.product_id
   and p.is_active
   and r.length_cm between p.min_length_cm and p.max_length_cm
   and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0;

  if v_valid_count <> v_req_count then
    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  v_shipping := case when v_threshold > 0 and v_subtotal >= v_threshold
                     then 0::numeric else v_base::numeric end;
  if (v_subtotal + v_shipping) > c_int4_max then
    raise exception 'ZELL_PRICE_OUT_OF_RANGE' using errcode = '45027';
  end if;

  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$create_order$;

-- ---------------------------------------------------------------------
-- (3) تحقق ذاتي — create or replace ما يكونش ضيّع أي خصيصة
-- ---------------------------------------------------------------------
do $verify$
declare
  v_volatile  char;
  v_secdef    boolean;
  v_config    text[];
  v_fn_owner  text;
  v_tbl_owner text;
begin
  select p.provolatile, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner)
    into v_volatile, v_secdef, v_config, v_fn_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_create_order';

  -- VOLATILE إلزامي: STABLE بياخد snapshot النداء فالـreplay ما بيتحسمش أبداً
  if v_volatile is distinct from 'v' then
    raise exception 'ZELL_MIGRATION_0006C_NOT_VOLATILE: provolatile = %', v_volatile;
  end if;

  if v_secdef is distinct from true then
    raise exception 'ZELL_MIGRATION_0006C_NOT_SECDEF';
  end if;

  if v_config is null or not ('search_path=""' = any(v_config)) then
    raise exception 'ZELL_MIGRATION_0006C_SEARCH_PATH: %', v_config;
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into v_tbl_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'orders';

  if v_fn_owner is distinct from v_tbl_owner then
    raise exception 'ZELL_MIGRATION_0006C_OWNER: % vs %', v_fn_owner, v_tbl_owner;
  end if;

  -- الصلاحيات: create or replace بيحافظ عليها، بس نتأكد مش نفترض
  if exists (select 1 from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'zell_create_order'
               and (p.proacl is null
                 or exists (select 1 from pg_catalog.aclexplode(p.proacl) ae
                            where ae.grantee = 0 and ae.privilege_type = 'EXECUTE'))) then
    raise exception 'ZELL_MIGRATION_0006C_PUBLIC_EXECUTE';
  end if;

  if pg_catalog.has_function_privilege('anon',
       'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
       'execute')
     or pg_catalog.has_function_privilege('authenticated',
       'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
       'execute') then
    raise exception 'ZELL_MIGRATION_0006C_ANON_EXECUTE';
  end if;

  if not pg_catalog.has_function_privilege('zell_order_writer',
       'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
       'execute') then
    raise exception 'ZELL_MIGRATION_0006C_MISSING_EXECUTE';
  end if;
end
$verify$;

commit;

-- =====================================================================
-- التراجع
-- =====================================================================
--  أعد تنفيذ قسم zell_create_order من 0006b كما هو — بيرجّع الإسقاط القديم
--  بدون receipt_expires_at. **مفيش أي تغيير على البيانات** في الاتجاهين،
--  فالتراجع بصفر فقد. لكن لازم يتزامن مع تراجع الراوت، لأن الراوت الجديد
--  بيرفض الإسقاط اللي مفيهوش receipt_expires_at ويرجّع INTERNAL.
