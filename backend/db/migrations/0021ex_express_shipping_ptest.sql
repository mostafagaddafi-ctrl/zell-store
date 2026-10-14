-- EXPRESS-SHIPPING W1 — اختبار قبل التطبيق (smoke على Production) لـ 0021ex_express_shipping.sql
--
-- • قبل التطبيق بس (الجدول أو التوقيع الجديد أو الأعمدة موجودين = ZELL_0021EX_PTEST_PRE_APPLY_ONLY).
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • zell_create_order قديم = جديد على نفس المدخلات: النداءات القديمة قبل الجسم (كل نداء في subtransaction بيترجع)،
--   والجديدة بعده من غير المعامل ومعاه 'standard'. على Production نداءات الرفض بس (قبل أي إدخال، فمفيش لمس لتسلسل
--   الطلبات)، والطلب الصالح قديم/جديد في profile ci بس (T07، زي O00 في P1). الحالات الكبيرة في CI (0021ex_flows.sql).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. ⚠ ALTER TABLE orders بياخد قفل ACCESS EXCLUSIVE على orders لحد آخر
--   المعاملة (rollback)، فأي طلب جديد بيستنى طول مدة الـ ptest — وقت هادي بس، وبموافقة منفصلة.
-- • المتوقع: production = PASS بـ 7 نجاح و 1 skip (T07) و 0 فشل · ci = PASS بـ 8 نجاح.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local zell.ptest_profile = 'production';
set local zell.approved_by = 'ptest-0021ex';

do $zguard$
begin
  if pg_catalog.current_setting('zell.ptest_profile', true) is null
     or pg_catalog.current_setting('zell.ptest_profile', true) not in ('production', 'ci') then
    raise exception 'ZELL_0021EX_PTEST_PROFILE';
  end if;
  if pg_catalog.to_regclass('public.zell_shipping_options') is not null
     or pg_catalog.to_regclass('public.zell_shipping_options_log') is not null
     or pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)') is not null
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname = 'shipping_method') then
    raise exception 'ZELL_0021EX_PTEST_PRE_APPLY_ONLY';
  end if;
  perform pg_catalog.set_config('zell.ptest_co_md5',
    coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.oid) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), ''), true);
  perform pg_catalog.set_config('zell.ptest_co_acl',
    coalesce((select pg_catalog.array_agg(x::text order by x::text)::text
                from pg_catalog.pg_proc p, pg_catalog.unnest(p.proacl) x
               where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)')), ''), true);
  perform pg_catalog.set_config('zell.ptest_orders', (select count(*) from public.orders)::text, true);
  perform pg_catalog.set_config('zell.ptest_fee_md5',
    coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
               where p.oid = pg_catalog.to_regprocedure('public.zell_payment_order_fee(integer, integer, boolean, boolean)')), ''), true);
  perform pg_catalog.set_config('zell.ptest_track_md5',
    coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
               where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')), ''), true);
  -- محافظة متخدّمة (في shipping_rates ومش موقوفة) لنداء السريع المرفوض.
  perform pg_catalog.set_config('zell.ptest_gov',
    coalesce((select r.k
                from (select case when pg_catalog.jsonb_typeof(s.value) = 'object' then s.value else '{}'::jsonb end as v
                        from public.settings s where s.key = 'shipping_rates') s0,
                     pg_catalog.jsonb_object_keys(s0.v) r(k)
               where not coalesce((select d.value ? r.k from public.settings d where d.key = 'shipping_disabled_governorates'), false)
               order by r.k limit 1), ''), true);
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zt_calls (id text primary key, sql_old text, sql_new text, old_res text, new_res text, std_res text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_skip(p_name text, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, 'skip', left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.call_as(p_role text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    execute 'set local role ' || pg_catalog.quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return 'ERR ' || v_state;
  end;
  return coalesce(r, 'null');
end
$f$;

-- نداء zell_create_order في subtransaction بيترجع دايمًا: OK + الرد (من غير الرقم والصلاحية) + الصف (من غير أعمدة اللقطة
-- الجديدة) + السطور، أو ERR + الكود + الرسالة.
create function pg_temp.co_try(p_sql text)
returns text language plpgsql as $f$
declare
  r jsonb;
  v text;
begin
  begin
    execute p_sql into r;
    v := 'OK ' || (r - 'order_number' - 'receipt_expires_at')::text
         || ' ROW ' || coalesce((select (to_jsonb(o) - 'id' - 'order_number' - 'created_at' - 'updated_at' - 'receipt_expires_at'
                                         - 'shipping_method' - 'shipping_days_min' - 'shipping_days_max')::text
                                   from public.orders o where o.order_number = r ->> 'order_number'), 'none')
         || ' ITEMS ' || (select coalesce(jsonb_agg(to_jsonb(i) - 'id' - 'order_id' - 'created_at' order by i.id), '[]'::jsonb)::text
                            from public.order_items i join public.orders o on o.id = i.order_id
                           where o.order_number = r ->> 'order_number')
         || ' SNAP ' || coalesce((select to_jsonb(o) ->> 'shipping_method' || '/' || coalesce(to_jsonb(o) ->> 'shipping_days_min', '-')
                                         || '/' || coalesce(to_jsonb(o) ->> 'shipping_days_max', '-')
                                    from public.orders o where o.order_number = r ->> 'order_number'), 'none');
    raise exception using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then null;
    when others then v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  return v;
end
$f$;

-- النداء بالأسماء (زي /api/orders). p_over: معاملات بتتبدّل (jsonb اسم → قيمة نصية أو null)، و p_method: NULL = من غير المعامل.
create function pg_temp.co_sql(p_case text, p_over jsonb, p_method text)
returns text language plpgsql as $f$
declare
  v jsonb := pg_catalog.jsonb_build_object(
    'p_items', '[{"productId":1,"lengthCm":300}]',
    'p_customer_name', 'عميل اختبار',
    'p_customer_phone', '01000000001',
    'p_governorate', pg_catalog.current_setting('zell.ptest_gov'),
    'p_address', 'عنوان اختبار طويل كفاية',
    'p_notes', null,
    'p_idempotency_key', 'ptest-0021ex-' || p_case || '-00000000',
    'p_request_hash', repeat('a', 64),
    'p_checkout_session_hash', repeat('b', 64),
    'p_receipt_token_hash', repeat('c', 64)) || coalesce(p_over, '{}'::jsonb);
  k text;
  s text := '';
begin
  for k in select x from pg_catalog.jsonb_object_keys(v) x order by x loop
    s := s || case when s = '' then '' else ', ' end || k || ' => '
         || case when v ->> k is null then 'null'
                 when k in ('p_items', 'p_preferred_delivery') then pg_catalog.quote_literal(v ->> k) || '::jsonb'
                 when k = 'p_installation' then pg_catalog.quote_literal(v ->> k) || '::boolean'
                 else pg_catalog.quote_literal(v ->> k) || '::text' end;
  end loop;
  if p_method is not null then
    s := s || ', p_shipping_method => ' || pg_catalog.quote_literal(p_method) || '::text';
  end if;
  return 'select public.zell_create_order(' || s || ')';
end
$f$;

-- حالات الرفض (كلها قبل أي إدخال، ومن غير قراية منتجات): الموبايل · الاسم · السلة · المحافظة · المنطقة · الفني · الهاش ·
-- الموعد المفضّل. + طلب صالح (ci بس).
insert into pg_temp.zt_calls (id, sql_old)
select c.id, pg_temp.co_sql(c.id, c.over, null)
  from (values
    ('R1', '{"p_customer_phone": "12345"}'::jsonb),
    ('R2', '{"p_customer_name": "ab"}'),
    ('R3', '{"p_items": "{}"}'),
    ('R4', '{"p_items": "[]"}'),
    ('R5', '{"p_governorate": "ZZZ_NOT_A_GOVERNORATE"}'),
    ('R6', '{"p_area": "ممممممممممممممممممممممممممممممممممممممممم"}'),
    ('R7', '{"p_items": "[{\"productId\":1,\"quantity\":1}]", "p_installation": "true"}'),
    ('R8', '{"p_request_hash": "x"}'),
    ('R9', '{"p_preferred_delivery": "{\"date\": \"bad\"}"}'),
    ('V1', '{}')) c(id, over);

-- القديم (قبل الجسم).
do $zold$
declare
  r record;
begin
  for r in select c.id, c.sql_old from pg_temp.zt_calls c
            where c.id like 'R%' or pg_catalog.current_setting('zell.ptest_profile') = 'ci' loop
    update pg_temp.zt_calls set old_res = pg_temp.co_try(r.sql_old) where id = r.id;
  end loop;
end
$zold$;

-- >>> 0021EX BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · D · P1 · P2 · D2 · TR) · مش متطبّق قبل كده · zell_create_order زي
--     قراءة R1 بالحرف (دالة واحدة · 14 معامل · البصمة · المالك postgres · security definer · search_path فاضي) · الكودين
--     45431 و 45432 مش مستخدمين في أي دالة. صلاحيات zell_create_order بتتحفظ في zell.ex_co_acl وبترجع بالظبط في (5).
do $expre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_co oid;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021EX_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021EX_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()') is null
     or pg_catalog.to_regprocedure('public.zell_payment_order_fee(integer, integer, boolean, boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is null
     or pg_catalog.to_regclass('public.zell_delivery_settings') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4 then
    raise exception 'ZELL_0021EX_PREREQ_MISSING';
  end if;
  if pg_catalog.to_regclass('public.zell_shipping_options') is not null
     or pg_catalog.to_regclass('public.zell_shipping_options_log') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_shipping\_%')
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                   and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max'))
     or exists (select 1 from pg_catalog.pg_constraint c
                 where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_shipping_snapshot_shape') then
    raise exception 'ZELL_0021EX_ALREADY_APPLIED';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1 then
    raise exception 'ZELL_0021EX_CREATE_ORDER_OVERLOADS';
  end if;
  v_co := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)');
  if v_co is null then
    raise exception 'ZELL_0021EX_CREATE_ORDER_SIGNATURE';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.oid = v_co
                and (pg_catalog.md5(p.prosrc) <> '811d4d573d750db9c7e5164799536aa6' or not p.prosecdef
                     or p.proconfig is distinct from array['search_path=""'] or p.proacl is null)) then
    raise exception 'ZELL_0021EX_CREATE_ORDER_DRIFT';
  end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_co) <> 'postgres' then
    raise exception 'ZELL_0021EX_CREATE_ORDER_OWNER';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.prosrc like '%45431%' or p.prosrc like '%45432%') then
    raise exception 'ZELL_0021EX_CODE_TAKEN';
  end if;
  perform pg_catalog.set_config('zell.ex_co_acl', (select p.proacl::text from pg_catalog.pg_proc p where p.oid = v_co), true);
end
$expre$;

-- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و authenticated و service_role.
--     القيم وقت التطبيق: السريع مقفول ومفيش إعداد محافظات (العقد §٢-١) = السلوك الحالي بالحرف.
create table public.zell_shipping_options (
  id              boolean not null default true constraint zell_shipping_options_pkey primary key
                  constraint zell_shipping_options_single check (id),
  express_enabled boolean not null,
  governorates    jsonb not null,
  updated_at      timestamptz not null default pg_catalog.now(),
  updated_by      uuid,
  constraint zell_shipping_options_governorates_object check (pg_catalog.jsonb_typeof(governorates) = 'object')
);
insert into public.zell_shipping_options (id, express_enabled, governorates) values (true, false, '{}'::jsonb);

create table public.zell_shipping_options_log (
  id         bigint generated always as identity constraint zell_shipping_options_log_pkey primary key,
  actor      uuid not null,
  old_value  jsonb not null,
  new_value  jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);

revoke all on table public.zell_shipping_options, public.zell_shipping_options_log
  from public, anon, authenticated, service_role;
revoke all on sequence public.zell_shipping_options_log_id_seq from public, anon, authenticated, service_role;
grant select, update on table public.zell_shipping_options to zell_order_definer;
grant select, insert on table public.zell_shipping_options_log to zell_order_definer;
alter table public.zell_shipping_options enable row level security;
alter table public.zell_shipping_options_log enable row level security;
create policy zell_order_definer_all on public.zell_shipping_options
  for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_shipping_options_log
  for all to zell_order_definer using (true) with check (true);

-- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة الـ trigger مالكها
--     postgres (invoker). نفس كود A1 للسجل (45413).
create function public.zell_shipping_options_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_SHIPPING_OPTIONS_APPEND_ONLY' using errcode = '45413';
end
$fn$;
revoke all on function public.zell_shipping_options_trg_append_only() from public, anon, authenticated, service_role;

create trigger zell_shipping_options_log_immutable before update or delete on public.zell_shipping_options_log
  for each row execute function public.zell_shipping_options_trg_append_only();
create trigger zell_shipping_options_log_no_truncate before truncate on public.zell_shipping_options_log
  for each statement execute function public.zell_shipping_options_trg_append_only();
create trigger zell_shipping_options_no_delete before delete on public.zell_shipping_options
  for each row execute function public.zell_shipping_options_trg_append_only();
create trigger zell_shipping_options_no_truncate before truncate on public.zell_shipping_options
  for each statement execute function public.zell_shipping_options_trg_append_only();

-- (3) orders: لقطة الطريقة والمدة (العقد §٢-٣). nullable ومن غير default، فالصفوف الموجودة ماتتكتبش (NULL = قبل الميزة).
--     القيد: الطريقة NULL أو standard أو express · المدة الاتنين NULL أو 0 ≤ min ≤ max ≤ 60 · مدة من غير طريقة لأ ·
--     express يستلزم مدة. السعر = shipping_piastres الموجود.
alter table public.orders
  add column shipping_method text,
  add column shipping_days_min integer,
  add column shipping_days_max integer,
  add constraint orders_shipping_snapshot_shape check (
    coalesce(shipping_method in ('standard', 'express'), true)
    and ((shipping_days_min is null and shipping_days_max is null)
         or (shipping_days_min is not null and shipping_days_max is not null
             and shipping_days_min >= 0 and shipping_days_min <= shipping_days_max and shipping_days_max <= 60))
    and (shipping_method is not null or shipping_days_min is null)
    and (coalesce(shipping_method, '') <> 'express' or shipping_days_min is not null));

-- (4) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و zell_payment_* و
--     zell_checkout_* (العقد §٢-٢).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

-- قراية الإعداد للوحة: أي أدمن شغّال (zell_order_actor(false)).
create function public.zell_shipping_options_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return (
    select pg_catalog.jsonb_build_object(
             'express_enabled', o.express_enabled,
             'governorates', o.governorates,
             'updated_at', o.updated_at)
      from public.zell_shipping_options o where o.id);
end
$fn$;

-- الحفظ: المالك بس (45402 من zell_order_actor). النسخة (45404) قبل التحقق (45432: الحقل في detail، والمحافظة في hint).
-- لكل محافظة: الاسم NFC + trim (1..40، ومن غير تكرار بعد التطبيع) · المفاتيح الست بس (الناقص = null) · المدة الاتنين null
-- أو أعداد صحيحة 0 ≤ min ≤ max ≤ 60 · express_enabled boolean · السعر null أو 1..100,000,000 قرش · السريع المتاح يستلزم
-- سعر ومدة. الإعداد بيتخزّن مطبّع بالمفاتيح الست. الحفظ من غير تغيير مابيكتبش سطر ولا بيغيّر النسخة.
create function public.zell_shipping_options_save(p_expected_updated_at timestamptz, p_express_enabled boolean,
                                                  p_governorates jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_row public.zell_shipping_options;
  v_govs jsonb := '{}'::jsonb;
  v_key text;
  v_cfg jsonb;
  v_name text;
  v_smin integer;
  v_smax integer;
  v_on boolean;
  v_price integer;
  v_emin integer;
  v_emax integer;
  v_old jsonb;
  v_new jsonb;
  v_changed boolean;
begin
  select o.* into v_row from public.zell_shipping_options o where o.id for update;
  if not found or p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_row.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_express_enabled is null then
    raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_enabled';
  end if;
  if p_governorates is null or pg_catalog.jsonb_typeof(p_governorates) <> 'object' then
    raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'governorates';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(p_governorates)) > 60 then
    raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'governorates';
  end if;
  for v_key, v_cfg in select e.key, e.value from pg_catalog.jsonb_each(p_governorates) e order by e.key loop
    v_name := pg_catalog.btrim(pg_catalog.normalize(v_key, 'NFC'), E' \t\r\n');
    if v_name = '' or pg_catalog.char_length(v_name) > 40 or v_govs ? v_name then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'governorate_name', hint = v_name;
    end if;
    if pg_catalog.jsonb_typeof(v_cfg) is distinct from 'object' then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'governorate_shape', hint = v_name;
    end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_cfg) k
                where k not in ('standard_days_min', 'standard_days_max', 'express_enabled',
                                'express_price_piastres', 'express_days_min', 'express_days_max')) then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'governorate_shape', hint = v_name;
    end if;
    v_smin := null;
    v_smax := null;
    if coalesce(pg_catalog.jsonb_typeof(v_cfg -> 'standard_days_min'), 'null') <> 'null'
       or coalesce(pg_catalog.jsonb_typeof(v_cfg -> 'standard_days_max'), 'null') <> 'null' then
      if pg_catalog.jsonb_typeof(v_cfg -> 'standard_days_min') is distinct from 'number'
         or pg_catalog.jsonb_typeof(v_cfg -> 'standard_days_max') is distinct from 'number'
         or (v_cfg ->> 'standard_days_min') !~ '^[0-9]{1,2}$'
         or (v_cfg ->> 'standard_days_max') !~ '^[0-9]{1,2}$' then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'standard_days', hint = v_name;
      end if;
      v_smin := (v_cfg ->> 'standard_days_min')::integer;
      v_smax := (v_cfg ->> 'standard_days_max')::integer;
      if v_smin > v_smax or v_smax > 60 then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'standard_days', hint = v_name;
      end if;
    end if;
    if pg_catalog.jsonb_typeof(v_cfg -> 'express_enabled') is distinct from 'boolean' then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_enabled', hint = v_name;
    end if;
    v_on := (v_cfg -> 'express_enabled') = 'true'::jsonb;
    v_price := null;
    if coalesce(pg_catalog.jsonb_typeof(v_cfg -> 'express_price_piastres'), 'null') <> 'null' then
      if pg_catalog.jsonb_typeof(v_cfg -> 'express_price_piastres') <> 'number'
         or (v_cfg ->> 'express_price_piastres') !~ '^[1-9][0-9]{0,8}$' then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_price', hint = v_name;
      end if;
      v_price := (v_cfg ->> 'express_price_piastres')::integer;
      if v_price > 100000000 then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_price', hint = v_name;
      end if;
    end if;
    v_emin := null;
    v_emax := null;
    if coalesce(pg_catalog.jsonb_typeof(v_cfg -> 'express_days_min'), 'null') <> 'null'
       or coalesce(pg_catalog.jsonb_typeof(v_cfg -> 'express_days_max'), 'null') <> 'null' then
      if pg_catalog.jsonb_typeof(v_cfg -> 'express_days_min') is distinct from 'number'
         or pg_catalog.jsonb_typeof(v_cfg -> 'express_days_max') is distinct from 'number'
         or (v_cfg ->> 'express_days_min') !~ '^[0-9]{1,2}$'
         or (v_cfg ->> 'express_days_max') !~ '^[0-9]{1,2}$' then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_days', hint = v_name;
      end if;
      v_emin := (v_cfg ->> 'express_days_min')::integer;
      v_emax := (v_cfg ->> 'express_days_max')::integer;
      if v_emin > v_emax or v_emax > 60 then
        raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_days', hint = v_name;
      end if;
    end if;
    if v_on and v_price is null then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_price', hint = v_name;
    end if;
    if v_on and v_emin is null then
      raise exception 'ZELL_SHIPPING_OPTIONS_INVALID' using errcode = '45432', detail = 'express_days', hint = v_name;
    end if;
    v_govs := v_govs || pg_catalog.jsonb_build_object(v_name, pg_catalog.jsonb_build_object(
                'standard_days_min', v_smin, 'standard_days_max', v_smax, 'express_enabled', v_on,
                'express_price_piastres', v_price, 'express_days_min', v_emin, 'express_days_max', v_emax));
  end loop;
  v_old := pg_catalog.jsonb_build_object('express_enabled', v_row.express_enabled, 'governorates', v_row.governorates);
  v_new := pg_catalog.jsonb_build_object('express_enabled', p_express_enabled, 'governorates', v_govs);
  v_changed := v_new is distinct from v_old;
  if v_changed then
    update public.zell_shipping_options o
       set express_enabled = p_express_enabled,
           governorates = v_govs,
           updated_at = pg_catalog.now(),
           updated_by = v_actor
     where o.id
    returning o.* into v_row;
    insert into public.zell_shipping_options_log (actor, old_value, new_value) values (v_actor, v_old, v_new);
  end if;
  return pg_catalog.jsonb_build_object(
           'express_enabled', v_row.express_enabled,
           'governorates', v_row.governorates,
           'updated_at', v_row.updated_at,
           'changed', v_changed);
end
$fn$;

-- قراية الإعداد للمتجر (Checkout): service_role بس، زي zell_checkout_delivery_settings. الحقول اللي العميل محتاجها بس.
create function public.zell_shipping_options_checkout()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object('express_enabled', o.express_enabled, 'governorates', o.governorates)
    from public.zell_shipping_options o where o.id
$fn$;

revoke all on function public.zell_shipping_options_get(),
  public.zell_shipping_options_save(timestamptz, boolean, jsonb),
  public.zell_shipping_options_checkout()
  from public, anon, authenticated, service_role;
grant execute on function public.zell_shipping_options_get(),
  public.zell_shipping_options_save(timestamptz, boolean, jsonb) to authenticated;
grant execute on function public.zell_shipping_options_checkout() to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (5) zell_create_order: 14 ← 15 (العقد §٢-٣). القديمة بتتشال (مفيش overload — PGRST203)، والجديدة = جسم P1 بالحرف + 5
--     تعديلات (التعريفات · فحص الطريقة بعد الـ replay · الإعداد بعد الحد المجاني · عمودين في الإدخال). المالك postgres
--     (من الـ preflight)، والصلاحيات بترجع زي zell.ex_co_acl بالظبط (اللي اتعمل تلقائي وقت الإنشاء بيتسحب الأول).
drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb);

CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text, p_preferred_delivery jsonb DEFAULT NULL::jsonb, p_shipping_method text DEFAULT NULL::text)
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
  -- EXPRESS-SHIPPING: طريقة الشحن ولقطة المدة
  v_method       text;
  v_ship_express boolean;
  v_ship_govs    jsonb;
  v_gov_cfg      jsonb;
  v_days_min     integer;
  v_days_max     integer;
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

  -- EXPRESS-SHIPPING: طريقة الشحن (اختيارية). NULL أو standard = عادي (النداء القديم بالحرف)، express = سريع، وأي قيمة
  --   تانية = 45432 قبل أي إدخال. الإتاحة والسعر في (و) بعد فحص المحافظة. الـ replay فوق (د) مابيتأثرش.
  v_method := coalesce(p_shipping_method, 'standard');
  if v_method not in ('standard', 'express') then
    raise exception 'ZELL_SHIPPING_METHOD_INVALID' using errcode = '45432', detail = 'shipping_method';
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

  -- EXPRESS-SHIPPING: الإعداد من zell_shipping_options (صف واحد). السريع = المفتاح العام + المحافظة متاحة بسعر ومدة
  --   صالحين، وإلا 45431 قبل أي إدخال، والشحن = سعر السريع الكامل دايمًا (v_threshold = 0: مفيش حد مجاني).
  --   العادي = نفس الحساب بالحرف، والمدة الاختيارية لقطة بس (شكل غلط = NULL، ومابترفضش أبدًا).
  select o.express_enabled, o.governorates into v_ship_express, v_ship_govs
    from public.zell_shipping_options o where o.id;
  if pg_catalog.jsonb_typeof(v_ship_govs) = 'object' then
    v_gov_cfg := v_ship_govs -> p_governorate;
  end if;
  if pg_catalog.jsonb_typeof(v_gov_cfg) is distinct from 'object' then
    v_gov_cfg := null;
  end if;
  if v_method = 'express' then
    if not coalesce(v_ship_express, false) or v_gov_cfg is null
       or (v_gov_cfg -> 'express_enabled') is distinct from 'true'::jsonb
       or pg_catalog.jsonb_typeof(v_gov_cfg -> 'express_price_piastres') is distinct from 'number'
       or pg_catalog.jsonb_typeof(v_gov_cfg -> 'express_days_min') is distinct from 'number'
       or pg_catalog.jsonb_typeof(v_gov_cfg -> 'express_days_max') is distinct from 'number'
       or (v_gov_cfg ->> 'express_price_piastres') !~ '^[1-9][0-9]{0,8}$'
       or (v_gov_cfg ->> 'express_days_min') !~ '^[0-9]{1,2}$'
       or (v_gov_cfg ->> 'express_days_max') !~ '^[0-9]{1,2}$' then
      raise exception 'ZELL_SHIPPING_EXPRESS_UNAVAILABLE' using errcode = '45431';
    end if;
    v_base := (v_gov_cfg ->> 'express_price_piastres')::integer;
    v_days_min := (v_gov_cfg ->> 'express_days_min')::integer;
    v_days_max := (v_gov_cfg ->> 'express_days_max')::integer;
    if v_base > 100000000 or v_days_min > v_days_max or v_days_max > 60 then
      raise exception 'ZELL_SHIPPING_EXPRESS_UNAVAILABLE' using errcode = '45431';
    end if;
    v_threshold := 0;
  elsif pg_catalog.jsonb_typeof(v_gov_cfg -> 'standard_days_min') = 'number'
        and pg_catalog.jsonb_typeof(v_gov_cfg -> 'standard_days_max') = 'number'
        and (v_gov_cfg ->> 'standard_days_min') ~ '^[0-9]{1,2}$'
        and (v_gov_cfg ->> 'standard_days_max') ~ '^[0-9]{1,2}$' then
    v_days_min := (v_gov_cfg ->> 'standard_days_min')::integer;
    v_days_max := (v_gov_cfg ->> 'standard_days_max')::integer;
    if v_days_min > v_days_max or v_days_max > 60 then
      v_days_min := null;
      v_days_max := null;
    end if;
  end if;

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
               i.has_mtm,
               case when v_install
                    then pg_catalog.round((v_rate::numeric * i.cm) / 100.0)
                    else 0::numeric end as inst_fee,
               case when v_install then v_travel::numeric else 0::numeric end as travel
        from ship s
        cross join (
          select coalesce(pg_catalog.sum(pr.length_cm) filter (where pr.sale_unit = 'meter'), 0)::numeric as cm,
          coalesce(pg_catalog.bool_or(pr.sale_unit = 'meter'), false) as has_mtm
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
          preferred_delivery_date, preferred_delivery_period, preferred_delivery_note,
          -- 0021-A P1: لقطة رسوم التأكيد (دفعة مقدمة من نفس الإجمالي، مش خصم)
          confirmation_fee_piastres,
          -- EXPRESS-SHIPPING: لقطة طريقة الشحن ومدتها (السعر = shipping_piastres)
          shipping_method, shipping_days_min, shipping_days_max
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
          v_pref_date, v_pref_period, v_pref_note,
          public.zell_payment_order_fee((s.subtotal - s.discount + s.shipping + s.inst_fee + s.travel)::integer,
                                        s.shipping::integer, s.has_mtm, v_install),
          v_method, v_days_min, v_days_max
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
$function$;

do $exacl$
declare
  v_fn oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)');
  v_owner oid;
  r record;
begin
  select p.proowner into v_owner from pg_catalog.pg_proc p where p.oid = v_fn;
  for r in select distinct a.grantee
             from pg_catalog.pg_proc p, pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            where p.oid = v_fn and a.grantee <> v_owner loop
    execute 'revoke all on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text) from '
            || case when r.grantee = 0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(r.grantee)) end;
  end loop;
  for r in select a.grantee, a.is_grantable
             from pg_catalog.aclexplode(pg_catalog.current_setting('zell.ex_co_acl')::aclitem[]) a
            where a.privilege_type = 'EXECUTE' and a.grantee <> v_owner
            order by a.grantee loop
    execute 'grant execute on function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text) to '
            || case when r.grantee = 0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(r.grantee)) end
            || case when r.is_grantable then ' with grant option' else '' end;
  end loop;
end
$exacl$;

-- (6) postflight
do $expost$
declare
  v_get oid := pg_catalog.to_regprocedure('public.zell_shipping_options_get()');
  v_save oid := pg_catalog.to_regprocedure('public.zell_shipping_options_save(timestamptz, boolean, jsonb)');
  v_chk oid := pg_catalog.to_regprocedure('public.zell_shipping_options_checkout()');
  v_co oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)');
begin
  if v_get is null or v_save is null or v_chk is null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid in (v_get, v_save, v_chk)
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.proconfig is distinct from array['search_path=""']))
     or not pg_catalog.has_function_privilege('authenticated', v_get, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_save, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_chk, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_chk, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_get, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_save, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_get, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_save, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_chk, 'EXECUTE')
     or exists (select 1
                  from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                       (values ('public.zell_shipping_options'), ('public.zell_shipping_options_log')) t(n)
                 where pg_catalog.has_table_privilege(r.n, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n)
                 where pg_catalog.has_sequence_privilege(r.n, 'public.zell_shipping_options_log_id_seq', 'USAGE,SELECT,UPDATE'))
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0021EX_POST_FUNCTIONS';
  end if;
  if (select count(*) from public.zell_shipping_options) <> 1
     or not exists (select 1 from public.zell_shipping_options o
                     where o.id and not o.express_enabled and o.governorates = '{}'::jsonb and o.updated_by is null)
     or (select count(*) from public.zell_shipping_options_log) <> 0
     or (select count(*) from pg_catalog.pg_trigger g
          where g.tgrelid in ('public.zell_shipping_options'::regclass, 'public.zell_shipping_options_log'::regclass)
            and not g.tgisinternal and g.tgenabled = 'O') <> 4
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
          where p.oid = pg_catalog.to_regprocedure('public.zell_shipping_options_trg_append_only()')) is distinct from 'postgres' then
    raise exception 'ZELL_0021EX_POST_TABLES';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = 'public.orders'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
         and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max')) <> 3
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_shipping_snapshot_shape' and c.convalidated)
     or exists (select 1 from public.orders o
                 where o.shipping_method is not null or o.shipping_days_min is not null or o.shipping_days_max is not null) then
    raise exception 'ZELL_0021EX_POST_ORDERS';
  end if;
  if v_co is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_co
                   and (pg_catalog.md5(p.prosrc) <> '62924d0fe9b1563e76c54bbddfb628b4'
                        or pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' or not p.prosecdef
                        or p.proconfig is distinct from array['search_path=""']))
     or (select pg_catalog.array_agg(x::text order by x::text)
           from pg_catalog.unnest((select p.proacl from pg_catalog.pg_proc p where p.oid = v_co)) x)
        is distinct from
        (select pg_catalog.array_agg(x::text order by x::text)
           from pg_catalog.unnest(pg_catalog.current_setting('zell.ex_co_acl')::aclitem[]) x)
     or not pg_catalog.has_function_privilege('service_role', v_co, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_co, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_co, 'EXECUTE')
     or not pg_catalog.has_function_privilege('postgres', 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')
     or not pg_catalog.has_table_privilege('postgres', 'public.zell_shipping_options', 'SELECT') then
    raise exception 'ZELL_0021EX_POST_CREATE_ORDER';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4
     or coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                   where p.prosrc like '%45431%'), '') <> 'zell_create_order'
     or coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                   where p.prosrc like '%45432%'), '') <> 'zell_create_order,zell_shipping_options_save' then
    raise exception 'ZELL_0021EX_POST_OTHERS';
  end if;
end
$expost$;
-- <<< 0021EX BODY

do $zT$
declare
  v_get oid := pg_catalog.to_regprocedure('public.zell_shipping_options_get()');
  v_save oid := pg_catalog.to_regprocedure('public.zell_shipping_options_save(timestamptz, boolean, jsonb)');
  v_chk oid := pg_catalog.to_regprocedure('public.zell_shipping_options_checkout()');
  v_co oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)');
  v_res text;
  v_n1 text;
  v_n2 text;
  v_n3 text;
  r record;
begin
  perform pg_temp.zt('T01 tables: options + log (owner postgres, RLS, one policy each for zell_order_definer), row = express off + {}, log empty, 4 guards',
    (select count(*) from pg_catalog.pg_class c
      where c.oid in (pg_catalog.to_regclass('public.zell_shipping_options'), pg_catalog.to_regclass('public.zell_shipping_options_log'))
        and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') = 2
    and (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename in ('zell_shipping_options', 'zell_shipping_options_log')
            and p.roles = array['zell_order_definer']::name[]) = 2
    and (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename in ('zell_shipping_options', 'zell_shipping_options_log')) = 2
    and (select count(*) from public.zell_shipping_options o where o.id and not o.express_enabled and o.governorates = '{}'::jsonb) = 1
    and (select count(*) from public.zell_shipping_options) = 1
    and (select count(*) from public.zell_shipping_options_log) = 0
    and (select count(*) from pg_catalog.pg_trigger g
          where g.tgrelid in (pg_catalog.to_regclass('public.zell_shipping_options'), pg_catalog.to_regclass('public.zell_shipping_options_log'))
            and not g.tgisinternal and g.tgenabled = 'O') = 4, null);
  perform pg_temp.zt('T02 functions: 3 owned by zell_order_definer (security definer, search_path empty) · get/save authenticated only · checkout service_role only · no table access',
    (select count(*) from pg_catalog.pg_proc p
      where p.oid in (v_get, v_save, v_chk) and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer'
        and p.prosecdef and p.proconfig = array['search_path=""']) = 3
    and pg_catalog.has_function_privilege('authenticated', v_get, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_chk, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', v_chk, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_get, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_get, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_chk, 'EXECUTE')
    and not exists (select 1
                      from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                           (values ('public.zell_shipping_options'), ('public.zell_shipping_options_log')) t(n)
                     where pg_catalog.has_table_privilege(r.n, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'), null);
  v_res := pg_temp.call_as('service_role', 'select public.zell_shipping_options_checkout()::text');
  perform pg_temp.zt('T03 identity live: get / save without a session -> 45400 · service_role checkout read = express off, {}',
    pg_temp.call_as('authenticated', 'select public.zell_shipping_options_get()::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', 'select public.zell_shipping_options_save(now(), true, ' || pg_catalog.quote_literal('{}') || '::jsonb)::text') = 'ERR 45400'
    and v_res not like 'ERR%' and v_res <> 'null'
    and v_res::jsonb = '{"express_enabled": false, "governorates": {}}'::jsonb
    and (select count(*) from public.zell_shipping_options_log) = 0, v_res);
  perform pg_temp.zt('T04 zell_create_order: one, 15 args, new body (md5), owner postgres, security definer, search_path empty, EXECUTE grants = before',
    pg_catalog.current_setting('zell.ptest_co_md5') = '811d4d573d750db9c7e5164799536aa6'
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') = 1
    and coalesce((select pg_catalog.md5(p.prosrc) = '62924d0fe9b1563e76c54bbddfb628b4' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                         and p.prosecdef and p.proconfig = array['search_path=""']
                    from pg_catalog.pg_proc p where p.oid = v_co), false)
    and coalesce((select pg_catalog.array_agg(x::text order by x::text)::text
                    from pg_catalog.pg_proc p, pg_catalog.unnest(p.proacl) x where p.oid = v_co), '')
        = pg_catalog.current_setting('zell.ptest_co_acl')
    and pg_catalog.current_setting('zell.ptest_co_acl') <> ''
    and pg_catalog.has_function_privilege('service_role', v_co, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_co, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_co, 'EXECUTE'),
    pg_catalog.current_setting('zell.ptest_co_md5') || ' acl=' || pg_catalog.current_setting('zell.ptest_co_acl'));
  perform pg_temp.zt('T05 orders: 3 snapshot columns (nullable, no default) + shape check, existing rows untouched',
    (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'public.orders'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
        and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max')) = 3
    and exists (select 1 from pg_catalog.pg_constraint c
                 where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_shipping_snapshot_shape' and c.convalidated)
    and (select count(*) from public.orders)::text = pg_catalog.current_setting('zell.ptest_orders')
    and not exists (select 1 from public.orders o
                     where o.shipping_method is not null or o.shipping_days_min is not null or o.shipping_days_max is not null), null);

  -- الجديد: من غير المعامل ومعاه 'standard'.
  for r in select c.id, c.sql_old from pg_temp.zt_calls c
            where c.id like 'R%' or pg_catalog.current_setting('zell.ptest_profile') = 'ci' loop
    update pg_temp.zt_calls
       set new_res = pg_temp.co_try(r.sql_old),
           std_res = pg_temp.co_try(pg_catalog.left(r.sql_old, pg_catalog.length(r.sql_old) - 1) || ', p_shipping_method => ''standard''::text)')
     where id = r.id;
  end loop;
  v_n1 := pg_temp.co_try(pg_temp.co_sql('N1', '{}'::jsonb, 'EXPRESS'));
  v_n2 := pg_temp.co_try(pg_temp.co_sql('N2', '{}'::jsonb, ''));
  v_n3 := pg_temp.co_try(pg_temp.co_sql('N3', '{}'::jsonb, 'express'));
  perform pg_temp.zt('T06 rejections old = new (no param) = new (standard) for 9 cases · bad method -> ZELL_SHIPPING_METHOD_INVALID · express while off -> ZELL_SHIPPING_EXPRESS_UNAVAILABLE',
    (select count(*) from pg_temp.zt_calls c
      where c.id like 'R%' and c.old_res like 'ERR %' and c.old_res = c.new_res and c.old_res = c.std_res) = 9
    and v_n1 like 'ERR 4543_ ZELL_SHIPPING_METHOD_INVALID' and v_n2 like 'ERR 4543_ ZELL_SHIPPING_METHOD_INVALID'
    and split_part(v_n1, ' ', 2) = '4543' || '2' and split_part(v_n3, ' ', 2) = '4543' || '1'
    and v_n3 like 'ERR 4543_ ZELL_SHIPPING_EXPRESS_UNAVAILABLE'
    and pg_catalog.current_setting('zell.ptest_gov') <> '',
    coalesce((select pg_catalog.string_agg(c.id || ':' || coalesce(c.old_res, '-') || '|' || coalesce(c.new_res, '-') || '|' || coalesce(c.std_res, '-'), ' ; ')
                from pg_temp.zt_calls c where c.id like 'R%' and (c.old_res is distinct from c.new_res or c.old_res is distinct from c.std_res
                                                                  or c.old_res not like 'ERR %')), '')
      || ' n1=' || v_n1 || ' n2=' || v_n2 || ' n3=' || v_n3);
  if pg_catalog.current_setting('zell.ptest_profile') = 'ci' then
    perform pg_temp.zt('T07 valid order: old = new (no param) = new (standard) — response, row, lines; snapshot standard, no days',
      (select c.old_res like 'OK %' and pg_catalog.split_part(c.old_res, ' SNAP ', 1) = pg_catalog.split_part(c.new_res, ' SNAP ', 1)
              and pg_catalog.split_part(c.old_res, ' SNAP ', 1) = pg_catalog.split_part(c.std_res, ' SNAP ', 1)
              and c.old_res like '% SNAP none' and c.new_res like '% SNAP standard/-/-' and c.std_res like '% SNAP standard/-/-'
         from pg_temp.zt_calls c where c.id = 'V1'),
      (select pg_catalog.left(c.old_res, 180) || ' || ' || pg_catalog.right(c.new_res, 40) from pg_temp.zt_calls c where c.id = 'V1'));
  else
    perform pg_temp.zt_skip('T07 valid order old/new (ci profile only)', 'production profile');
  end if;
  perform pg_temp.zt('T08 nothing else touched: fee + track functions, 24 zell_order_*, 24 zell_payment_*, 4 zell_checkout_*',
    coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
               where p.oid = pg_catalog.to_regprocedure('public.zell_payment_order_fee(integer, integer, boolean, boolean)')), '')
      = pg_catalog.current_setting('zell.ptest_fee_md5')
    and coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                   where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')), '')
      = pg_catalog.current_setting('zell.ptest_track_md5')
    and pg_catalog.current_setting('zell.ptest_fee_md5') <> '' and pg_catalog.current_setting('zell.ptest_track_md5') <> ''
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4, null);
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass')
                 = case pg_catalog.current_setting('zell.ptest_profile') when 'ci' then 8 else 7 end
             and coalesce((select string_agg(id, ',' order by id) from pg_temp.zt_results where outcome = 'skip'), '')
                 = case pg_catalog.current_setting('zell.ptest_profile') when 'ci' then '' else 'T07' end
            then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from pg_temp.zt_results where outcome = 'skip') as skip,
       pg_catalog.current_setting('zell.ptest_profile') as profile
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
