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
--  ⚠ ملاحظات search_path = '' (متحقَّق منها على PostgreSQL 17.6):
--    • كل دالة مدمجة لازم pg_catalog. صريح.
--    • coalesce / nullif / case / cast / between / in هي **بناءات لغوية**
--      مش دوال — ما تتqualifyش وما تحتاجش.
--    • gen_random_uuid موجودة في pg_catalog في PG13+ (ومكرّرة في extensions).
--      بنستخدم pg_catalog عن قصد عشان ما نعتمدش على schema الإضافات.
--
--  ⚠ اعتمادية موثّقة (متحقّق منها على Production):
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

  v_req_count   integer;
  v_rates       jsonb;
  v_free        jsonb;
  v_disabled    jsonb;
  v_phone_count integer;
  v_order_no    text;
  v_order       record;
  v_existing    record;
  v_constraint  text;
  v_valid_count integer;
  v_attempt     integer;
begin
  ------------------------------------------------------------------
  -- (أ) المفتاح والهاشات التلاتة
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
  -- (ب) التحقق النصّي
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
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > c_max_notes then
    raise exception 'ZELL_NOTES_TOO_LONG' using errcode = '45026';
  end if;

  ------------------------------------------------------------------
  -- (ج) تحقق آمن من شكل السلة **قبل** أي cast
  ------------------------------------------------------------------
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
  -- (د) إعدادات الشحن — shipping_default_piastres **مش مقروء** عن قصد
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

  ------------------------------------------------------------------
  -- (هـ) المحافظة: موجودة في rates **و** مش في disabled
  ------------------------------------------------------------------
  if not (v_rates ? coalesce(p_governorate, ''))
     or v_disabled ? coalesce(p_governorate, '') then
    raise exception 'ZELL_GOVERNORATE_NOT_SERVED' using errcode = '45031';
  end if;
  if pg_catalog.jsonb_typeof(v_rates -> p_governorate) <> 'number' then
    raise exception 'ZELL_SETTINGS_MISSING' using errcode = '45030';
  end if;

  ------------------------------------------------------------------
  -- (و) نافذة الموبايل — بتعدّ الطلبات المكتملة، فالتراجع ما يأثّرش عليها
  ------------------------------------------------------------------
  select pg_catalog.count(*)::integer into v_phone_count
  from public.orders o
  where o.customer_phone = p_customer_phone
    and o.created_at >= pg_catalog.now() - interval '24 hours';

  if v_phone_count >= c_max_per_phone_day then
    raise exception 'ZELL_PHONE_DAILY_LIMIT' using errcode = '45041';
  end if;

  ------------------------------------------------------------------
  -- (ز) الإدخال — عبارة CTE واحدة، مع إعادة المحاولة على تصادم الرقم
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
               pg_catalog.round((p.price_per_meter_piastres * r.length_cm) / 100.0)::integer as line_total
        from req r
        join public.products p
          on p.id = r.product_id
         and p.is_active
         and r.length_cm between p.min_length_cm and p.max_length_cm
         and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
      ),
      totals as (
        select coalesce(pg_catalog.sum(line_total), 0)::integer as subtotal,
               pg_catalog.count(*)::integer                     as ok_count
        from priced
      ),
      ship as (
        select (v_rates ->> p_governorate)::integer as base_piastres,
               (v_free  #>> '{}')::integer          as free_threshold
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
          t.subtotal,
          case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold
               then 0 else sh.base_piastres end,
          t.subtotal + case when sh.free_threshold > 0 and t.subtotal >= sh.free_threshold
               then 0 else sh.base_piastres end,
          p_idempotency_key,
          p_request_hash,
          p_checkout_session_hash,
          p_receipt_token_hash,
          pg_catalog.now() + (c_receipt_days || ' days')::interval
        from totals t, ship sh
        -- قلب الذرّية: أي صنف مرفوض = صفر صفوف = مفيش طلب أصلاً.
        where t.ok_count > 0 and t.ok_count = v_req_count
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
             (select pg_catalog.count(*)::integer from items_ins) as item_count
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
  -- (ح) طلب جديد
  ------------------------------------------------------------------
  if v_order.order_number is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', false,
      'order_number', v_order.order_number,
      'subtotal_piastres', v_order.subtotal_piastres,
      'shipping_piastres', v_order.shipping_piastres,
      'total_piastres', v_order.total_piastres,
      'item_count', v_order.item_count);
  end if;

  ------------------------------------------------------------------
  -- (ط) صفر صفوف — تمييز رباعي
  ------------------------------------------------------------------
  select o.order_number, o.request_hash, o.checkout_session_hash,
         o.subtotal_piastres, o.shipping_piastres, o.total_piastres
    into v_existing
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if v_existing.order_number is not null then

    -- (ط-1) نفس المفتاح، محتوى مختلف
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'ZELL_IDEMPOTENCY_MISMATCH' using errcode = '45003';
    end if;

    -- (ط-2) نفس المفتاح ونفس المحتوى، بس **متصفح تاني**.
    --       ده الحاجز الأساسي: المفتاح + الـbody لوحدهم ما يقدروش يصدروا
    --       ولا يدوّروا أي وصول للإيصال.
    if v_existing.checkout_session_hash is distinct from p_checkout_session_hash then
      raise exception 'ZELL_REPLAY_NOT_AUTHORIZED' using errcode = '45007';
    end if;

    -- (ط-3) replay مُصرَّح: تدوير بخانتين.
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

  -- (ط-4) مفيش صف بالمفتاح. نفرّق بين «سلة مرفوضة» و«تسابق»:
  --        نعيد تقييم صلاحية السلة. لو كلها سليمة، فالصفر صفوف جاي من
  --        on conflict ومعناه تسابق — مش صنف غير متاح.
  select pg_catalog.count(*)::integer into v_valid_count
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

  if v_valid_count = v_req_count then
    raise exception 'ZELL_CONCURRENT' using errcode = '45060';
  end if;

  raise exception 'ZELL_ITEM_UNAVAILABLE' using errcode = '45040';
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
--  45026 ZELL_NOTES_TOO_LONG            45030 ZELL_SETTINGS_MISSING
--  45031 ZELL_GOVERNORATE_NOT_SERVED    45040 ZELL_ITEM_UNAVAILABLE
--  45041 ZELL_PHONE_DAILY_LIMIT         45050 ZELL_ORDER_NUMBER_EXHAUSTED
--  45060 ZELL_CONCURRENT
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
