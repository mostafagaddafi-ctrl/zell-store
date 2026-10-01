-- =====================================================================
-- 0006b — دور الكتابة ودالتي مسار الطلب
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على Production**
--  الخطة:  docs/plans/ORDER-FLOW-PLAN.md §2.3 · §3 · §4.5 · §6.5
--  شرط مسبق: 0006a منفّذة بنجاح.
--
--  سطح الداتابيز كله دالتين:
--    public.zell_create_order(...)
--    public.zell_get_order_receipt(order_number, receipt_token_hash)
--
--  الدور zell_order_writer **مالوش أي صلاحية على أي جدول** — لا select
--  ولا insert ولا update ولا delete. عنده execute على الدالتين وبس.
--  الدالتين security definer مملوكتين لمالك الجداول (postgres)، ومالك
--  الجدول بيتخطى RLS لأن relforcerowsecurity = false على الجداول كلها.
--
--  ---------------------------------------------------------------------
--  ⚠ تصحيحات مراجعة ب١٣ — مطبّقة في الملف ده:
--
--   (١) **ترتيب الحسم.** أي replay موجود ومُصرَّح له بيُحسم **قبل** أي فحص
--       مُتغيّر وقبل حد المعدّل. قبل التصحيح، الطلب الخامس الناجح اللي ضاع
--       رده كان بيترفض بـZELL_PHONE_DAILY_LIMIT وما يوصلش للـreplay أبداً
--       = خسارة إيصال نهائية لعميل مُصرَّح له.
--
--   (٢) **تسلسل لكل رقم موبايل.** count(*) ثم insert **مش** حد ذرّي بين
--       معاملات متزامنة: ٦ طلبات متوازية كانت تقدر كلها تشوف count = 4
--       وتنجح. دلوقتي pg_advisory_xact_lock لكل موبايل، وإعادة حسم
--       الـidempotency **بعد** القفل، وبعدها العد والإدخال.
--
--   (٣) **منع overflow التسعير.** price_per_meter_piastres * length_cm
--       الاتنين integer. مثال حقيقي متحقَّق منه: 100000 × 30000 بيرمي
--       "integer out of range" **قبل** القسمة على 100، رغم إن الناتج
--       النهائي (30,000,000 قرش) بيدخل في integer عادي. دلوقتي الضرب على
--       numeric، وفيه حارس صريح لنطاق int4 على الإجماليات.
--
--   (٤) **item_count اتشال** من نتيجة zell_create_order — مش في العقد النهائي.
--  ---------------------------------------------------------------------
--
--  ⚠ ملاحظات search_path = '' (متحقَّق منها على PostgreSQL 17.6):
--    • كل دالة مدمجة لازم pg_catalog. صريح.
--    • coalesce / nullif / case / cast / between / in هي **بناءات لغوية**
--      مش دوال — ما تتqualifyش وما تحتاجش.
--    • gen_random_uuid موجودة في pg_catalog في PG13+ (ومكرّرة في extensions).
--      بنستخدم pg_catalog عن قصد عشان ما نعتمدش على schema الإضافات.
--
--  ⚠ اعتمادية مستوى العزل — **إلزامية** (ب١٤):
--    zell_create_order لازم تفضل **VOLATILE** (الافتراضي — مفيش marker)،
--    والنداء لازم يكون تحت **READ COMMITTED** (افتراضي بوستجريس).
--    السبب: حسم الـidempotency في (د) بيعتمد إنه يشوف صف اتعمل له commit
--    بعد ما القفل في (ج) اتحرر. وده بيشتغل لأن كل عبارة جوه دالة VOLATILE
--    تحت READ COMMITTED بتاخد snapshot جديد.
--    • تحويلها لـSTABLE **ممنوع**: بتاخد snapshot النداء، فالـreplay ما
--      بيتحسمش أبداً وكل إعادة إرسال بتبقى ZELL_CONCURRENT_SUBMIT.
--    • تحت REPEATABLE READ أو SERIALIZABLE: (د) ما بتشوفش الصف، فالمسار
--      بينزل على on conflict → صفر صفوف → ZELL_CONCURRENT_SUBMIT
--      (retryable). تدهور آمن — مفيش فساد بيانات — بس مش السلوك المقصود.
--
--  ⚠ اعتمادية موثّقة (متحقَّق منها على Production):
--    order_items عليها CHECK بـ unit_price_piastres > 0 و width_cm > 0.
--    القيود دي مستحيل تتخرق من إعداد منتج، لأن products عليها
--    products_price_per_meter_piastres_check و products_width_cm_check
--    و products_step_cm_check و min/max_length_cm > 0.
--    عشان كده مفيش شروط زايدة على الـjoin هنا.
--    لو حد شال أي قيد من دول من products لاحقاً، الإدخال هنا هيبدأ
--    يفشل بـ check_violation بدل ZELL_ITEM_UNAVAILABLE — فالقيود دي جزء من
--    عقد الدالة دي، مش تفاصيل منفصلة.
--
--  ⚠ الملف ده **ما اتنفّذش على أي محرّك** (قرار صريح: مفيش تنفيذ قبل
--    المراجعة). أول تشغيل لازم يكون جوه begin/commit زي ما هو مكتوب، عشان
--    أي خطأ صياغة يرجع للخلف نضيف بدون أي أثر.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) الدور — صفر صلاحيات على الجداول
-- ---------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'zell_order_writer') then
    create role zell_order_writer nologin nobypassrls;
  end if;
end
$role$;

-- usage على الـschema لازم لاستدعاء دالة فيها. مش بيدّي أي وصول للجداول.
grant usage on schema public to zell_order_writer;

-- دفاعي: لو أي حد منح الدور صلاحية جدول قبل كده، نشيلها.
revoke all on all tables    in schema public from zell_order_writer;
revoke all on all sequences in schema public from zell_order_writer;

-- ---------------------------------------------------------------------
-- (2) zell_create_order
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
  -- فضاء أسماء الأقفال الاستشارية لـzell. رقم ثابت عشان ما يتصادمش مع أي
  -- استخدام تاني لـpg_advisory_* في نفس الداتابيز.
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
  -- (ب) الموبايل — الفحص الثابت الوحيد اللي **لازم** يسبق الحسم،
  --     لأنه مفتاح التسلسل في (ج).
  ------------------------------------------------------------------
  if coalesce(p_customer_phone, '') !~ '^01[0125][0-9]{8}$' then
    raise exception 'ZELL_INVALID_PHONE' using errcode = '45021';
  end if;

  ------------------------------------------------------------------
  -- (ج) تسلسل لكل رقم موبايل — تصحيح ب١٣-٢
  --
  --     قفل على مستوى المعاملة: بيتحرر تلقائياً عند commit أو rollback،
  --     فمفيش احتمال قفل متروك. قفل واحد بس في الدالة كلها = مفيش deadlock.
  --     الأقفال بين أرقام مختلفة ما بتتعارضش.
  --
  --     من غير القفل ده، count(*) ثم insert مش حد ذرّي: ٦ معاملات متوازية
  --     تقدر كلها تقرا count = 4 وتدخل، فيبقى ٦ طلبات لرقم واحد في اليوم.
  ------------------------------------------------------------------
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_customer_phone), 1, 8))::bit(32)::integer;
  perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_lock_key);

  ------------------------------------------------------------------
  -- (د) حسم الـidempotency — تصحيح ب١٣-١
  --
  --     بعد القفل، و**قبل أي فحص مُتغيّر**: مفيش إعدادات، مفيش محافظة،
  --     مفيش نافذة موبايل. طلب موجود ومُصرَّح له بياخد إيصاله مهما كانت
  --     حالة الإعدادات أو العدّاد.
  ------------------------------------------------------------------
  select o.order_number, o.request_hash, o.checkout_session_hash,
         o.subtotal_piastres, o.shipping_piastres, o.total_piastres
    into v_existing
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if v_existing.order_number is not null then

    -- (د-1) نفس المفتاح، محتوى مختلف
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
    end if;

    -- (د-2) نفس المفتاح ونفس المحتوى، بس **متصفح تاني**.
    --       الحاجز الأساسي: المفتاح + الـbody لوحدهم ما يقدروش يصدروا ولا
    --       يدوّروا أي وصول للإيصال.
    if v_existing.checkout_session_hash is distinct from p_checkout_session_hash then
      raise exception 'ZELL_REPLAY_NOT_AUTHORIZED' using errcode = '45007';
    end if;

    -- (د-3) replay مُصرَّح: تدوير بخانتين.
    --       ⚠ receipt_expires_at **غير مذكور عن قصد** — النافذة مربوطة بلحظة
    --         إنشاء الطلب ومفيش أي طرف يقدر يمدّها.
    --       ⚠ الرمز السابق يفضل صالح، فترتيب وصول الردود مش مهم.
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
      'total_piastres', v_existing.total_piastres);
  end if;

  ------------------------------------------------------------------
  -- (هـ) باقي الفحوصات الثابتة
  --
  --      كلها دوال خالصة على المدخلات. مفيش حاجة منها بتعتمد على حالة
  --      الداتابيز، فترتيبها بعد الحسم آمن: الـreplay بيبقى بنفس الـbody
  --      بالبايت (وإلا request_hash مختلف = MISMATCH)، فما ينفعش يفشل هنا
  --      وهو نجح أول مرة.
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

  -- تحقق آمن من شكل السلة **قبل** أي cast
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

  -- كل عنصر object فيه رقمين صحيحين موجبين. الفحص بـregex على النص
  -- **قبل** أي ::int، عشان مدخل زي "1e9" أو "abc" ما يرفعش خطأ cast.
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
  -- (و) إعدادات الشحن + المحافظة — **فحوصات مُتغيّرة، بعد الحسم**
  --     shipping_default_piastres مش مقروء عن قصد (ت٦).
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

  -- المحافظة: موجودة في rates **و** مش في disabled
  if not (v_rates ? coalesce(p_governorate, ''))
     or v_disabled ? coalesce(p_governorate, '') then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  -- سعر الشحن والعتبة: numeric أولاً، وحارس نطاق + صحّة عددية قبل الـcast.
  -- قيمة إعداد زي 1e12 كانت هتفشل بـ"integer out of range" غامض.
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
  -- (ز) نافذة الموبايل — **مُتغيّرة، ومحمية بالقفل من (ج)**
  --     بتعدّ الطلبات المكتملة، فالتراجع ما يأثّرش عليها.
  --
  --     ⚠ **مفيش فلتر على status عن قصد** — الطلبات الملغية ('cancelled')
  --       **بتتحسب** في الحد. القرار المعتمد: الحد حماية من الإساءة، ولو
  --       الإلغاء بيصفّر العدّاد يبقى أي مهاجم يقدر يلف عليه. الأثر المقبول:
  --       زبون اتلغى له ٥ طلبات بالغلط بيستنى أقدم واحد يخرج من النافذة.
  --       ممنوع تغيير ده بصمت — أي تعديل يعدّل السطر ده و§5.2 في الخطة.
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
      -- رقم الطلب: ٦ حروف من أبجدية ٣٢ حرف بدون O/0/I/1.
      -- كل حرف من بايت كامل % 32، و256 = 8×32 فالتوزيع **غير متحيّز**.
      -- مفيش فحص وجود قبل الإدخال عن قصد: الضمانة الحقيقية هي
      -- orders_order_number_key + إعادة المحاولة تحت.
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
               -- تصحيح ب١٣-٣: الضرب على numeric **قبل** القسمة.
               -- integer × integer كان بيفيض قبل /100 حتى لما الناتج
               -- النهائي يدخل في integer عادي.
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
        -- قلب الذرّية: أي صنف مرفوض = صفر صفوف = مفيش طلب أصلاً.
        where s.ok_count > 0
          and s.ok_count = v_req_count
        -- حارس نطاق int4 (ب١٣-٣): المقارنة على numeric، فمفيش overflow
        -- وقت الفحص نفسه. لو اتخرق، صفر صفوف، و(ط) بترجّع الكود الدقيق.
          and s.subtotal >= 0
          and (s.subtotal + s.shipping) <= c_int4_max
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        returning id, order_number, subtotal_piastres, shipping_piastres, total_piastres
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
      -- ⚠ items_ins مش مُشار إليه في الـselect النهائي عن قصد (item_count
      --   اتشال من العقد — ب١٣-٤). ده **مش** كود ميّت: في بوستجريس، عبارات
      --   التعديل جوه WITH بتتنفّذ مرة واحدة وبالكامل، بغضّ النظر عن قراءة
      --   مخرجاتها من الاستعلام الرئيسي.
      select o.order_number, o.subtotal_piastres, o.shipping_piastres, o.total_piastres
        into v_order
      from new_order o;

      exit;  -- نجح، أو رجع صفر صفوف من on conflict — الحالتين بره الحلقة

    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- تصادم رقم الطلب فقط هو اللي يستاهل إعادة محاولة.
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
      'total_piastres', v_order.total_piastres);
  end if;

  -- صفر صفوف. الحسم في (د) حصل قبل القفل... لأ: **بعد** القفل. فمفيش احتمال
  -- إن الصف كان موجود وقتها. يبقى السبب واحد من تلاتة، نحدّده بدقة:
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

  -- (ط-1) صنف مش متاح أو طول مخالف
  if v_valid_count <> v_req_count then
    raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
  end if;

  -- (ط-2) الإجمالي بره نطاق integer — إعداد سعر أو شحن غلط، مش غلطة العميل
  v_shipping := case when v_threshold > 0 and v_subtotal >= v_threshold
                     then 0::numeric else v_base::numeric end;
  if (v_subtotal + v_shipping) > c_int4_max then
    raise exception 'ZELL_PRICE_OUT_OF_RANGE' using errcode = '45027';
  end if;

  -- (ط-3) الباقي: on conflict اشتغل من معاملة بمفتاح idempotency مكرّر
  --        **ورقم موبايل مختلف** (قفل مختلف، فما استنتهاش). حالة عدائية
  --        بالأساس. إعادة المحاولة هتمر على (د) وهتتعامل معاها صح وبأمان
  --        (فحص request_hash والجلسة)، فالكود هنا retryable عن قصد.
  raise exception 'ZELL_CONCURRENT_SUBMIT' using errcode = '45060';
end;
$create_order$;

-- ---------------------------------------------------------------------
-- (3) zell_get_order_receipt — إسقاط مقنّع، والتقنيع في الداتابيز
-- ---------------------------------------------------------------------
create or replace function public.zell_get_order_receipt(
  p_order_number       text,
  p_receipt_token_hash text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_receipt$
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
    'items', (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'product_name_ar',     i.product_name_ar,
                   'length_cm',           i.length_cm,
                   'width_cm',            i.width_cm,
                   'line_total_piastres', i.line_total_piastres)
                 order by i.id),
               '[]'::jsonb)
      from public.order_items i
      where i.order_id = v_row.id
    ));
end;
$get_receipt$;

-- ---------------------------------------------------------------------
-- (3.5) الأدوار المطلوبة لازم تكون موجودة — فشل واضح جوه المعاملة (ب١٤)
--
--  revoke/grant على دور مش موجود بيرمي خطأ محرّك عام. الفحص ده بيحوّله
--  لرسالة صريحة، وجوه begin/commit فالتراجع كامل وبدون أي أثر.
-- ---------------------------------------------------------------------
do $roles_exist$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(r.name, ', ' order by r.name) into v_missing
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
  where not exists (select 1 from pg_catalog.pg_roles g where g.rolname = r.name);

  if v_missing is not null then
    raise exception 'ZELL_MIGRATION_0006B_MISSING_ROLE: %', v_missing;
  end if;
end
$roles_exist$;

-- ---------------------------------------------------------------------
-- (4) الصلاحيات — PUBLIC أولاً (بيتمنح تلقائياً من المحرّك)
-- ---------------------------------------------------------------------
revoke all on function public.zell_create_order(
  jsonb, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;

revoke all on function public.zell_get_order_receipt(text, text)
  from public, anon, authenticated;

grant execute on function public.zell_create_order(
  jsonb, text, text, text, text, text, text, text, text, text)
  to zell_order_writer, service_role;

grant execute on function public.zell_get_order_receipt(text, text)
  to zell_order_writer, service_role;

-- service_role هو دور المفتاح اللي المتجر بيستخدمه دلوقتي. لما يتبدّل بدور
-- مقيّد، المتجر هيبقى zell_order_writer من غير أي تعديل كود — لأنه مش بيلمس
-- أي جدول في مسار الطلب.

-- ---------------------------------------------------------------------
-- (5) تحقق ذاتي
-- ---------------------------------------------------------------------
do $verify$
declare
  v_tbl_owner text;
  v_fn_owner  text;
  v_bad       text;
begin
  -- (5-أ) الدالتين مملوكتين لمالك الجداول، وإلا security definer ما يتخطّاش RLS
  select pg_catalog.pg_get_userbyid(c.relowner) into v_tbl_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'orders';

  for v_fn_owner, v_bad in
    select pg_catalog.pg_get_userbyid(p.proowner), p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('zell_create_order', 'zell_get_order_receipt')
  loop
    if v_fn_owner is distinct from v_tbl_owner then
      raise exception 'ZELL_MIGRATION_0006B_OWNER: % owned by %, orders owned by %',
        v_bad, v_fn_owner, v_tbl_owner;
    end if;
  end loop;

  -- (5-ب) الدور **مالوش أي صلاحية** على أي جدول في public
  select pg_catalog.string_agg(t.tablename, ', ') into v_bad
  from pg_catalog.pg_tables t
  where t.schemaname = 'public'
    and (pg_catalog.has_table_privilege('zell_order_writer',
           (t.schemaname || '.' || t.tablename)::regclass, 'select')
      or pg_catalog.has_table_privilege('zell_order_writer',
           (t.schemaname || '.' || t.tablename)::regclass, 'insert')
      or pg_catalog.has_table_privilege('zell_order_writer',
           (t.schemaname || '.' || t.tablename)::regclass, 'update')
      or pg_catalog.has_table_privilege('zell_order_writer',
           (t.schemaname || '.' || t.tablename)::regclass, 'delete'));

  if v_bad is not null then
    raise exception 'ZELL_MIGRATION_0006B_ROLE_HAS_TABLE_PRIVS: %', v_bad;
  end if;

  -- (5-ج) الدور عنده execute على الدالتين
  if not pg_catalog.has_function_privilege('zell_order_writer',
           'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
           'execute')
     or not pg_catalog.has_function_privilege('zell_order_writer',
           'public.zell_get_order_receipt(text, text)', 'execute') then
    raise exception 'ZELL_MIGRATION_0006B_MISSING_EXECUTE';
  end if;

  -- (5-د) الدور مش BYPASSRLS ومش قادر يعمل login
  if exists (select 1 from pg_catalog.pg_roles
             where rolname = 'zell_order_writer' and (rolbypassrls or rolcanlogin)) then
    raise exception 'ZELL_MIGRATION_0006B_ROLE_ATTRS';
  end if;

  -- (5-هـ) FORCE ROW LEVEL SECURITY مقفولة على كل جدول الدالتين بيلمسوه (ب١٤).
  --        نموذج الأمان كله قايم على إن مالك الجدول بيتخطى RLS، وده صحيح
  --        **بس** لما relforcerowsecurity = false. من غير التأكيد ده، تفعيل
  --        العلم لاحقاً بيفضّي الدالتين **بصمت** والـmigration مش هتشتكي.
  select pg_catalog.count(*)::text into v_bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('orders', 'order_items', 'products', 'settings');
  if v_bad <> '4' then
    raise exception 'ZELL_MIGRATION_0006B_TABLES: expected 4, found %', v_bad;
  end if;

  select pg_catalog.string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('orders', 'order_items', 'products', 'settings')
    and c.relforcerowsecurity;
  if v_bad is not null then
    raise exception 'ZELL_MIGRATION_0006B_FORCE_RLS: %', v_bad;
  end if;

  -- (5-و) PUBLIC و anon و authenticated **ماعندهمش** execute على الدالتين (ب١٤).
  --        proacl = null معناها «الصلاحيات الافتراضية»، والافتراضي للدوال هو
  --        execute لـPUBLIC — فالـnull لازم تبقى **فشل**، مش نجاح.
  --        grantee = 0 في aclexplode هو الدور الوهمي PUBLIC.
  select pg_catalog.string_agg(p.proname, ', ' order by p.proname) into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('zell_create_order', 'zell_get_order_receipt')
    and (p.proacl is null
      or exists (select 1 from pg_catalog.aclexplode(p.proacl) ae
                 where ae.grantee = 0 and ae.privilege_type = 'EXECUTE'));
  if v_bad is not null then
    raise exception 'ZELL_MIGRATION_0006B_PUBLIC_EXECUTE: %', v_bad;
  end if;

  if pg_catalog.has_function_privilege('anon',
       'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
       'execute')
     or pg_catalog.has_function_privilege('anon',
       'public.zell_get_order_receipt(text, text)', 'execute')
     or pg_catalog.has_function_privilege('authenticated',
       'public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text)',
       'execute')
     or pg_catalog.has_function_privilege('authenticated',
       'public.zell_get_order_receipt(text, text)', 'execute') then
    raise exception 'ZELL_MIGRATION_0006B_ANON_EXECUTE';
  end if;
end
$verify$;

commit;

-- =====================================================================
-- أكواد الأخطاء الثابتة (الباك إند بيحوّلها لرسايل عربية ثابتة)
-- =====================================================================
--  45001 ZELL_IDEMPOTENCY_REQUIRED      45003 ZELL_IDEMPOTENCY_MISMATCH
--  45004 ZELL_REQUEST_HASH_INVALID      45005 ZELL_SESSION_HASH_INVALID
--  45006 ZELL_RECEIPT_HASH_INVALID      45007 ZELL_REPLAY_NOT_AUTHORIZED
--  45020 ZELL_INVALID_NAME              45021 ZELL_INVALID_PHONE
--  45022 ZELL_INVALID_ADDRESS           45023 ZELL_CART_INVALID
--  45024 ZELL_CART_EMPTY                45025 ZELL_CART_TOO_LARGE
--  45026 ZELL_NOTES_TOO_LONG            45027 ZELL_PRICE_OUT_OF_RANGE
--  45030 ZELL_SETTINGS_MISSING          45031 ZELL_GOVERNORATE_NOT_SERVED
--  45040 ZELL_ITEM_UNAVAILABLE          45041 ZELL_PHONE_DAILY_LIMIT
--  45050 ZELL_ORDER_NUMBER_EXHAUSTED    45060 ZELL_CONCURRENT_SUBMIT
--
--  ⚠ 45004 · 45005 · 45006 أكواد **داخلية**: التلات هاشات بيحسبهم الباك إند
--    نفسه ومش جايين من الـbody، فظهور أي واحد منهم = باگ في الباك إند.
--    بيتحوّلوا كلهم لرد INTERNAL ثابت بدون أي تفصيلة للعميل (الخطة §1.3).
--
-- =====================================================================
-- التراجع (للمرجع — مش بيتنفّذ تلقائياً)
-- =====================================================================
--  begin;
--    drop function if exists public.zell_get_order_receipt(text, text);
--    drop function if exists public.zell_create_order(
--      jsonb, text, text, text, text, text, text, text, text, text);
--    revoke usage on schema public from zell_order_writer;
--    drop role if exists zell_order_writer;
--  commit;
--  مفيش أي صف طلب بيضيع في التراجع ده.
