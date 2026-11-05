-- INSTALLER-SHIPPING B — مقارنة القديم بالجديد وسيناريوهات محددة بعد تطبيق 0025 (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0025_sql_ci.sh بعد تطبيق 0025_installer_shipping.sql على داتابيز مبنية من الصفر بـ
--   build_from_scratch.list. الـ CI بيحقن بعد begin; نسخة pg_temp.ci_old_zell_create_order = جسم 0021ex بالحرف (مؤقتة، وجوه
--   المعاملة، فمابتظهرش في أي verify وبتترجع).
-- • البيانات كلها جوه المعاملة وبتترجع: 3 منتجات (متر 30000 · متر موقوف 25000 · قطعة 15000)، عرض 100 بـ 52000 وعرض 150 موقوف،
--   الشحن القاهرة 5000 · الجيزة 6000 · أسوان 9000 موقوفة، الحد المجاني 500000، مناطق القاهرة: المعادي ومدينة نصر، الفني 1500
--   للمتر والانتقال المعادي 2500 ومدينة نصر 0، الكوبونات ISPC10 (10% بحد 5000) · ISFX20 (2000 من 100000) · ISOLD1 (منتهي)،
--   والسريع: القاهرة 11000 · الجيزة مقفول.
-- • المصفوفة (X): 14 سلة × 10 (محافظة/منطقة/فني) × 5 كوبونات × 9 إعدادات مقدّم = 6300 حالة، كل حالة 7 نداءات (القديم: من غير
--   طريقة · سريع · قيمة غير معروفة؛ الجديد: من غير طريقة · standard · express · قيمة غير معروفة)، كل نداء في subtransaction بيترجع.
--   الفرق المسموح الوحيد: طلب بفني اتقبل = الشحن 0 · الإجمالي = القديم − الشحن القديم · لقطة الطريقة والمدة NULL · المقدّم =
--   zell_payment_fee_calc على الأرقام الجديدة. أي فرق تاني (الأصناف · الخصم · الكوبون · التركيب · الانتقال · الرد · الرفض) = فشل.
-- • السيناريوهات (F): أرقام محسوبة باليد للحالات المهمة، والـ replay لطلب جديد ولطلب اتعمل بالجسم القديم.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 23 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '120s';
set local statement_timeout = '1500s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create temporary table ci_fx (k text primary key, v text) on commit drop;

-- البيانات (جوه المعاملة)
do $fx$
declare
  v_p1 public.products.id%type;
  v_p2 public.products.id%type;
  v_p3 public.products.id%type;
begin
  insert into public.products (name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity)
  values ('ci-0025 فيلم', 30000, 50, 100, 50, 3000, true, 'meter', 1) returning id into v_p1;
  insert into public.products (name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity)
  values ('ci-0025 فيلم موقوف', 25000, 50, 100, 50, 3000, false, 'meter', 1) returning id into v_p2;
  insert into public.products (name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity)
  values ('ci-0025 أداة', 15000, 50, 100, 50, 3000, true, 'piece', 10) returning id into v_p3;
  insert into public.product_widths (product_id, width_cm, price_per_meter_piastres, is_active)
  values (v_p1, 100, 52000, true), (v_p1, 150, 70000, false);
  insert into pg_temp.ci_fx (k, v) values ('p1', v_p1::text), ('p2', v_p2::text), ('p3', v_p3::text);

  insert into public.settings (key, value) values
    ('shipping_rates', '{"القاهرة": 5000, "الجيزة": 6000, "أسوان": 9000}'),
    ('free_shipping_threshold_piastres', '500000'),
    ('shipping_disabled_governorates', '["أسوان"]'),
    ('shipping_areas', '{"القاهرة": ["المعادي", "مدينة نصر"]}'),
    ('installation', '{"enabled": true, "feePerMeterPiastres": 1500, "areas": {"القاهرة": {"المعادي": 2500, "مدينة نصر": 0}}}'),
    ('coupons_enabled', 'true')
  on conflict (key) do update set value = excluded.value;

  insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres, starts_at, ends_at, max_uses, max_uses_per_phone)
  values ('ISPC10', 'percent', 10, null, 5000, 0, pg_catalog.now() - interval '2 days', null, null, 1),
         ('ISFX20', 'fixed', null, 2000, null, 100000, pg_catalog.now() - interval '2 days', null, null, 1),
         ('ISOLD1', 'percent', 10, null, null, 0, pg_catalog.now() - interval '2 days', pg_catalog.now() - interval '1 day', null, 1);

  update public.zell_shipping_options
     set express_enabled = true,
         governorates = '{"القاهرة": {"standard_days_min": 2, "standard_days_max": 4, "express_enabled": true, "express_price_piastres": 11000, "express_days_min": 1, "express_days_max": 1},
                          "الجيزة": {"standard_days_min": 3, "standard_days_max": 5, "express_enabled": false}}'::jsonb
   where id;
end
$fx$;

create function pg_temp.ci_call(p_fn text, p_items text, p_gov text, p_area text, p_inst boolean, p_coupon text, p_phone text, p_method text)
returns text language sql as $f$
  select format('select %s(p_items => %L::jsonb, p_customer_name => %L, p_customer_phone => %L, p_governorate => %L, p_address => %L, '
                || 'p_notes => %L, p_idempotency_key => %L, p_request_hash => %L, p_checkout_session_hash => %L, p_receipt_token_hash => %L%s%s%s%s)',
                p_fn, p_items, 'عميل المقارنة', p_phone, p_gov, 'عنوان المقارنة طويل كفاية', 'ملاحظة', 'ci-0025-key-' || p_phone,
                repeat('a', 64), repeat('b', 64), repeat('c', 64),
                case when p_area is null then '' else format(', p_area => %L', p_area) end,
                case when p_inst then ', p_installation => true' else '' end,
                case when p_coupon is null then '' else format(', p_coupon_code => %L', p_coupon) end,
                case when p_method is null then '' else format(', p_shipping_method => %L', p_method) end);
$f$;

-- نداء في subtransaction بيترجع: الرد · صف الطلب · الأصناف · المقدّم المحسوب من zell_payment_fee_calc على أرقام الصف نفسه.
create function pg_temp.ci_try(p_sql text) returns jsonb language plpgsql as $f$
declare
  r jsonb;
  v jsonb;
begin
  begin
    execute p_sql into r;
    select pg_catalog.jsonb_build_object(
             'ok', true,
             'resp', r - 'order_number' - 'receipt_expires_at',
             'row', pg_catalog.to_jsonb(o) - 'id' - 'order_number' - 'created_at' - 'updated_at' - 'receipt_expires_at',
             'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) - 'id' - 'order_id' - 'created_at' order by i.id), '[]'::jsonb)
                         from public.order_items i where i.order_id = o.id),
             'fee_calc', public.zell_payment_fee_calc((select s.confirmation_fee from public.zell_payment_settings s where s.id),
                                                      o.total_piastres, o.shipping_piastres,
                                                      exists (select 1 from public.order_items i where i.order_id = o.id and i.sale_unit = 'meter'),
                                                      o.installation_requested))
      into v
      from public.orders o where o.order_number = r ->> 'order_number';
    raise exception using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then null;
    when others then v := pg_catalog.jsonb_build_object('ok', false, 'state', sqlstate, 'msg', sqlerrm);
  end;
  return coalesce(v, pg_catalog.jsonb_build_object('ok', false, 'state', 'NOROW', 'msg', 'no order row for the response'));
end
$f$;

-- طلب بفني اتقبل: المتوقع من القديم (من غير طريقة) للجديد. NULL = مطابق، وإلا السبب.
create function pg_temp.ci_install_diff(o jsonb, n jsonb) returns text language plpgsql as $f$
declare
  d text[] := array['shipping_piastres', 'total_piastres', 'confirmation_fee_piastres', 'shipping_method', 'shipping_days_min', 'shipping_days_max'];
  v_ship bigint := (o -> 'row' ->> 'shipping_piastres')::bigint;
  v_tot bigint := (o -> 'row' ->> 'total_piastres')::bigint;
  k text;
begin
  if not coalesce((n ->> 'ok')::boolean, false) then return 'new rejected: ' || coalesce(n ->> 'state', '?') || ' ' || coalesce(n ->> 'msg', ''); end if;
  if ((n -> 'row') - d) is distinct from ((o -> 'row') - d) then return 'row differs outside shipping/total/fee/snapshot'; end if;
  if (n -> 'row' ->> 'shipping_piastres')::bigint <> 0 then return 'shipping not 0'; end if;
  if (n -> 'row' ->> 'total_piastres')::bigint <> v_tot - v_ship then return 'total <> old total - old shipping'; end if;
  if (n -> 'row' ->> 'confirmation_fee_piastres')::bigint is distinct from (n ->> 'fee_calc')::bigint then return 'fee <> fee_calc'; end if;
  if (n -> 'row' -> 'shipping_method') is distinct from 'null'::jsonb or (n -> 'row' -> 'shipping_days_min') is distinct from 'null'::jsonb
     or (n -> 'row' -> 'shipping_days_max') is distinct from 'null'::jsonb then return 'snapshot not NULL'; end if;
  if (n -> 'items') is distinct from (o -> 'items') then return 'items differ'; end if;
  if ((n -> 'resp') - d) is distinct from ((o -> 'resp') - d) then return 'response differs outside shipping/total/fee'; end if;
  foreach k in array d loop
    if ((n -> 'resp') ? k) is distinct from ((o -> 'resp') ? k) then return 'response keys differ: ' || k; end if;
  end loop;
  if (n -> 'resp') ? 'shipping_piastres' and (n -> 'resp' ->> 'shipping_piastres')::bigint <> 0 then return 'response shipping'; end if;
  if (n -> 'resp') ? 'total_piastres' and (n -> 'resp' ->> 'total_piastres')::bigint <> v_tot - v_ship then return 'response total'; end if;
  if (n -> 'resp') ? 'confirmation_fee_piastres'
     and (n -> 'resp' -> 'confirmation_fee_piastres') is distinct from (n -> 'row' -> 'confirmation_fee_piastres') then return 'response fee'; end if;
  return null;
end
$f$;

create temporary table ci_bad (n integer, detail text) on commit drop;
create temporary table ci_cnt (k text primary key, v bigint) on commit drop;

-- (X) المصفوفة
do $m$
declare
  p1 text := (select v from pg_temp.ci_fx where k = 'p1');
  p2 text := (select v from pg_temp.ci_fx where k = 'p2');
  p3 text := (select v from pg_temp.ci_fx where k = 'p3');
  carts text[];
  combos text[] := array['القاهرة||f', 'الجيزة||f', 'القاهرة|المعادي|f', 'أسوان||f', 'القاهرة|المعادي|t', 'القاهرة|مدينة نصر|t',
                         'القاهرة||t', 'الجيزة|المعادي|t', 'أسوان|المعادي|t', 'القاهرة|الزمالك|t'];
  coupons text[] := array[null, 'ISPC10', 'ISFX20', 'NOPE1', 'ISOLD1'];
  cfgs text[] := array[
    '{"enabled": false}',
    '{"enabled": true, "scope": "all", "method": "fixed", "fixed_piastres": 5000}',
    '{"enabled": true, "scope": "made_to_measure", "method": "percent", "percent_bp": 1000}',
    '{"enabled": true, "scope": "with_installation", "method": "shipping", "shipping_fallback_piastres": 3000}',
    '{"enabled": true, "scope": "above_amount", "method": "fixed", "fixed_piastres": 250000, "threshold_piastres": 100000}',
    '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 4000}',
    '{"enabled": true, "scope": "all", "method": "percent", "percent_bp": 3333}',
    '{"enabled": true, "scope": "with_installation", "method": "percent", "percent_bp": 500}',
    '{"enabled": true, "scope": "made_to_measure", "method": "shipping", "shipping_fallback_piastres": 80000}'];
  n integer := 0;
  v_gov text; v_area text; v_inst boolean; v_phone text; v_why text;
  o0 jsonb; ox jsonb; ob jsonb; n0 jsonb; ns jsonb; nx jsonb; nb jsonb;
  c_cases bigint := 0; c_noinst bigint := 0; c_noinst_ok bigint := 0; c_inst_ok bigint := 0; c_inst_rej bigint := 0;
  c_ship_dropped bigint := 0; c_free bigint := 0; c_exp_ign bigint := 0; c_bogus bigint := 0; c_feecalc bigint := 0;
  c_fee_up bigint := 0; c_fee_down bigint := 0; c_fee_zero bigint := 0; c_coupon bigint := 0;
  c_bad bigint := 0;
begin
  carts := array[
    format('[{"productId":%s,"lengthCm":300}]', p1),
    format('[{"productId":%s,"lengthCm":350,"widthCm":100}]', p1),
    format('[{"productId":%s,"lengthCm":300,"widthCm":50}]', p1),
    format('[{"productId":%s,"quantity":2}]', p3),
    format('[{"productId":%s,"lengthCm":300},{"productId":%s,"quantity":1}]', p1, p3),
    format('[{"productId":%s,"lengthCm":2000}]', p1),
    format('[{"productId":%s,"lengthCm":1000},{"productId":%s,"lengthCm":500,"widthCm":100}]', p1, p1),
    format('[{"productId":%s,"lengthCm":325}]', p1),
    format('[{"productId":%s,"lengthCm":300}]', p2),
    format('[{"productId":%s,"lengthCm":300,"widthCm":150}]', p1),
    format('[{"productId":%s,"quantity":11}]', p3),
    '[]',
    format('[{"productId":%s,"lengthCm":100}]', p1),
    format('[{"productId":%s,"lengthCm":1600}]', p1)];
  for i in 1 .. array_length(carts, 1) loop
    for j in 1 .. array_length(combos, 1) loop
      for k in 1 .. array_length(coupons, 1) loop
        for c in 1 .. array_length(cfgs, 1) loop
          n := n + 1;
          c_cases := c_cases + 1;
          update public.zell_payment_settings set confirmation_fee = cfgs[c]::jsonb where id;
          v_gov := split_part(combos[j], '|', 1);
          v_area := nullif(split_part(combos[j], '|', 2), '');
          v_inst := split_part(combos[j], '|', 3) = 't';
          v_phone := '010' || lpad(n::text, 8, '0');
          o0 := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, null));
          ox := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, 'express'));
          ob := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, 'ci-unknown'));
          n0 := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, null));
          ns := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, 'standard'));
          nx := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, 'express'));
          nb := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, 'ci-unknown'));
          v_why := null;
          -- القيمة غير المعروفة: نفس رفض القديم بالحرف (45432)، مع الفني ومن غيره
          if nb is distinct from ob or coalesce((nb ->> 'ok')::boolean, true) or nb ->> 'state' <> '45432' then
            v_why := 'unknown method: old=' || coalesce(ob ->> 'state', '?') || ' new=' || coalesce(nb ->> 'state', 'ok');
          else
            c_bogus := c_bogus + 1;
          end if;
          -- كل نداء ناجح: المقدّم المحفوظ = zell_payment_fee_calc على أرقام الصف
          if v_why is null then
            if exists (select 1 from unnest(array[o0, ox, n0, ns, nx]) x
                        where (x ->> 'ok')::boolean and (x -> 'row' ->> 'confirmation_fee_piastres')::bigint is distinct from (x ->> 'fee_calc')::bigint) then
              v_why := 'stored fee <> fee_calc';
            else
              c_feecalc := c_feecalc + 1;
            end if;
          end if;
          if v_why is null and not v_inst then
            c_noinst := c_noinst + 1;
            if n0 is distinct from o0 then v_why := 'no installer: new <> old (no method)';
            elsif ns is distinct from o0 then v_why := 'no installer: new standard <> old (no method)';
            elsif nx is distinct from ox then v_why := 'no installer: new express <> old express';
            elsif (o0 ->> 'ok')::boolean then c_noinst_ok := c_noinst_ok + 1;
            end if;
          elsif v_why is null then
            if not (o0 ->> 'ok')::boolean then
              c_inst_rej := c_inst_rej + 1;
              if n0 is distinct from o0 or (ns ->> 'state') is distinct from (o0 ->> 'state') or (nx ->> 'state') is distinct from (o0 ->> 'state')
                 or coalesce((ns ->> 'ok')::boolean, true) or coalesce((nx ->> 'ok')::boolean, true) then
                v_why := 'installer rejected by old: new differs: old=' || coalesce(o0 ->> 'state', '?') || ' new=' || coalesce(n0 ->> 'state', 'ok')
                         || '/' || coalesce(ns ->> 'state', 'ok') || '/' || coalesce(nx ->> 'state', 'ok');
              end if;
            else
              v_why := pg_temp.ci_install_diff(o0, n0);
              if v_why is null and ns is distinct from n0 then v_why := 'installer: new standard <> new (no method)'; end if;
              if v_why is null and nx is distinct from n0 then v_why := 'installer: new express <> new (no method)'; end if;
              if v_why is null then
                c_inst_ok := c_inst_ok + 1;
                if (o0 -> 'row' ->> 'shipping_piastres')::bigint > 0 then c_ship_dropped := c_ship_dropped + 1; else c_free := c_free + 1; end if;
                if (ox ->> 'ok')::boolean and ox -> 'row' ->> 'shipping_method' = 'express' then c_exp_ign := c_exp_ign + 1; end if;
                if (o0 -> 'row' ->> 'discount_piastres')::bigint > 0 then c_coupon := c_coupon + 1; end if;
                if (n0 -> 'row' ->> 'confirmation_fee_piastres')::bigint > (o0 -> 'row' ->> 'confirmation_fee_piastres')::bigint then c_fee_up := c_fee_up + 1; end if;
                if (n0 -> 'row' ->> 'confirmation_fee_piastres')::bigint < (o0 -> 'row' ->> 'confirmation_fee_piastres')::bigint then c_fee_down := c_fee_down + 1; end if;
                if (n0 -> 'row' ->> 'confirmation_fee_piastres')::bigint = 0 and (o0 -> 'row' ->> 'confirmation_fee_piastres')::bigint > 0 then c_fee_zero := c_fee_zero + 1; end if;
              end if;
            end if;
          end if;
          if v_why is not null then
            c_bad := c_bad + 1;
            if c_bad <= 5 then
              insert into pg_temp.ci_bad (n, detail) values (n, left('#' || n || ' cart=' || i || ' combo=' || combos[j] || ' coupon=' || coalesce(coupons[k], '-')
                                                                  || ' cfg=' || c || ': ' || v_why, 380));
            end if;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  insert into pg_temp.ci_cnt (k, v) values
    ('cases', c_cases), ('bad', c_bad), ('noinst', c_noinst), ('noinst_ok', c_noinst_ok), ('inst_ok', c_inst_ok), ('inst_rej', c_inst_rej),
    ('ship_dropped', c_ship_dropped), ('free', c_free), ('exp_ign', c_exp_ign), ('bogus', c_bogus), ('feecalc', c_feecalc),
    ('fee_up', c_fee_up), ('fee_down', c_fee_down), ('fee_zero', c_fee_zero), ('coupon', c_coupon);
end
$m$;

do $xr$
declare
  c jsonb := (select pg_catalog.jsonb_object_agg(k, v) from pg_temp.ci_cnt);
  b text := coalesce((select pg_catalog.string_agg(detail, ' || ' order by n) from pg_temp.ci_bad), '');
  cnt text := (select pg_catalog.string_agg(k || '=' || v, ' ' order by k) from pg_temp.ci_cnt);
begin
  perform pg_temp.zt('X01 parity matrix: 6300 cases x 7 calls, 0 mismatches', (c ->> 'cases')::bigint = 6300 and (c ->> 'bad')::bigint = 0,
                     cnt || ' ' || b);
  perform pg_temp.zt('X02 no installer: new (no method / standard / express) = old exactly (response, row, items, fee, snapshot, rejections)',
                     (c ->> 'bad')::bigint = 0 and (c ->> 'noinst')::bigint = 2520 and (c ->> 'noinst_ok')::bigint >= 300, cnt);
  perform pg_temp.zt('X03 installer accepted: shipping 0, total = old - old shipping, method/days NULL, fee = fee_calc, all else identical',
                     (c ->> 'bad')::bigint = 0 and (c ->> 'inst_ok')::bigint >= 200 and (c ->> 'ship_dropped')::bigint >= 150 and (c ->> 'free')::bigint >= 20, cnt);
  perform pg_temp.zt('X04 installer rejected by old body: new body rejects with the same code and message (no method, standard, express)',
                     (c ->> 'bad')::bigint = 0 and (c ->> 'inst_rej')::bigint >= 500, cnt);
  perform pg_temp.zt('X05 installer + valid express choice: ignored (same as no method), counted where old charged express',
                     (c ->> 'bad')::bigint = 0 and (c ->> 'exp_ign')::bigint >= 100, cnt);
  perform pg_temp.zt('X06 unknown shipping method: 45432 with and without installer, identical to old, in every case',
                     (c ->> 'bogus')::bigint = 6300, cnt);
  perform pg_temp.zt('X07 every successful call: stored confirmation fee = zell_payment_fee_calc on the stored numbers',
                     (c ->> 'feecalc')::bigint = (c ->> 'bogus')::bigint and (c ->> 'feecalc')::bigint = 6300, cnt);
  perform pg_temp.zt('X08 installer deposit moves both ways as the contract says (up via fallback, down via percent, to 0 via above_amount), coupons kept',
                     (c ->> 'fee_up')::bigint >= 1 and (c ->> 'fee_down')::bigint >= 1 and (c ->> 'fee_zero')::bigint >= 1 and (c ->> 'coupon')::bigint >= 20, cnt);
end
$xr$;

-- (F) سيناريوهات بأرقام محسوبة باليد. سلة 300 سم من المنتج 1 = 90000 · تركيب 1500 × 3 = 4500 · انتقال المعادي 2500 · شحن القاهرة 5000.
do $fs$
declare
  p1 text := (select v from pg_temp.ci_fx where k = 'p1');
  c300 text := format('[{"productId":%s,"lengthCm":300}]', p1);
  c100 text := format('[{"productId":%s,"lengthCm":100}]', p1);
  c2000 text := format('[{"productId":%s,"lengthCm":2000}]', p1);
  o jsonb; n jsonb; x jsonb; r1 jsonb; r2 jsonb; v_cnt0 bigint; v_cnt1 bigint;
  f_off text := '{"enabled": false}';
begin
  update public.zell_payment_settings set confirmation_fee = f_off::jsonb where id;

  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000001', null));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000001', null));
  perform pg_temp.zt('F01 installer Cairo/Maadi 300 cm: old 102000 with shipping 5000 -> new 97000, shipping 0, method/days NULL',
                     (o -> 'row' ->> 'total_piastres')::bigint = 102000 and (o -> 'row' ->> 'shipping_piastres')::bigint = 5000
                     and (n -> 'row' ->> 'total_piastres')::bigint = 97000 and (n -> 'row' ->> 'shipping_piastres')::bigint = 0
                     and (n -> 'row' ->> 'subtotal_piastres')::bigint = 90000
                     and n -> 'row' -> 'shipping_method' = 'null'::jsonb and n -> 'row' -> 'shipping_days_min' = 'null'::jsonb
                     and n -> 'row' -> 'shipping_days_max' = 'null'::jsonb,
                     left((o -> 'row')::text || ' => ' || (n -> 'row')::text, 400));

  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000002', 'express'));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000002', 'express'));
  perform pg_temp.zt('F02 installer + express (available): old 108000 express 11000 -> new 97000, shipping 0, method NULL',
                     (o -> 'row' ->> 'total_piastres')::bigint = 108000 and o -> 'row' ->> 'shipping_method' = 'express'
                     and (n -> 'row' ->> 'total_piastres')::bigint = 97000 and n -> 'row' -> 'shipping_method' = 'null'::jsonb,
                     left(coalesce(o ->> 'state', '') || (o -> 'row')::text || ' => ' || (n -> 'row')::text, 400));

  update public.zell_shipping_options set express_enabled = false where id;
  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000003', 'express'));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000003', 'express'));
  x := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', null, false, null, '01100000003', 'express'));
  update public.zell_shipping_options set express_enabled = true where id;
  perform pg_temp.zt('F03 express unavailable: old 45431 with installer -> new accepts (ignored, 97000); without installer new still 45431',
                     o ->> 'state' = '45431' and (n -> 'row' ->> 'total_piastres')::bigint = 97000 and x ->> 'state' = '45431',
                     coalesce(o ->> 'state', 'ok') || ' / ' || coalesce(n ->> 'state', 'ok') || ' / ' || coalesce(x ->> 'state', 'ok'));

  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000004', 'EXPRESS'));
  x := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', null, false, null, '01100000004', ''));
  perform pg_temp.zt('F04 unknown method values stay rejected (45432): EXPRESS with installer, empty text without',
                     n ->> 'state' = '45432' and x ->> 'state' = '45432', coalesce(n ->> 'state', 'ok') || ' / ' || coalesce(x ->> 'state', 'ok'));

  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', null, false, null, '01100000005', 'express'));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', null, false, null, '01100000005', 'express'));
  perform pg_temp.zt('F05 no installer + express: unchanged (101000, shipping 11000, method express, days 1/1)',
                     n = o and (n -> 'row' ->> 'total_piastres')::bigint = 101000 and n -> 'row' ->> 'shipping_method' = 'express'
                     and (n -> 'row' ->> 'shipping_days_min')::int = 1, left((n -> 'row')::text, 400));

  update public.zell_payment_settings set confirmation_fee = '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 3000}'::jsonb where id;
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000006', null));
  x := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', null, false, null, '01100000006', null));
  perform pg_temp.zt('F06 fee method shipping, fallback 3000: installer -> 3000 (fallback); no installer -> 5000 (shipping)',
                     (n -> 'row' ->> 'confirmation_fee_piastres')::bigint = 3000 and (x -> 'row' ->> 'confirmation_fee_piastres')::bigint = 5000,
                     coalesce(n -> 'row' ->> 'confirmation_fee_piastres', n ->> 'state') || ' / ' || coalesce(x -> 'row' ->> 'confirmation_fee_piastres', x ->> 'state'));

  perform pg_temp.zt('F07 fee method shipping without a fallback (fee function used by the order): shipping 0 -> 0; shipping 5000 -> 5000',
                     public.zell_payment_fee_calc('{"enabled": true, "scope": "all", "method": "shipping"}'::jsonb, 97000, 0, true, true) = 0
                     and public.zell_payment_fee_calc('{"enabled": true, "scope": "all", "method": "shipping"}'::jsonb, 102000, 5000, true, true) = 5000,
                     public.zell_payment_fee_calc('{"enabled": true, "scope": "all", "method": "shipping"}'::jsonb, 97000, 0, true, true)::text);

  update public.zell_payment_settings set confirmation_fee = '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 50000}'::jsonb where id;
  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c100, 'القاهرة', 'المعادي', true, null, '01100000008', null));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c100, 'القاهرة', 'المعادي', true, null, '01100000008', null));
  perform pg_temp.zt('F08 fallback above the total: installer 100 cm -> total 34000, fee capped at 34000 (old: 39000 with fee 5000)',
                     (n -> 'row' ->> 'total_piastres')::bigint = 34000 and (n -> 'row' ->> 'confirmation_fee_piastres')::bigint = 34000
                     and (o -> 'row' ->> 'total_piastres')::bigint = 39000 and (o -> 'row' ->> 'confirmation_fee_piastres')::bigint = 5000,
                     left((o -> 'row')::text || ' => ' || (n -> 'row')::text, 400));

  update public.zell_payment_settings set confirmation_fee = '{"enabled": true, "scope": "above_amount", "method": "fixed", "fixed_piastres": 2500, "threshold_piastres": 100000}'::jsonb where id;
  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000009', null));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000009', null));
  perform pg_temp.zt('F09 above_amount 100000: old 102000 -> fee 2500; new 97000 drops under the threshold -> fee 0',
                     (o -> 'row' ->> 'confirmation_fee_piastres')::bigint = 2500 and (n -> 'row' ->> 'confirmation_fee_piastres')::bigint = 0,
                     coalesce(o -> 'row' ->> 'confirmation_fee_piastres', o ->> 'state') || ' / ' || coalesce(n -> 'row' ->> 'confirmation_fee_piastres', n ->> 'state'));

  update public.zell_payment_settings set confirmation_fee = f_off::jsonb where id;
  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c2000, 'القاهرة', 'المعادي', true, null, '01100000010', null));
  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c2000, 'القاهرة', 'المعادي', true, null, '01100000010', null));
  perform pg_temp.zt('F10 free-shipping threshold already covered: old shipping 0 -> same total (600000 + 30000 + 2500); only the snapshot changes',
                     (o -> 'row' ->> 'shipping_piastres')::bigint = 0 and (n -> 'row' ->> 'total_piastres')::bigint = (o -> 'row' ->> 'total_piastres')::bigint
                     and (n -> 'row' ->> 'total_piastres')::bigint = 632500 and o -> 'row' ->> 'shipping_method' = 'standard'
                     and n -> 'row' -> 'shipping_method' = 'null'::jsonb,
                     left((o -> 'row')::text || ' => ' || (n -> 'row')::text, 400));

  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'مدينة نصر', true, null, '01100000011', null));
  perform pg_temp.zt('F11 installer area with travel 0 (Nasr City): total 94500 = 90000 + 4500, shipping 0',
                     (n -> 'row' ->> 'total_piastres')::bigint = 94500 and (n -> 'row' ->> 'shipping_piastres')::bigint = 0,
                     left(coalesce(n ->> 'state', '') || (n -> 'row')::text, 400));

  n := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, 'ISPC10', '01100000012', null));
  o := pg_temp.ci_try(pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, 'ISPC10', '01100000012', null));
  perform pg_temp.zt('F12 coupon ISPC10 with installer: discount 5000 (capped) kept; old 97000 -> new 92000',
                     (n -> 'row' ->> 'discount_piastres')::bigint = 5000 and (o -> 'row' ->> 'discount_piastres')::bigint = 5000
                     and (o -> 'row' ->> 'total_piastres')::bigint = 97000 and (n -> 'row' ->> 'total_piastres')::bigint = 92000,
                     left((o -> 'row')::text || ' => ' || (n -> 'row')::text, 400));

  -- replay: طلب جديد بيتحفظ (جوه المعاملة)، ونفس النداء تاني بيرجّع نفس الطلب ونفس اللقطة ومن غير طلب تاني
  select pg_catalog.count(*) into v_cnt0 from public.orders;
  execute pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000013', 'express') into r1;
  execute pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000013', 'express') into r2;
  select pg_catalog.count(*) into v_cnt1 from public.orders;
  perform pg_temp.zt('F13 replay of a new installer order: same order number, one row, stored snapshot (shipping 0, total 97000, method NULL)',
                     r1 ->> 'order_number' = r2 ->> 'order_number' and v_cnt1 = v_cnt0 + 1
                     and (select o.shipping_piastres = 0 and o.total_piastres = 97000 and o.shipping_method is null and o.shipping_days_min is null
                            from public.orders o where o.order_number = r1 ->> 'order_number'),
                     left(r1::text || ' | ' || r2::text, 400));

  -- replay: طلب اتعمل بالجسم القديم (شحن 5000)، والجسم الجديد بنفس المفتاح بيرجّعه بلقطته زي ما هي
  select pg_catalog.count(*) into v_cnt0 from public.orders;
  execute pg_temp.ci_call('pg_temp.ci_old_zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000014', null) into r1;
  execute pg_temp.ci_call('public.zell_create_order', c300, 'القاهرة', 'المعادي', true, null, '01100000014', null) into r2;
  select pg_catalog.count(*) into v_cnt1 from public.orders;
  perform pg_temp.zt('F14 replay of an order made by the old body: returned as stored (shipping 5000, total 102000, method standard), no new row',
                     r1 ->> 'order_number' = r2 ->> 'order_number' and v_cnt1 = v_cnt0 + 1
                     and (select o.shipping_piastres = 5000 and o.total_piastres = 102000 and o.shipping_method = 'standard'
                            from public.orders o where o.order_number = r1 ->> 'order_number'),
                     left(r1::text || ' | ' || r2::text, 400));

  perform pg_temp.zt('F15 stored rows satisfy the order constraints (total consistency and snapshot shape validated)',
                     exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_shipping_snapshot_shape' and c.convalidated)
                     and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_total_consistent' and c.convalidated)
                     and (select pg_catalog.count(*) from public.orders o where o.installation_requested and o.shipping_piastres = 0 and o.shipping_method is null) >= 1,
                     null);
end
$fs$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       case when (select pg_catalog.count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select pg_catalog.count(*) from pg_temp.zt_results where outcome = 'pass') = 23 then 'PASS' else 'FAIL' end as verdict,
       (select pg_catalog.count(*) from pg_temp.zt_results where outcome = 'pass')::integer as passed,
       (select pg_catalog.count(*) from pg_temp.zt_results where outcome = 'fail')::integer as failed
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
