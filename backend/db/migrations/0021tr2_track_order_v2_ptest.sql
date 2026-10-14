-- TRACK-ORDER v2 W1 — اختبار قبل التطبيق (smoke على Production) لـ 0021tr2_track_order_v2.sql
--
-- • قبل التطبيق بس (أي جدول من الأربعة موجود، أو دالة التتبّع مش جسم TR W1 = ZELL_0021TR2_PTEST_PRE_APPLY_ONLY).
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • قبل الجسم بيتحفظ: صلاحيات zell_order_definer والـ policies على orders و order_events و order_payments · بصمة كل الدوال
--   التانية · الأعداد · رد v1 لآخر طلب (بدور service_role زي المتجر). بعد الجسم بيتقارن كل ده.
-- • على Production مفيش أي طلب بيتعمل (T09 في profile ci بس). الرد بيتقارن جوه المعاملة، والنتيجة أسماء وأعداد بس.
-- • الأثر على Production: كله جوه المعاملة وبيترجع. ⚠ الـ FK للجداول الجديدة بياخد قفل SHARE ROW EXCLUSIVE على orders لحد آخر
--   المعاملة، فأي طلب جديد أو تعديل بيستنى طول مدة الـ ptest (ثواني) — وقت هادي بس، وبموافقة منفصلة.
-- • المتوقع: production = PASS بـ 8 نجاح و 1 skip (T09) و 0 فشل · ci = PASS بـ 9 نجاح.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local zell.ptest_profile = 'production';
set local zell.approved_by = 'ptest-0021tr2';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

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

-- النداء بدور وجلسة (sub بدور authenticated، أو من غير جلسة لو NULL). النتيجة نص، أو 'ERR <sqlstate>'.
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims',
      case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
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

-- صلاحيات zell_order_definer والـ policies على الجداول التلاتة (لازم ماتتغيّرش).
create function pg_temp.privs() returns text language sql as $f$
  select (select pg_catalog.string_agg(t.n || ':' || pr.p || '=' || pg_catalog.has_table_privilege('zell_order_definer', t.n, pr.p)::text,
                                       ',' order by t.n, pr.p)
            from (values ('public.orders'), ('public.order_events'), ('public.order_payments')) t(n),
                 (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) pr(p))
         || ' | ' || (select pg_catalog.string_agg(c.relname || '.' || a.attname || ':' || pr.p, ',' order by c.relname, a.attname, pr.p)
                        from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid,
                             (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) pr(p)
                       where c.oid in ('public.orders'::regclass, 'public.order_events'::regclass, 'public.order_payments'::regclass)
                         and a.attnum > 0 and not a.attisdropped
                         and pg_catalog.has_column_privilege('zell_order_definer', c.oid, a.attnum, pr.p))
         || ' | ' || coalesce((select pg_catalog.string_agg(p.tablename || '.' || p.policyname || ':' || p.cmd || ':' || p.roles::text, ','
                                                            order by p.tablename, p.policyname)
                                 from pg_catalog.pg_policies p
                                where p.schemaname = 'public' and p.tablename in ('orders', 'order_events', 'order_payments')), '');
$f$;

-- بصمة كل الدوال التانية في public (غير دالة التتبّع والأسماء الجديدة).
create function pg_temp.fns() returns text language sql as $f$
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(p.proname || ':' || pg_catalog.md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-'),
                                                       ',' order by p.proname, p.oid), ''))
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> 'zell_checkout_track_order'
     and p.proname not like 'zell\_shipment\_%' and p.proname not like 'zell\_customer\_update\_%';
$f$;

do $zguard$
declare
  v_latest text := (select o.order_number from public.orders o order by o.id desc limit 1);
begin
  if pg_catalog.current_setting('zell.ptest_profile', true) is null
     or pg_catalog.current_setting('zell.ptest_profile', true) not in ('production', 'ci') then
    raise exception 'ZELL_0021TR2_PTEST_PROFILE';
  end if;
  if pg_catalog.to_regclass('public.zell_order_shipments') is not null
     or pg_catalog.to_regclass('public.zell_order_shipments_log') is not null
     or pg_catalog.to_regclass('public.zell_order_customer_updates') is not null
     or pg_catalog.to_regclass('public.zell_order_customer_updates_log') is not null
     or coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                   where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')), '') <> 'edd7a26279a345963c68d69425f0ea1a' then
    raise exception 'ZELL_0021TR2_PTEST_PRE_APPLY_ONLY';
  end if;
  perform pg_catalog.set_config('zell.ptest_track_oid', pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')::oid::text, true);
  perform pg_catalog.set_config('zell.ptest_track_acl',
    coalesce((select p.proacl::text from pg_catalog.pg_proc p
               where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')), ''), true);
  perform pg_catalog.set_config('zell.ptest_privs', pg_temp.privs(), true);
  perform pg_catalog.set_config('zell.ptest_fns', pg_temp.fns(), true);
  perform pg_catalog.set_config('zell.ptest_counts',
    (select count(*) from public.orders) || '/' || (select count(*) from public.order_events) || '/'
    || (select count(*) from public.order_payments) || '/' || (select count(*) from public.order_items), true);
  perform pg_catalog.set_config('zell.ptest_latest', coalesce(v_latest, ''), true);
  perform pg_catalog.set_config('zell.ptest_v1',
    case when v_latest is null then ''
         else pg_temp.call_as('service_role', null,
                pg_catalog.format('select public.zell_checkout_track_order(%L)::text', v_latest)) end, true);
end
$zguard$;

-- >>> 0021TR2 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · P1 · TR · EXPRESS) · مش متطبّق (الأسماء فاضية في أي schema) ·
--     zell_checkout_track_order = قراءة T1 بالحرف (نسخة واحدة · md5(prosrc) · md5(pg_get_functiondef) · المالك · الصلاحيات) ·
--     الكودين 45433 و 45434 مش مستخدمين في أي دالة.
do $tr2pre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_tr oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021TR2_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021TR2_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regclass('public.order_events') is null
     or pg_catalog.to_regclass('public.order_payments') is null
     or pg_catalog.to_regclass('public.zell_shipping_options') is null
     or v_tr is null
     or (select count(*) from pg_catalog.pg_attribute a
          where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
            and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max', 'paid_piastres',
                              'confirmation_fee_piastres', 'delivery_confirmed_date', 'delivery_confirmed_period')) <> 7
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4 then
    raise exception 'ZELL_0021TR2_PREREQ_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_class c
              where c.relname in ('zell_order_shipments', 'zell_order_shipments_log',
                                  'zell_order_customer_updates', 'zell_order_customer_updates_log'))
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%') then
    raise exception 'ZELL_0021TR2_ALREADY_APPLIED';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') <> 1
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_tr
                   and (pg_catalog.md5(p.prosrc) <> 'edd7a26279a345963c68d69425f0ea1a'
                        or pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) <> '6d2d323e0801fa43053984f2504ba3c4'
                        or pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
                        or p.proconfig is distinct from array['search_path=""']
                        or coalesce(p.proacl::text, '') <> '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}')) then
    raise exception 'ZELL_0021TR2_TRACK_DRIFT';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.prosrc like '%45433%' or p.prosrc like '%45434%') then
    raise exception 'ZELL_0021TR2_CODE_TAKEN';
  end if;
end
$tr2pre$;

-- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و authenticated و service_role.
--     الشحنة: صف واحد لكل طلب (order_id هو المفتاح، FK restrict). رسايل العميل: منفصلة تمامًا عن internal_notes.
--     السجلين append-only: القديم · الجديد · الممثل · الوقت. مفيش عمود في orders بيتغيّر، ومفيش صلاحية جديدة على orders أو
--     order_events أو order_payments.
create table public.zell_order_shipments (
  order_id        integer not null constraint zell_order_shipments_pkey primary key
                  constraint zell_order_shipments_order_fkey references public.orders (id) on delete restrict,
  carrier         text not null
                  constraint zell_order_shipments_carrier_check
                  check (pg_catalog.char_length(carrier) between 1 and 60 and carrier = pg_catalog.btrim(carrier)),
  tracking_number text
                  constraint zell_order_shipments_tracking_number_check
                  check (tracking_number is null
                         or (pg_catalog.char_length(tracking_number) between 1 and 60
                             and tracking_number = pg_catalog.btrim(tracking_number))),
  tracking_url    text
                  constraint zell_order_shipments_tracking_url_check
                  check (tracking_url is null
                         or (pg_catalog.char_length(tracking_url) <= 300 and pg_catalog.left(tracking_url, 8) = 'https://')),
  shipped_on      date,
  expected_on     date,
  created_at      timestamptz not null default pg_catalog.now(),
  updated_at      timestamptz not null default pg_catalog.now(),
  updated_by      uuid not null,
  constraint zell_order_shipments_dates_check check (expected_on is null or shipped_on is null or expected_on >= shipped_on)
);

create table public.zell_order_shipments_log (
  id         bigint generated always as identity constraint zell_order_shipments_log_pkey primary key,
  order_id   integer not null constraint zell_order_shipments_log_order_fkey references public.orders (id) on delete restrict,
  actor      uuid not null,
  old_value  jsonb,
  new_value  jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);
create index zell_order_shipments_log_order_idx on public.zell_order_shipments_log (order_id, id desc);

create table public.zell_order_customer_updates (
  id         bigint generated always as identity constraint zell_order_customer_updates_pkey primary key,
  order_id   integer not null constraint zell_order_customer_updates_order_fkey references public.orders (id) on delete restrict,
  text       text not null
             constraint zell_order_customer_updates_text_check
             check (pg_catalog.char_length(text) between 1 and 300 and text = pg_catalog.btrim(text, E' \t\r\n')),
  hidden     boolean not null default false,
  edited     boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid not null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid not null
);
create index zell_order_customer_updates_order_idx on public.zell_order_customer_updates (order_id, created_at desc, id desc);

create table public.zell_order_customer_updates_log (
  id         bigint generated always as identity constraint zell_order_customer_updates_log_pkey primary key,
  update_id  bigint not null
             constraint zell_order_customer_updates_log_update_fkey references public.zell_order_customer_updates (id) on delete restrict,
  order_id   integer not null constraint zell_order_customer_updates_log_order_fkey references public.orders (id) on delete restrict,
  action     text not null constraint zell_order_customer_updates_log_action_check check (action in ('add', 'edit', 'hide', 'show')),
  actor      uuid not null,
  old_value  jsonb,
  new_value  jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);
create index zell_order_customer_updates_log_update_idx on public.zell_order_customer_updates_log (update_id, id desc);

revoke all on table public.zell_order_shipments, public.zell_order_shipments_log,
  public.zell_order_customer_updates, public.zell_order_customer_updates_log
  from public, anon, authenticated, service_role;
revoke all on sequence public.zell_order_shipments_log_id_seq, public.zell_order_customer_updates_id_seq,
  public.zell_order_customer_updates_log_id_seq
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.zell_order_shipments, public.zell_order_customer_updates to zell_order_definer;
grant select, insert on table public.zell_order_shipments_log, public.zell_order_customer_updates_log to zell_order_definer;
alter table public.zell_order_shipments enable row level security;
alter table public.zell_order_shipments_log enable row level security;
alter table public.zell_order_customer_updates enable row level security;
alter table public.zell_order_customer_updates_log enable row level security;
create policy zell_order_definer_all on public.zell_order_shipments
  for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_order_shipments_log
  for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_order_customer_updates
  for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_order_customer_updates_log
  for all to zell_order_definer using (true) with check (true);

-- (2) الثبات: السجلين append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، والشحنة والرسالة مابيتمسحوش (الإخفاء بدل المسح).
--     دوال الـ trigger مالكها postgres (invoker)، ونفس كود A1 للسجل (45413).
create function public.zell_shipment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_SHIPMENT_APPEND_ONLY' using errcode = '45413';
end
$fn$;
create function public.zell_customer_update_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_CUSTOMER_UPDATE_APPEND_ONLY' using errcode = '45413';
end
$fn$;
revoke all on function public.zell_shipment_trg_append_only(), public.zell_customer_update_trg_append_only()
  from public, anon, authenticated, service_role;

create trigger zell_order_shipments_no_delete before delete on public.zell_order_shipments
  for each row execute function public.zell_shipment_trg_append_only();
create trigger zell_order_shipments_no_truncate before truncate on public.zell_order_shipments
  for each statement execute function public.zell_shipment_trg_append_only();
create trigger zell_order_shipments_log_immutable before update or delete on public.zell_order_shipments_log
  for each row execute function public.zell_shipment_trg_append_only();
create trigger zell_order_shipments_log_no_truncate before truncate on public.zell_order_shipments_log
  for each statement execute function public.zell_shipment_trg_append_only();
create trigger zell_order_customer_updates_no_delete before delete on public.zell_order_customer_updates
  for each row execute function public.zell_customer_update_trg_append_only();
create trigger zell_order_customer_updates_no_truncate before truncate on public.zell_order_customer_updates
  for each statement execute function public.zell_customer_update_trg_append_only();
create trigger zell_order_customer_updates_log_immutable before update or delete on public.zell_order_customer_updates_log
  for each row execute function public.zell_customer_update_trg_append_only();
create trigger zell_order_customer_updates_log_no_truncate before truncate on public.zell_order_customer_updates_log
  for each statement execute function public.zell_customer_update_trg_append_only();

-- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء zell_shipment_* و zell_customer_update_* — برّه عدّادات
--     zell_order_* و zell_payment_* و zell_checkout_* (24 · 24 · 4 زي ما هم). هوية الجلسة (zell_order_actor(false) = أي أدمن
--     شغّال أو المالك)، والطلب برقمه (مش موجود = 45403). النسخة 45404. الحالة 45410. التحقق بالحقل في detail
--     (45433 الشحنة · 45434 الرسايل). الصلاحية في اللوحة: zell.orders.status_edit للشحنة و zell.orders.note_edit للرسايل.
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

-- نتيجة الشحنة للوحة (داخلية): الحالة · مسموح الحفظ ولا لأ · الشحنة بنسختها (updated_at) أو null.
create function public.zell_shipment_result(p_order_id integer)
returns jsonb language sql stable set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'order_number', o.order_number,
           'status', o.status,
           'editable', o.status in ('confirmed', 'preparing', 'shipped', 'delivered'),
           'shipment', (select pg_catalog.jsonb_build_object(
                                 'carrier', s.carrier,
                                 'tracking_number', s.tracking_number,
                                 'tracking_url', s.tracking_url,
                                 'shipped_on', pg_catalog.to_char(s.shipped_on, 'YYYY-MM-DD'),
                                 'expected_on', pg_catalog.to_char(s.expected_on, 'YYYY-MM-DD'),
                                 'updated_at', s.updated_at)
                          from public.zell_order_shipments s where s.order_id = o.id))
    from public.orders o where o.id = p_order_id
$fn$;

create function public.zell_shipment_get(p_order_number text)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_id integer;
begin
  select o.id into v_id from public.orders o where o.order_number = p_order_number;
  if v_id is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  return public.zell_shipment_result(v_id);
end
$fn$;

-- الحفظ: قفل صف الطلب (من غير ما يتغيّر) ← النسخة (null لأول حفظ، وإلا updated_at الشحنة) ← الحالة ← التحقق ← الكتابة + سطر
-- السجل في نفس المعاملة. الحفظ من غير تغيير مابيكتبش ولا بيغيّر النسخة. حالة الطلب و updated_at بتاعه مابيتغيّروش أبدًا.
-- التحقق (بعد NFC و trim): الشركة 1..60 · رقم الشحنة ≤ 60 (الفاضي = null) · الرابط https:// + host فيه نقطة، ≤ 300، من غير
-- مسافات · مفيش control characters · تاريخ الشحن من يوم الطلب لحد النهارده (القاهرة) · المتوقع من يوم الطلب لحد سنة قدام، و
-- ≥ تاريخ الشحن.
create function public.zell_shipment_save(p_order_number text, p_expected_updated_at timestamptz, p_carrier text,
                                          p_tracking_number text, p_tracking_url text, p_shipped_on date, p_expected_on date)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order public.orders;
  v_row public.zell_order_shipments;
  v_found boolean;
  v_carrier text := pg_catalog.btrim(pg_catalog.normalize(coalesce(p_carrier, ''), 'NFC'), E' \t\r\n');
  v_number text := nullif(pg_catalog.btrim(pg_catalog.normalize(coalesce(p_tracking_number, ''), 'NFC'), E' \t\r\n'), '');
  v_url text := nullif(pg_catalog.btrim(coalesce(p_tracking_url, ''), E' \t\r\n'), '');
  v_today date := (pg_catalog.now() at time zone 'Africa/Cairo')::date;
  v_created date;
  v_old jsonb;
  v_new jsonb;
  v_changed boolean;
begin
  select o.* into v_order from public.orders o where o.order_number = p_order_number for no key update;
  if not found then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  select s.* into v_row from public.zell_order_shipments s where s.order_id = v_order.id for update;
  v_found := found;
  if (v_found and (p_expected_updated_at is null
                   or pg_catalog.date_trunc('milliseconds', v_row.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at)))
     or (not v_found and p_expected_updated_at is not null) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if v_order.status not in ('confirmed', 'preparing', 'shipped', 'delivered') then
    raise exception 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' using errcode = '45410';
  end if;
  v_created := (v_order.created_at at time zone 'Africa/Cairo')::date;
  if v_carrier = '' or pg_catalog.char_length(v_carrier) > 60 or v_carrier ~ '[[:cntrl:]]' then
    raise exception 'ZELL_SHIPMENT_INVALID' using errcode = '45433', detail = 'carrier';
  end if;
  if v_number is not null and (pg_catalog.char_length(v_number) > 60 or v_number ~ '[[:cntrl:]]') then
    raise exception 'ZELL_SHIPMENT_INVALID' using errcode = '45433', detail = 'tracking_number';
  end if;
  if v_url is not null
     and (pg_catalog.char_length(v_url) > 300
          or v_url !~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][!-~]*)?$') then
    raise exception 'ZELL_SHIPMENT_INVALID' using errcode = '45433', detail = 'tracking_url';
  end if;
  if p_shipped_on is not null and (p_shipped_on < v_created or p_shipped_on > v_today) then
    raise exception 'ZELL_SHIPMENT_INVALID' using errcode = '45433', detail = 'shipped_on';
  end if;
  if p_expected_on is not null
     and (p_expected_on < v_created or p_expected_on > v_today + 366
          or (p_shipped_on is not null and p_expected_on < p_shipped_on)) then
    raise exception 'ZELL_SHIPMENT_INVALID' using errcode = '45433', detail = 'expected_on';
  end if;
  v_new := pg_catalog.jsonb_build_object('carrier', v_carrier, 'tracking_number', v_number, 'tracking_url', v_url,
                                         'shipped_on', p_shipped_on, 'expected_on', p_expected_on);
  if v_found then
    v_old := pg_catalog.jsonb_build_object('carrier', v_row.carrier, 'tracking_number', v_row.tracking_number,
                                           'tracking_url', v_row.tracking_url, 'shipped_on', v_row.shipped_on,
                                           'expected_on', v_row.expected_on);
  end if;
  v_changed := v_new is distinct from v_old;
  if v_changed then
    if v_found then
      update public.zell_order_shipments s
         set carrier = v_carrier, tracking_number = v_number, tracking_url = v_url, shipped_on = p_shipped_on,
             expected_on = p_expected_on, updated_at = pg_catalog.now(), updated_by = v_actor
       where s.order_id = v_order.id;
    else
      insert into public.zell_order_shipments (order_id, carrier, tracking_number, tracking_url, shipped_on, expected_on, updated_by)
      values (v_order.id, v_carrier, v_number, v_url, p_shipped_on, p_expected_on, v_actor);
    end if;
    insert into public.zell_order_shipments_log (order_id, actor, old_value, new_value) values (v_order.id, v_actor, v_old, v_new);
  end if;
  return public.zell_shipment_result(v_order.id) || pg_catalog.jsonb_build_object('changed', v_changed);
end
$fn$;

-- نتيجة الرسايل للوحة (داخلية): كل الرسايل (الظاهرة والمخفية) بنسخة كل واحدة، الأحدث الأول.
create function public.zell_customer_update_result(p_order_id integer)
returns jsonb language sql stable set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'order_number', o.order_number,
           'status', o.status,
           'updates', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'id', u.id, 'text', u.text, 'hidden', u.hidden, 'edited', u.edited,
                                         'created_at', u.created_at, 'updated_at', u.updated_at)
                                       order by u.created_at desc, u.id desc), '[]'::jsonb)
                         from public.zell_order_customer_updates u where u.order_id = o.id))
    from public.orders o where o.id = p_order_id
$fn$;

-- النص (داخلي للدوال دي): NFC · CRLF ← LF · trim · 1..300 · مفيش control characters غير سطر جديد. الغلط = 45434 text.
create function public.zell_customer_update_text(p_text text)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  v text := pg_catalog.btrim(pg_catalog.replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFC'), E'\r\n', E'\n'), E' \t\r\n');
begin
  if v = '' or pg_catalog.char_length(v) > 300 or pg_catalog.replace(v, E'\n', '') ~ '[[:cntrl:]]' then
    raise exception 'ZELL_CUSTOMER_UPDATE_INVALID' using errcode = '45434', detail = 'text';
  end if;
  return v;
end
$fn$;

create function public.zell_customer_update_list(p_order_number text)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_id integer;
begin
  select o.id into v_id from public.orders o where o.order_number = p_order_number;
  if v_id is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  return public.zell_customer_update_result(v_id);
end
$fn$;

-- إضافة: في أي حالة. أقصى 50 رسالة للطلب (الظاهرة والمخفية) = 45434 count. القفل على صف الطلب بيرتّب الإضافات المتزامنة.
create function public.zell_customer_update_add(p_order_number text, p_text text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order_id integer;
  v_text text;
  v_id bigint;
begin
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number for no key update;
  if v_order_id is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  v_text := public.zell_customer_update_text(p_text);
  if (select count(*) from public.zell_order_customer_updates u where u.order_id = v_order_id) >= 50 then
    raise exception 'ZELL_CUSTOMER_UPDATE_INVALID' using errcode = '45434', detail = 'count';
  end if;
  insert into public.zell_order_customer_updates (order_id, text, created_by, updated_by)
  values (v_order_id, v_text, v_actor, v_actor)
  returning id into v_id;
  insert into public.zell_order_customer_updates_log (update_id, order_id, action, actor, old_value, new_value)
  values (v_id, v_order_id, 'add', v_actor, null, pg_catalog.jsonb_build_object('text', v_text, 'hidden', false));
  return public.zell_customer_update_result(v_order_id) || pg_catalog.jsonb_build_object('id', v_id, 'changed', true);
end
$fn$;

-- تعديل النص: الرسالة لازم تبقى بتاعة نفس الطلب (وإلا 45403) · النسخة = updated_at الرسالة (45404) · نفس النص = مفيش كتابة.
create function public.zell_customer_update_edit(p_order_number text, p_update_id bigint, p_expected_updated_at timestamptz,
                                                 p_text text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order_id integer;
  v_row public.zell_order_customer_updates;
  v_text text;
  v_changed boolean;
begin
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number;
  if v_order_id is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  select u.* into v_row from public.zell_order_customer_updates u where u.id = p_update_id and u.order_id = v_order_id for update;
  if not found then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_row.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  v_text := public.zell_customer_update_text(p_text);
  v_changed := v_text <> v_row.text;
  if v_changed then
    update public.zell_order_customer_updates u
       set text = v_text, edited = true, updated_at = pg_catalog.now(), updated_by = v_actor
     where u.id = v_row.id;
    insert into public.zell_order_customer_updates_log (update_id, order_id, action, actor, old_value, new_value)
    values (v_row.id, v_order_id, 'edit', v_actor, pg_catalog.jsonb_build_object('text', v_row.text),
            pg_catalog.jsonb_build_object('text', v_text));
  end if;
  return public.zell_customer_update_result(v_order_id) || pg_catalog.jsonb_build_object('id', v_row.id, 'changed', v_changed);
end
$fn$;

-- إخفاء / إظهار: p_hidden لازم true أو false (وإلا 45434 hidden) · نفس الحالة = مفيش كتابة.
create function public.zell_customer_update_set_hidden(p_order_number text, p_update_id bigint, p_expected_updated_at timestamptz,
                                                       p_hidden boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_order_id integer;
  v_row public.zell_order_customer_updates;
  v_changed boolean;
begin
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number;
  if v_order_id is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  select u.* into v_row from public.zell_order_customer_updates u where u.id = p_update_id and u.order_id = v_order_id for update;
  if not found then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_row.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_hidden is null then
    raise exception 'ZELL_CUSTOMER_UPDATE_INVALID' using errcode = '45434', detail = 'hidden';
  end if;
  v_changed := p_hidden <> v_row.hidden;
  if v_changed then
    update public.zell_order_customer_updates u
       set hidden = p_hidden, updated_at = pg_catalog.now(), updated_by = v_actor
     where u.id = v_row.id;
    insert into public.zell_order_customer_updates_log (update_id, order_id, action, actor, old_value, new_value)
    values (v_row.id, v_order_id, case when p_hidden then 'hide' else 'show' end, v_actor,
            pg_catalog.jsonb_build_object('hidden', v_row.hidden), pg_catalog.jsonb_build_object('hidden', p_hidden));
  end if;
  return public.zell_customer_update_result(v_order_id) || pg_catalog.jsonb_build_object('id', v_row.id, 'changed', v_changed);
end
$fn$;

revoke all on function public.zell_shipment_result(integer), public.zell_shipment_get(text),
  public.zell_shipment_save(text, timestamptz, text, text, text, date, date),
  public.zell_customer_update_result(integer), public.zell_customer_update_text(text),
  public.zell_customer_update_list(text), public.zell_customer_update_add(text, text),
  public.zell_customer_update_edit(text, bigint, timestamptz, text),
  public.zell_customer_update_set_hidden(text, bigint, timestamptz, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.zell_shipment_get(text),
  public.zell_shipment_save(text, timestamptz, text, text, text, date, date),
  public.zell_customer_update_list(text), public.zell_customer_update_add(text, text),
  public.zell_customer_update_edit(text, bigint, timestamptz, text),
  public.zell_customer_update_set_hidden(text, bigint, timestamptz, boolean)
  to authenticated;

-- (4) zell_checkout_track_order: CREATE OR REPLACE بنفس الاسم والتوقيع والمالك والإعدادات (والصلاحيات بتفضل زي ما هي —
--     service_role بس). حقول v1 بنفس التعبيرات بالحرف، وجنبها حقول v2 (العقد §٢-٢): customer · history (created ثم
--     status_changed: الحالة والوقت بس) · money (§٣) · shipping · confirmed_delivery · shipment · updates (الظاهرة بس).
--     ممنوع في الرد: reason · الممثل · internal_notes · notes · مراجع الدفع · الكوبون · أي hash.
create or replace function public.zell_checkout_track_order(p_order_number text)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'order_number',   o.order_number,
           'status',         o.status,
           'created_at',     o.created_at,
           'total_piastres', o.total_piastres,
           'items', (
             select coalesce(
                      pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'product_name_ar',     i.product_name_ar,
                          'length_cm',           i.length_cm,
                          'width_cm',            i.width_cm,
                          'quantity',            i.quantity,
                          'sale_unit',           i.sale_unit,
                          'line_total_piastres', i.line_total_piastres)
                        order by i.id),
                      '[]'::jsonb)
               from public.order_items i
              where i.order_id = o.id),
           'delivery', case
             when o.delivery_confirmed_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'confirmed'::text,
               'date',   pg_catalog.to_char(o.delivery_confirmed_date, 'YYYY-MM-DD'),
               'period', o.delivery_confirmed_period)
             when o.preferred_delivery_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'preferred'::text,
               'date',   pg_catalog.to_char(o.preferred_delivery_date, 'YYYY-MM-DD'),
               'period', o.preferred_delivery_period)
           end,
           'customer', pg_catalog.jsonb_build_object(
             'name',        o.customer_name,
             'phone',       o.customer_phone,
             'address',     o.address,
             'governorate', o.governorate,
             'area',        o.shipping_area),
           'history', (
             select coalesce(
                      pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'status', case e.kind when 'created' then e.payload ->> 'status' else e.payload ->> 'to' end,
                          'at',     e.created_at)
                        order by e.created_at, e.id),
                      '[]'::jsonb)
               from public.order_events e
              where e.order_id = o.id and e.kind in ('created', 'status_changed')),
           'money', (
             select pg_catalog.jsonb_build_object(
                      'items_piastres',            o.subtotal_piastres,
                      'discount_piastres',         o.discount_piastres,
                      'shipping_piastres',         o.shipping_piastres,
                      'installation_piastres',     o.installation_piastres,
                      'travel_piastres',           o.installation_travel_piastres,
                      'total_piastres',            o.total_piastres,
                      'confirmation_fee_piastres', o.confirmation_fee_piastres,
                      'paid_piastres',             coalesce(pg_catalog.sum(p.amount_piastres) filter (where p.kind = 'payment'), 0),
                      'refunded_piastres',         coalesce(pg_catalog.sum(p.amount_piastres) filter (where p.kind = 'refund'), 0),
                      'net_paid_piastres',         o.paid_piastres,
                      'remaining_piastres',        greatest(o.total_piastres - o.paid_piastres, 0))
               from public.order_payments p
              where p.order_id = o.id),
           'shipping', case
             when o.shipping_method is not null then pg_catalog.jsonb_build_object(
               'method',   o.shipping_method,
               'days_min', o.shipping_days_min,
               'days_max', o.shipping_days_max)
           end,
           'confirmed_delivery', case
             when o.delivery_confirmed_date is not null then pg_catalog.jsonb_build_object(
               'date',   pg_catalog.to_char(o.delivery_confirmed_date, 'YYYY-MM-DD'),
               'period', o.delivery_confirmed_period)
           end,
           'shipment', (
             select pg_catalog.jsonb_build_object(
                      'carrier',         s.carrier,
                      'tracking_number', s.tracking_number,
                      'tracking_url',    s.tracking_url,
                      'shipped_on',      pg_catalog.to_char(s.shipped_on, 'YYYY-MM-DD'),
                      'expected_on',     pg_catalog.to_char(s.expected_on, 'YYYY-MM-DD'))
               from public.zell_order_shipments s
              where s.order_id = o.id),
           'updates', (
             select coalesce(
                      pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'id',     u.id,
                          'at',     u.created_at,
                          'text',   u.text,
                          'edited', u.edited)
                        order by u.created_at desc, u.id desc),
                      '[]'::jsonb)
               from public.zell_order_customer_updates u
              where u.order_id = o.id and not u.hidden))
    from public.orders o
   where p_order_number ~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
     and o.order_number = p_order_number
$fn$;

reset role;
revoke create on schema public from zell_order_definer;

-- (5) postflight
do $tr2post$
declare
  v_tr oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
  v_pub oid[] := array[
    pg_catalog.to_regprocedure('public.zell_shipment_get(text)'),
    pg_catalog.to_regprocedure('public.zell_shipment_save(text, timestamptz, text, text, text, date, date)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_list(text)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_add(text, text)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_edit(text, bigint, timestamptz, text)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_set_hidden(text, bigint, timestamptz, boolean)')];
  v_int oid[] := array[
    pg_catalog.to_regprocedure('public.zell_shipment_result(integer)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_result(integer)'),
    pg_catalog.to_regprocedure('public.zell_customer_update_text(text)')];
begin
  if (select count(*) from pg_catalog.unnest(v_pub || v_int) f(o) where f.o is not null) <> 9
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = any (v_pub || v_int)
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer'
                        or p.proconfig is distinct from array['search_path=""']
                        or p.prosecdef <> (p.oid = any (v_pub))))
     or exists (select 1 from pg_catalog.unnest(v_pub) f(o)
                 where not pg_catalog.has_function_privilege('authenticated', f.o, 'EXECUTE')
                    or pg_catalog.has_function_privilege('anon', f.o, 'EXECUTE')
                    or pg_catalog.has_function_privilege('service_role', f.o, 'EXECUTE'))
     or exists (select 1 from pg_catalog.unnest(v_int) f(o), (values ('anon'), ('authenticated'), ('service_role')) r(n)
                 where pg_catalog.has_function_privilege(r.n, f.o, 'EXECUTE'))
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid in (pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()'),
                                 pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()'))
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' or p.prosecdef))
     or (select count(*) from pg_catalog.pg_proc p
          where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%') <> 11 then
    raise exception 'ZELL_0021TR2_POST_FUNCTIONS';
  end if;
  if exists (select 1
               from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                    (values ('public.zell_order_shipments'), ('public.zell_order_shipments_log'),
                            ('public.zell_order_customer_updates'), ('public.zell_order_customer_updates_log')) t(n)
              where pg_catalog.has_table_privilege(r.n, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or exists (select 1
                  from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                       (values ('public.zell_order_shipments_log_id_seq'), ('public.zell_order_customer_updates_id_seq'),
                               ('public.zell_order_customer_updates_log_id_seq')) s(n)
                 where pg_catalog.has_sequence_privilege(r.n, s.n, 'USAGE,SELECT,UPDATE'))
     or (select count(*) from pg_catalog.pg_class c
          where c.oid in (pg_catalog.to_regclass('public.zell_order_shipments'), pg_catalog.to_regclass('public.zell_order_shipments_log'),
                          pg_catalog.to_regclass('public.zell_order_customer_updates'),
                          pg_catalog.to_regclass('public.zell_order_customer_updates_log'))
            and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') <> 4
     or (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public'
            and p.tablename in ('zell_order_shipments', 'zell_order_shipments_log',
                                'zell_order_customer_updates', 'zell_order_customer_updates_log')) <> 4
     or (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.roles = array['zell_order_definer']::name[]
            and p.tablename in ('zell_order_shipments', 'zell_order_shipments_log',
                                'zell_order_customer_updates', 'zell_order_customer_updates_log')) <> 4
     or (select count(*) from pg_catalog.pg_trigger g
          where g.tgrelid in ('public.zell_order_shipments'::regclass, 'public.zell_order_shipments_log'::regclass,
                              'public.zell_order_customer_updates'::regclass, 'public.zell_order_customer_updates_log'::regclass)
            and not g.tgisinternal and g.tgenabled = 'O') <> 8
     or exists (select 1 from public.zell_order_shipments) or exists (select 1 from public.zell_order_shipments_log)
     or exists (select 1 from public.zell_order_customer_updates) or exists (select 1 from public.zell_order_customer_updates_log)
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0021TR2_POST_TABLES';
  end if;
  if v_tr is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') <> 1
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_tr
                   and (pg_catalog.md5(p.prosrc) <> '14dad4721c48b73ee5e040bf7436bfc5'
                        or pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
                        or p.proconfig is distinct from array['search_path=""']
                        or coalesce(p.proacl::text, '') <> '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}')) then
    raise exception 'ZELL_0021TR2_POST_TRACK';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4
     or coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                   where p.prosrc like '%45433%'), '') <> 'zell_shipment_save'
     or coalesce((select pg_catalog.string_agg(p.proname::text, ',' order by p.proname::text) from pg_catalog.pg_proc p
                   where p.prosrc like '%45434%'), '') <> 'zell_customer_update_add,zell_customer_update_set_hidden,zell_customer_update_text' then
    raise exception 'ZELL_0021TR2_POST_OTHERS';
  end if;
end
$tr2post$;
-- <<< 0021TR2 BODY

do $zT$
declare
  v_tables text[] := array['zell_order_shipments', 'zell_order_shipments_log', 'zell_order_customer_updates',
                           'zell_order_customer_updates_log'];
  v_pub text[] := array['zell_shipment_get', 'zell_shipment_save', 'zell_customer_update_list', 'zell_customer_update_add',
                        'zell_customer_update_edit', 'zell_customer_update_set_hidden'];
  v_int text[] := array['zell_shipment_result', 'zell_customer_update_result', 'zell_customer_update_text'];
  v_tr oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
  v_latest text := pg_catalog.current_setting('zell.ptest_latest');
  v_r text;
  v_v2 jsonb;
  v_v1 jsonb;
  v_x text;
begin
  perform pg_temp.zt('T01 tables: 4 (owner postgres, RLS, one policy each for zell_order_definer only), empty, 8 guards enabled',
    (select count(*) from pg_catalog.pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname = any (v_tables)
        and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') = 4
    and (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = any (v_tables)) = 4
    and (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename = any (v_tables) and p.roles = array['zell_order_definer']::name[]) = 4
    and not exists (select 1 from public.zell_order_shipments) and not exists (select 1 from public.zell_order_shipments_log)
    and not exists (select 1 from public.zell_order_customer_updates) and not exists (select 1 from public.zell_order_customer_updates_log)
    and (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = any (v_tables) and not g.tgisinternal and g.tgenabled = 'O') = 8,
    null);
  perform pg_temp.zt('T02 functions: 6 public (definer, security definer, authenticated only) · 3 internal (no EXECUTE) · 2 trigger functions (postgres) · no table / sequence access for anon, authenticated, service_role · no CREATE',
    (select count(*) from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = any (v_pub)
        and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer' and p.prosecdef and p.proconfig = array['search_path=""']
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) = 6
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = any (v_int)
            and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer' and not p.prosecdef
            and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) = 3
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('zell_shipment_trg_append_only', 'zell_customer_update_trg_append_only')
            and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef) = 2
    and (select count(*) from pg_catalog.pg_proc p
          where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%') = 11
    and not exists (select 1
                      from (values ('anon'), ('authenticated'), ('service_role')) ro(n), pg_catalog.unnest(v_tables) t(n)
                     where pg_catalog.has_table_privilege(ro.n, 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    and not exists (select 1
                      from (values ('anon'), ('authenticated'), ('service_role')) ro(n),
                           (values ('public.zell_order_shipments_log_id_seq'), ('public.zell_order_customer_updates_id_seq'),
                                   ('public.zell_order_customer_updates_log_id_seq')) s(n)
                     where pg_catalog.has_sequence_privilege(ro.n, s.n, 'USAGE,SELECT,UPDATE'))
    and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'), null);
  perform pg_temp.zt('T03 identity live: the 6 functions without a session -> 45400 · service_role -> 42501',
    pg_temp.call_as('authenticated', null, 'select public.zell_shipment_get(''FLM-AAAAAA'')::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', null, 'select public.zell_shipment_save(''FLM-AAAAAA'', null, ''x'', null, null, null, null)::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', null, 'select public.zell_customer_update_list(''FLM-AAAAAA'')::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', null, 'select public.zell_customer_update_add(''FLM-AAAAAA'', ''x'')::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', null, 'select public.zell_customer_update_edit(''FLM-AAAAAA'', 1, now(), ''x'')::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', null, 'select public.zell_customer_update_set_hidden(''FLM-AAAAAA'', 1, now(), true)::text') = 'ERR 45400'
    and pg_temp.call_as('service_role', null, 'select public.zell_shipment_save(''FLM-AAAAAA'', null, ''x'', null, null, null, null)::text') = 'ERR 42501'
    and pg_temp.call_as('service_role', null, 'select public.zell_customer_update_add(''FLM-AAAAAA'', ''x'')::text') = 'ERR 42501'
    and not exists (select 1 from public.zell_order_customer_updates), null);
  perform pg_temp.zt('T04 zell_checkout_track_order: same function (oid), v2 body (md5), owner zell_order_definer, security definer, stable, search_path empty, EXECUTE = before (service_role only)',
    (select count(*) from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') = 1
    and v_tr::text = pg_catalog.current_setting('zell.ptest_track_oid')
    and coalesce((select pg_catalog.md5(p.prosrc) = '14dad4721c48b73ee5e040bf7436bfc5' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer'
                         and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
                         and p.proacl::text = pg_catalog.current_setting('zell.ptest_track_acl')
                    from pg_catalog.pg_proc p where p.oid = v_tr), false)
    and pg_catalog.current_setting('zell.ptest_track_acl') = '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}', pg_catalog.current_setting('zell.ptest_track_acl'));
  if v_latest = '' then
    perform pg_temp.zt('T05 latest order: no orders (nothing to compare)', true, 'no orders');
  else
    v_r := pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', v_latest));
    v_v2 := case when v_r like 'ERR%' or v_r = 'null' then null else v_r::jsonb end;
    v_x := pg_catalog.current_setting('zell.ptest_v1');
    v_v1 := case when v_x like 'ERR%' or v_x in ('', 'null') then null else v_x::jsonb end;
    perform pg_temp.zt('T05 latest order: the v1 keys of the v2 response = the v1 response before the body (exactly) · 13 keys · money: net = paid - refunded = orders.paid_piastres · no forbidden keys',
      v_v1 is not null and v_v2 is not null
      and (v_v2 - array['customer', 'history', 'money', 'shipping', 'confirmed_delivery', 'shipment', 'updates']) = v_v1
      and (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_v2) k)
          = array['confirmed_delivery', 'created_at', 'customer', 'delivery', 'history', 'items', 'money', 'order_number',
                  'shipment', 'shipping', 'status', 'total_piastres', 'updates']
      and (v_v2 -> 'money' ->> 'net_paid_piastres')::bigint
          = (v_v2 -> 'money' ->> 'paid_piastres')::bigint - (v_v2 -> 'money' ->> 'refunded_piastres')::bigint
      and (v_v2 -> 'money' ->> 'net_paid_piastres')::bigint
          = (select o.paid_piastres from public.orders o where o.order_number = v_latest)
      and v_v2 -> 'shipment' = 'null'::jsonb and v_v2 -> 'updates' = '[]'::jsonb
      and v_v2::text !~ '"(reason|actor|internal_notes|notes|reference|note|coupon_code|method_name|idempotency_key|updated_by|created_by|hidden)":',
      case when v_v2 is null then 'v2=' || coalesce(v_r, '-') else 'keys=' || (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_v2)) end);
  end if;
  perform pg_temp.zt('T06 wrong shape or not found -> null (service_role) · anon / authenticated -> 42501',
    pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order('''')::text') = 'null'
    and pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order(null)::text') = 'null'
    and pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order(''flm-abcdef'')::text') = 'null'
    and pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order(''FLM-ABCDE0'')::text') = 'null'
    and pg_temp.call_as('service_role', null, 'select public.zell_checkout_track_order(''FLM-ABCDEFG'')::text') = 'null'
    and pg_temp.call_as('anon', null, 'select public.zell_checkout_track_order(''FLM-ABCDEF'')::text') = 'ERR 42501'
    and pg_temp.call_as('authenticated', null, 'select public.zell_checkout_track_order(''FLM-ABCDEF'')::text') = 'ERR 42501', null);
  perform pg_temp.zt('T07 nothing else changed: zell_order_definer grants + policies on orders / order_events / order_payments, every other function (md5 + grants), 24 zell_order_* · 24 zell_payment_* · 4 zell_checkout_*',
    pg_temp.privs() = pg_catalog.current_setting('zell.ptest_privs')
    and pg_temp.fns() = pg_catalog.current_setting('zell.ptest_fns')
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4, null);
  perform pg_temp.zt('T08 no data touched: orders / order_events / order_payments / order_items counts unchanged',
    (select count(*) from public.orders) || '/' || (select count(*) from public.order_events) || '/'
    || (select count(*) from public.order_payments) || '/' || (select count(*) from public.order_items)
    = pg_catalog.current_setting('zell.ptest_counts'), pg_catalog.current_setting('zell.ptest_counts'));
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

-- T09 (ci بس): طلب حقيقي ← تأكيد ← شحنة ← رسالة ← إخفاء، والرد بيتابعهم، والسجل في نفس المعاملة.
do $zC$
declare
  v_admin text := '00000000-0000-0000-0000-00000000000b';
  v_num text;
  v_id integer;
  v_r text;
  v_s text;
  v_u text;
  v_h text;
  v_t1 jsonb;
  v_t2 jsonb;
begin
  if pg_catalog.current_setting('zell.ptest_profile') <> 'ci' then
    perform pg_temp.zt_skip('T09 order -> confirm -> shipment -> customer update -> hide (ci profile only)', 'production profile');
    return;
  end if;
  v_num := public.zell_create_order(p_items => '[{"productId":1,"lengthCm":300}]'::jsonb, p_customer_name => 'عميل الاختبار',
             p_customer_phone => '01000000091', p_governorate => 'القاهرة', p_address => 'عنوان الاختبار طويل كفاية',
             p_notes => 'ملاحظة العميل السرية', p_idempotency_key => 'ptest-0021tr2-t09-000000', p_request_hash => repeat('a', 64),
             p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64)) ->> 'order_number';
  select o.id into v_id from public.orders o where o.order_number = v_num;
  v_r := pg_temp.call_as('authenticated', v_admin, pg_catalog.format(
    'select public.zell_order_transition(%s, %L::timestamptz, %L, %L)::text', v_id,
    (select o.updated_at from public.orders o where o.id = v_id), 'confirmed', 'سبب داخلي'));
  v_s := pg_temp.call_as('authenticated', v_admin, pg_catalog.format(
    'select public.zell_shipment_save(%L, null, %L, %L, %L, null, null)::text', v_num, ' بوسطة ', 'TRK-1', 'https://track.example.com/TRK-1'));
  v_u := pg_temp.call_as('authenticated', v_admin, pg_catalog.format(
    'select public.zell_customer_update_add(%L, %L)::text', v_num, '  طلبك خرج من المخزن  '));
  v_t1 := pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', v_num))::jsonb;
  v_h := pg_temp.call_as('authenticated', v_admin, pg_catalog.format(
    'select public.zell_customer_update_set_hidden(%L, %s, %L::timestamptz, true)::text', v_num,
    (v_u::jsonb ->> 'id'), (select u.updated_at from public.zell_order_customer_updates u where u.id = (v_u::jsonb ->> 'id')::bigint)));
  v_t2 := pg_temp.call_as('service_role', null, pg_catalog.format('select public.zell_checkout_track_order(%L)::text', v_num))::jsonb;
  perform pg_temp.zt('T09 order -> confirm -> shipment -> customer update -> hide: response follows each step, history new/confirmed without reason, logs 1 + 2, order status unchanged by the shipment',
    v_r like '{%' and v_s like '{%' and v_u like '{%' and v_h like '{%'
    and v_t1 -> 'shipment' = '{"carrier": "بوسطة", "tracking_number": "TRK-1", "tracking_url": "https://track.example.com/TRK-1", "shipped_on": null, "expected_on": null}'::jsonb
    and pg_catalog.jsonb_array_length(v_t1 -> 'updates') = 1 and v_t1 -> 'updates' -> 0 ->> 'text' = 'طلبك خرج من المخزن'
    and v_t1 -> 'updates' -> 0 -> 'edited' = 'false'::jsonb
    and v_t2 -> 'updates' = '[]'::jsonb and v_t2 -> 'shipment' = v_t1 -> 'shipment'
    and (select pg_catalog.array_agg(e ->> 'status' order by n) from pg_catalog.jsonb_array_elements(v_t2 -> 'history') with ordinality x(e, n))
        = array['new', 'confirmed']
    and pg_catalog.strpos(v_t2::text, 'سبب داخلي') = 0 and pg_catalog.strpos(v_t2::text, 'ملاحظة العميل السرية') = 0
    and (select count(*) from public.zell_order_shipments_log l where l.order_id = v_id) = 1
    and (select pg_catalog.string_agg(l.action, ',' order by l.id) from public.zell_order_customer_updates_log l where l.order_id = v_id) = 'add,hide'
    and (select o.status from public.orders o where o.id = v_id) = 'confirmed',
    left(coalesce(v_r, '-'), 80) || ' | ' || left(coalesce(v_s, '-'), 120) || ' | ' || left(coalesce(v_t1::text, '-'), 200));
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass')
                 = case pg_catalog.current_setting('zell.ptest_profile') when 'ci' then 9 else 8 end
             and coalesce((select string_agg(id, ',' order by id) from pg_temp.zt_results where outcome = 'skip'), '')
                 = case pg_catalog.current_setting('zell.ptest_profile') when 'ci' then '' else 'T09' end
            then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from pg_temp.zt_results where outcome = 'skip') as skip,
       pg_catalog.current_setting('zell.ptest_profile') as profile
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
