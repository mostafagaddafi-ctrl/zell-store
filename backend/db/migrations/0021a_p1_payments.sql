-- 0021-A P1 — الدفعات ورسوم التأكيد في الداتابيز (SQL بس)
--
-- العقد: docs/contracts/0021-A.md (§٣ · §٥ · §٦، وقرارات المراجع ر٢ و ر٤). التفاصيل التنفيذية في §١٧ منه.
--   • orders: paid_piastres (= الدفعات − الردود، 0..الإجمالي، بتكتبه دوال الدفعات بس) + confirmation_fee_piastres (لقطة وقت
--     الإنشاء، 0..الإجمالي، مابتتعدّلش). الإجمالي وكل الحسابات زي ما هي.
--   • order_payments (append-only) · zell_payment_methods (الأربعة الافتراضية) · zell_payment_settings
--     (صف واحد: الرسوم مقفولة ومن غير أرقام، والآجل مقفول، والأرقام والسياسة وقالب واتساب نصوص) · zell_payment_config_log ·
--     zell_payment_commands (مراجعة #122: أمر لكل record / refund / deliver_order بلقطة نتيجته الأصلية — الـ idempotency منه).
--   • 24 دالة zell_payment_* (مش zell_order_* علشان verify A1): 10 عامة لـ authenticated بهوية الجلسة (من غير معامل للممثل).
--   • دالة الانتقال (A1): المقدم قبل التأكيد والتجهيز (45419)، والباقي قبل التسليم إلا بتحصيل في نفس العملية أو آجل صريح (45420).
--   • zell_create_order: من التعريف الحي بعد D (البصمة في الـ preflight)، والفرق الوحيد عمود الرسوم.
--   • كتالوج 0021-P (ر٢): zell.orders.payments_record (sales، في قالب admin_today وبتتمنح للأدمن الشغال) و
--     zell.orders.payments_admin (owner).
--   • الأكواد: 45416..45429 (نطاق 0021-أ). الـ preflight والـ postflight: ZELL_0021A_P1_*.
--
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = '<الموافقة>';
-- التحقق بعد التطبيق: 0021a_p1_payments_verify.sql · الرجوع: 0021a_p1_payments_rollback.sql
-- الاختبار قبل التطبيق: 0021a_p1_payments_ptest.sql · CI: backend/db/ci/0021p1_sql_ci.sh
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد backup، وقت طلبات قليلة: ALTER TABLE orders بياخد قفل ACCESS EXCLUSIVE على
--   orders بيفضل لحد آخر المعاملة (commit)، فأي طلب جديد بيستنى طول مدة التطبيق. لو مالقاش القفل في 5 ثواني بيفشل كله بأمان.

begin;
-- >>> 0021A_P1 BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight: A1 + D + 0021-P متطبّقين، و P1 لأ، والدالتين اللي بنعدّلهم زي التعريف المحفوظ بالحرف (بصمة prosrc).
do $p1pre$
declare
  v_oid oid;
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A_P1_WRONG_CALLER';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0021A_P1_SERVER_VERSION';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021A_P1_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regclass('public.order_events') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24 then
    raise exception 'ZELL_0021A_P1_A1_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%')
     or pg_catalog.to_regclass('public.order_payments') is not null
     or pg_catalog.to_regclass('public.zell_payment_methods') is not null
     or pg_catalog.to_regclass('public.zell_payment_settings') is not null
     or pg_catalog.to_regclass('public.zell_payment_config_log') is not null
     or pg_catalog.to_regclass('public.zell_payment_commands') is not null
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                   and a.attname in ('paid_piastres', 'confirmation_fee_piastres')) then
    raise exception 'ZELL_0021A_P1_ALREADY_APPLIED';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1 then
    raise exception 'ZELL_0021A_P1_CREATE_ORDER_OVERLOADS';
  end if;
  v_oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)');
  if v_oid is null then
    raise exception 'ZELL_0021A_P1_CREATE_ORDER_SIGNATURE';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_oid) <> 'c131cb51cd86830e9445b139296b0281' then
    raise exception 'ZELL_0021A_P1_CREATE_ORDER_DRIFT';
  end if;
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.zell_order_apply_transition(public.orders, text, uuid, text)'))
     is distinct from 'aa7cc01c2320cb97d76845d63413886c' then
    raise exception 'ZELL_0021A_P1_TRANSITION_DRIFT';
  end if;
  if pg_catalog.to_regclass('public.erp_capabilities') is null or pg_catalog.to_regclass('public.erp_preset_items') is null
     or pg_catalog.to_regclass('public.erp_user_grants') is null or pg_catalog.to_regclass('public.erp_access_audit') is null then
    raise exception 'ZELL_0021A_P1_ACCESS_MISSING';
  end if;
  if (select count(*) from public.erp_capabilities) <> 29
     or (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') <> 22
     or exists (select 1 from public.erp_capabilities c
                 where c.key in ('zell.orders.payments_record', 'zell.orders.payments_admin')) then
    raise exception 'ZELL_0021A_P1_CATALOG_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                    and a.attname = 'total_piastres' and a.atttypid = 'integer'::regtype)
     or exists (select 1 from public.orders o where o.total_piastres is null or o.total_piastres < 0) then
    raise exception 'ZELL_0021A_P1_ORDERS_SHAPE';
  end if;
end
$p1pre$;

-- (1) orders: المدفوع الصافي ولقطة رسوم التأكيد. الصفوف القديمة = 0 و 0 (مفيش دفعات قبل كده). الإجمالي زي ما هو.
alter table public.orders
  add column paid_piastres integer not null default 0,
  add column confirmation_fee_piastres integer not null default 0,
  add constraint orders_paid_range check (paid_piastres >= 0 and paid_piastres <= total_piastres),
  add constraint orders_confirmation_fee_range check (confirmation_fee_piastres >= 0 and confirmation_fee_piastres <= total_piastres);

-- الدور بيكتب المدفوع بس (من دوال الدفعات). لقطة الرسوم مابتتعدّلش بعد الإنشاء من أي حد.
grant update (paid_piastres) on table public.orders to zell_order_definer;

-- (2) الجداول الجديدة (مالكها postgres): RLS + policy للدور بس، وصفر صلاحيات لأي دور تاني.
create table public.zell_payment_methods (
  id          integer generated always as identity constraint zell_payment_methods_pkey primary key,
  name        text not null constraint zell_payment_methods_name_check
              check (pg_catalog.char_length(name) between 1 and 60 and name = pg_catalog.btrim(name)),
  sort_order  integer not null constraint zell_payment_methods_sort_check check (sort_order between 0 and 100000),
  is_archived boolean not null default false,
  created_at  timestamptz not null default pg_catalog.now(),
  updated_at  timestamptz not null default pg_catalog.now()
);
create unique index zell_payment_methods_active_name_uidx on public.zell_payment_methods (name) where not is_archived;
insert into public.zell_payment_methods (name, sort_order) values
  ('كاش', 10),
  ('فودافون كاش', 20),
  ('إنستاباي', 30),
  ('تحويل بنكي', 40);

create table public.order_payments (
  id                  bigint generated always as identity constraint order_payments_pkey primary key,
  order_id            integer not null constraint order_payments_order_fkey references public.orders (id) on delete restrict,
  kind                text not null constraint order_payments_kind_check check (kind in ('payment', 'refund')),
  amount_piastres     integer not null constraint order_payments_amount_check check (amount_piastres > 0),
  purpose             text not null constraint order_payments_purpose_check check (purpose in ('confirmation_fee', 'balance')),
  method_id           integer constraint order_payments_method_fkey references public.zell_payment_methods (id) on delete restrict,
  method_name         text not null constraint order_payments_method_name_check check (pg_catalog.char_length(method_name) between 1 and 60),
  method_is_other     boolean not null,
  reference           text constraint order_payments_reference_check
                      check (reference is null or pg_catalog.char_length(reference) between 1 and 100),
  note                text constraint order_payments_note_check check (note is null or pg_catalog.char_length(note) between 1 and 300),
  actor               uuid not null,
  command_id          uuid not null constraint order_payments_command_key unique,
  request_hash        text not null constraint order_payments_hash_check check (request_hash ~ '^[0-9a-f]{32}$'),
  paid_after_piastres integer not null constraint order_payments_paid_after_check check (paid_after_piastres >= 0),
  created_at          timestamptz not null default pg_catalog.now(),
  constraint order_payments_method_shape check ((method_id is not null) <> method_is_other)
);
create index order_payments_order_idx on public.order_payments (order_id, id);
create index order_payments_method_idx on public.order_payments (method_id) where method_id is not null;

create table public.zell_payment_settings (
  id                      boolean not null default true constraint zell_payment_settings_pkey primary key
                          constraint zell_payment_settings_single check (id),
  confirmation_fee        jsonb not null default '{"enabled": false}'::jsonb
                          constraint zell_payment_settings_fee_check
                          check (pg_catalog.jsonb_typeof(confirmation_fee) = 'object' and pg_catalog.pg_column_size(confirmation_fee) <= 2000),
  customer_credit_enabled boolean not null default false,
  payment_numbers         text constraint zell_payment_settings_numbers_check
                          check (payment_numbers is null or pg_catalog.char_length(payment_numbers) between 1 and 1000),
  fee_policy              text constraint zell_payment_settings_policy_check
                          check (fee_policy is null or pg_catalog.char_length(fee_policy) between 1 and 1000),
  whatsapp_template       text constraint zell_payment_settings_template_check
                          check (whatsapp_template is null or pg_catalog.char_length(whatsapp_template) between 1 and 2000),
  updated_at              timestamptz not null default pg_catalog.now(),
  updated_by              uuid
);
-- مقفولة افتراضيًا ومن غير أرقام (قرار ٣ + تصحيح المالك)، والآجل مقفول (قرار ٤).
insert into public.zell_payment_settings (id) values (true);

create table public.zell_payment_config_log (
  id         bigint generated always as identity constraint zell_payment_config_log_pkey primary key,
  kind       text not null constraint zell_payment_config_log_kind_check
             check (kind in ('settings', 'method_add', 'method_update', 'method_delete')),
  actor      uuid not null,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  constraint zell_payment_config_log_size_check
    check (pg_catalog.pg_column_size(old_value) <= 16000 and pg_catalog.pg_column_size(new_value) <= 16000)
);

-- أوامر الدفع (مراجعة #122): كل record / refund / deliver_order ناجح بيسجّل أمر واحد بلقطة نتيجته الأصلية، في نفس معاملة
-- الكتابة (الدفعة والحدث وتحديث الطلب). الإعادة بنفس command_id بترجّع اللقطة دي (مش ملخص حي) حتى لو الطلب اتغيّر بعدها.
-- التسليم بيسجّل أمر حتى لو مااتعملش دفعة (المدفوع كامل، أو آجل صريح). append-only، والطلب اللي عليه أمر مايتمسحش.
create table public.zell_payment_commands (
  command_id   uuid not null constraint zell_payment_commands_pkey primary key,
  operation    text not null constraint zell_payment_commands_operation_check check (operation in ('payment', 'refund', 'deliver')),
  order_id     integer not null constraint zell_payment_commands_order_fkey references public.orders (id) on delete restrict,
  actor        uuid not null,
  request_hash text not null constraint zell_payment_commands_hash_check check (request_hash ~ '^[0-9a-f]{32}$'),
  result       jsonb not null constraint zell_payment_commands_result_check
               check (pg_catalog.jsonb_typeof(result) = 'object' and pg_catalog.pg_column_size(result) <= 8000),
  created_at   timestamptz not null default pg_catalog.now()
);
create index zell_payment_commands_order_idx on public.zell_payment_commands (order_id);

revoke all on table public.zell_payment_methods, public.order_payments, public.zell_payment_settings,
  public.zell_payment_config_log, public.zell_payment_commands from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.zell_payment_methods to zell_order_definer;
grant select, insert on table public.order_payments, public.zell_payment_config_log, public.zell_payment_commands to zell_order_definer;
grant select, update on table public.zell_payment_settings to zell_order_definer;

alter table public.zell_payment_methods enable row level security;
alter table public.order_payments enable row level security;
alter table public.zell_payment_settings enable row level security;
alter table public.zell_payment_config_log enable row level security;
alter table public.zell_payment_commands enable row level security;
create policy zell_order_definer_all on public.zell_payment_methods for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.order_payments for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_payment_settings for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_payment_config_log for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_payment_commands for all to zell_order_definer using (true) with check (true);

-- (3) الحراس (دوال trigger مالكها postgres).
create function public.zell_payment_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_PAY_APPEND_ONLY' using errcode = '45427', detail = tg_table_name || '.' || pg_catalog.lower(tg_op);
end
$fn$;

create function public.zell_payment_trg_settings_guard()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_PAY_SETTINGS_GUARD' using errcode = '45429', detail = pg_catalog.lower(tg_op);
end
$fn$;

-- المدفوع: بيتكتب من دوال الدفعات بس (الدور zell_order_definer)، ويبدأ 0. لقطة الرسوم: مابتتغيّرش بعد الإنشاء.
create function public.zell_payment_trg_orders_money()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.paid_piastres <> 0 then
      raise exception 'ZELL_PAY_DIRECT_WRITE' using errcode = '45418', detail = 'paid_piastres';
    end if;
    return new;
  end if;
  if new.confirmation_fee_piastres is distinct from old.confirmation_fee_piastres then
    raise exception 'ZELL_PAY_DIRECT_WRITE' using errcode = '45418', detail = 'confirmation_fee_piastres';
  end if;
  if new.paid_piastres is distinct from old.paid_piastres and current_user <> 'zell_order_definer' then
    raise exception 'ZELL_PAY_DIRECT_WRITE' using errcode = '45418', detail = 'paid_piastres';
  end if;
  return new;
end
$fn$;

revoke all on function public.zell_payment_trg_append_only(), public.zell_payment_trg_settings_guard(),
  public.zell_payment_trg_orders_money() from public, anon, authenticated, service_role;

create trigger order_payments_immutable before update or delete on public.order_payments
  for each row execute function public.zell_payment_trg_append_only();
create trigger order_payments_no_truncate before truncate on public.order_payments
  for each statement execute function public.zell_payment_trg_append_only();
create trigger zell_payment_config_log_immutable before update or delete on public.zell_payment_config_log
  for each row execute function public.zell_payment_trg_append_only();
create trigger zell_payment_config_log_no_truncate before truncate on public.zell_payment_config_log
  for each statement execute function public.zell_payment_trg_append_only();
create trigger zell_payment_commands_immutable before update or delete on public.zell_payment_commands
  for each row execute function public.zell_payment_trg_append_only();
create trigger zell_payment_commands_no_truncate before truncate on public.zell_payment_commands
  for each statement execute function public.zell_payment_trg_append_only();
create trigger zell_payment_settings_guard before insert or delete on public.zell_payment_settings
  for each row execute function public.zell_payment_trg_settings_guard();
create trigger zell_payment_settings_no_truncate before truncate on public.zell_payment_settings
  for each statement execute function public.zell_payment_trg_settings_guard();
create trigger orders_money_guard before insert or update of paid_piastres, confirmation_fee_piastres on public.orders
  for each row execute function public.zell_payment_trg_orders_money();

-- (4) كتالوج 0021-P (ر٢): صلاحيتين جداد. تسجيل الدفعات فئة sales (في قالب «أدمن زي النهارده» وبتتمنح لكل أدمن شغال
--     بسطر سجل مصدره migration، فالمطابقة بتفضل نظيفة). الرد والإعدادات وطرق الدفع وأرقامه والقوالب فئة owner (مابتتمنحش).
insert into public.erp_capabilities (key, category, description) values
  ('zell.orders.payments_record', 'sales', 'تسجيل الدفعات على الطلب (0021-أ P1)'),
  ('zell.orders.payments_admin', 'owner', 'الرد وإعدادات رسوم التأكيد وطرق الدفع وأرقامه والقوالب (0021-أ P1)');

insert into public.erp_preset_items (preset_key, capability_key) values ('zell.admin_today', 'zell.orders.payments_record');

do $p1grant$
declare
  v_by text := pg_catalog.left(pg_catalog.btrim(pg_catalog.current_setting('zell.approved_by', true)), 120);
  v_before text[];
  r record;
begin
  for r in select a.user_id from public.admin_users a where a.role = 'admin' and a.is_active order by a.user_id loop
    select coalesce(pg_catalog.array_agg(g.capability_key order by g.capability_key), '{}'::text[]) into v_before
      from public.erp_user_grants g where g.user_id = r.user_id;
    insert into public.erp_user_grants (user_id, capability_key, preset_key, granted_by, command_id)
    values (r.user_id, 'zell.orders.payments_record', 'zell.admin_today', null, null);
    insert into public.erp_user_access as ua (user_id, version) values (r.user_id, 1)
    on conflict (user_id) do update set version = ua.version + 1, updated_at = pg_catalog.now();
    insert into public.erp_access_audit (
      source, actor_user_id, target_user_id, operation, subject_key, outcome, code,
      command_id, request_hash, before_keys, after_keys, reason, approved_by)
    select 'migration', null, r.user_id, 'grant', 'zell.orders.payments_record', 'ok', null, null, null, v_before,
           (select pg_catalog.array_agg(k.k order by k.k)
              from pg_catalog.unnest(v_before || array['zell.orders.payments_record']) as k(k)),
           null, v_by;
  end loop;
end
$p1grant$;

-- (5) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE)، زي A1. الأسماء zell_payment_* (مش zell_order_*).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

-- نص اختياري: trim، والفاضي NULL، وحد أقصى. داخلية.
create function public.zell_payment_text(p_value text, p_max integer, p_field text)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  v text := nullif(pg_catalog.btrim(coalesce(p_value, '')), '');
begin
  if v is not null and pg_catalog.char_length(v) > p_max then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = p_field;
  end if;
  return v;
end
$fn$;

-- رقم صحيح من الإعداد بين 1 والحد، وإلا NULL (أي قيمة مش صالحة = كأنها مش موجودة). داخلية.
create function public.zell_payment_cfg_int(p_config jsonb, p_key text, p_max bigint)
returns bigint language sql immutable set search_path = '' as $fn$
  select case when pg_catalog.jsonb_typeof(p_config -> p_key) = 'number' and (p_config ->> p_key) ~ '^[0-9]{1,12}$' then
           case when (p_config ->> p_key)::bigint between 1 and p_max then (p_config ->> p_key)::bigint end
         end
$fn$;

-- رسوم التأكيد (§٣-٣): نفس packages/core/src/confirmationFee.ts بالحرف (CI بيقارن). الأساس total_piastres النهائي.
-- النطاق: all · made_to_measure (فيه صنف بالمقاس) · with_installation · above_amount (total >= الحد).
-- الطريقة: shipping (ولو 0 = البديل) · fixed · percent = ceil(total × bp ÷ 1,000,000) × 100 (لأقرب جنيه لفوق، للنسبة بس).
-- الكل بحد أقصى الإجمالي، وبرّه النطاق أو مقفول = 0.
create function public.zell_payment_fee_calc(p_config jsonb, p_total integer, p_shipping integer,
                                             p_made_to_measure boolean, p_installation boolean)
returns integer language plpgsql immutable set search_path = '' as $fn$
declare
  v_in boolean;
  v_threshold bigint;
  v_fee bigint;
begin
  if p_config is null or pg_catalog.jsonb_typeof(p_config) <> 'object'
     or (p_config -> 'enabled') is distinct from 'true'::jsonb or p_total is null or p_total <= 0 then
    return 0;
  end if;
  v_threshold := public.zell_payment_cfg_int(p_config, 'threshold_piastres', 100000000);
  v_in := case p_config ->> 'scope'
            when 'all' then true
            when 'made_to_measure' then coalesce(p_made_to_measure, false)
            when 'with_installation' then coalesce(p_installation, false)
            when 'above_amount' then coalesce(p_total >= v_threshold, false)
            else false
          end;
  if not v_in then
    return 0;
  end if;
  v_fee := case p_config ->> 'method'
             when 'shipping' then case when coalesce(p_shipping, 0) > 0 then p_shipping::bigint
                                       else public.zell_payment_cfg_int(p_config, 'shipping_fallback_piastres', 100000000) end
             when 'fixed' then public.zell_payment_cfg_int(p_config, 'fixed_piastres', 100000000)
             when 'percent' then ((p_total::bigint * coalesce(public.zell_payment_cfg_int(p_config, 'percent_bp', 10000), 0)
                                   + 999999) / 1000000) * 100
             else 0
           end;
  return least(greatest(coalesce(v_fee, 0), 0), p_total::bigint)::integer;
end
$fn$;

-- تحقق إعداد الرسوم وقت الحفظ (§٣-٣ «مفيش أرقام افتراضية»): بيرجّع الإعداد بشكل موحّد أو 45417 بالحقل.
create function public.zell_payment_validate_fee(p_config jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $fn$
declare
  v_key text;
  v_out jsonb;
  v_n bigint;
  v_enabled boolean;
begin
  if p_config is null or pg_catalog.jsonb_typeof(p_config) <> 'object' then
    raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'confirmation_fee';
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_config) as k loop
    if v_key not in ('enabled', 'scope', 'method', 'percent_bp', 'fixed_piastres', 'shipping_fallback_piastres', 'threshold_piastres') then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'unknown_key';
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_config -> 'enabled') is distinct from 'boolean' then
    raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'enabled';
  end if;
  v_enabled := (p_config ->> 'enabled')::boolean;
  v_out := pg_catalog.jsonb_build_object('enabled', v_enabled);
  if p_config ? 'scope' then
    if pg_catalog.jsonb_typeof(p_config -> 'scope') <> 'string'
       or (p_config ->> 'scope') not in ('all', 'made_to_measure', 'with_installation', 'above_amount') then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'scope';
    end if;
    v_out := v_out || pg_catalog.jsonb_build_object('scope', p_config ->> 'scope');
  end if;
  if p_config ? 'method' then
    if pg_catalog.jsonb_typeof(p_config -> 'method') <> 'string'
       or (p_config ->> 'method') not in ('shipping', 'fixed', 'percent') then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'method';
    end if;
    v_out := v_out || pg_catalog.jsonb_build_object('method', p_config ->> 'method');
  end if;
  foreach v_key in array array['percent_bp', 'fixed_piastres', 'shipping_fallback_piastres', 'threshold_piastres'] loop
    if p_config ? v_key then
      v_n := public.zell_payment_cfg_int(p_config, v_key, case when v_key = 'percent_bp' then 10000 else 100000000 end);
      if v_n is null then
        raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = v_key;
      end if;
      v_out := v_out || pg_catalog.jsonb_build_object(v_key, v_n);
    end if;
  end loop;
  if v_enabled then
    if not v_out ? 'scope' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'scope';
    end if;
    if not v_out ? 'method' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'method';
    end if;
    if v_out ->> 'scope' = 'above_amount' and not v_out ? 'threshold_piastres' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'threshold_piastres';
    end if;
    if v_out ->> 'method' = 'percent' and not v_out ? 'percent_bp' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'percent_bp';
    end if;
    if v_out ->> 'method' = 'fixed' and not v_out ? 'fixed_piastres' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'fixed_piastres';
    end if;
    if v_out ->> 'method' = 'shipping' and not v_out ? 'shipping_fallback_piastres' then
      raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'shipping_fallback_piastres';
    end if;
  end if;
  return v_out;
end
$fn$;

-- الرسوم لطلب جديد من الإعداد الحالي. بيناديها zell_create_order (EXECUTE لمالكها بس). مابتقراش غير الإعداد.
create function public.zell_payment_order_fee(p_total integer, p_shipping integer, p_made_to_measure boolean, p_installation boolean)
returns integer language sql stable security definer set search_path = '' as $fn$
  select public.zell_payment_fee_calc((select s.confirmation_fee from public.zell_payment_settings s where s.id),
                                      p_total, p_shipping, p_made_to_measure, p_installation)
$fn$;

-- قفل صف الطلب (من غير فحص النسخة: الإعادة بنفس المفتاح بتترد قبل الفحص). داخلية.
create function public.zell_payment_lock(p_order_id integer)
returns public.orders language plpgsql set search_path = '' as $fn$
declare
  v_order public.orders;
begin
  if p_order_id is null or p_order_id <= 0 then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'order_id';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  return v_order;
end
$fn$;

-- الملخص (§٣-٢): الحالة مشتقة. paid = total → «مدفوع»، 0 → «مش مدفوع»، غير كده «جزئي»، ومعاها «فيه رد». داخلية.
create function public.zell_payment_summary(p_order_id integer, p_with_rows boolean)
returns jsonb language sql stable set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'ok', true,
           'order_id', o.id,
           'status', o.status,
           'updated_at', o.updated_at,
           'total_piastres', o.total_piastres,
           'paid_piastres', o.paid_piastres,
           'remaining_piastres', o.total_piastres - o.paid_piastres,
           'confirmation_fee_piastres', o.confirmation_fee_piastres,
           'fee_due_piastres', greatest(o.confirmation_fee_piastres - o.paid_piastres, 0),
           'payment_status', case when o.paid_piastres >= o.total_piastres then 'paid'
                                  when o.paid_piastres = 0 then 'unpaid' else 'partial' end,
           'has_refund', exists (select 1 from public.order_payments p where p.order_id = o.id and p.kind = 'refund'),
           'refunded_piastres', coalesce((select pg_catalog.sum(p.amount_piastres) from public.order_payments p
                                           where p.order_id = o.id and p.kind = 'refund'), 0))
         || case when p_with_rows then pg_catalog.jsonb_build_object('payments',
              coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'id', p.id, 'kind', p.kind, 'amount_piastres', p.amount_piastres, 'purpose', p.purpose,
                                 'method_id', p.method_id, 'method_name', p.method_name, 'method_is_other', p.method_is_other,
                                 'reference', p.reference, 'note', p.note, 'actor', p.actor,
                                 'paid_after_piastres', p.paid_after_piastres, 'created_at', p.created_at) order by p.id)
                          from public.order_payments p where p.order_id = o.id), '[]'::jsonb))
                 else '{}'::jsonb end
    from public.orders o where o.id = p_order_id
$fn$;

-- قيد دفعة أو رد على طلب مقفول: التحقق + الصف + المدفوع + الحدث، في نفس المعاملة. داخلية.
create function public.zell_payment_apply(p_kind text, p_order public.orders, p_actor uuid, p_command_id uuid, p_hash text,
                                          p_amount integer, p_purpose text, p_method_id integer, p_method_other text,
                                          p_reference text, p_note text)
returns bigint language plpgsql set search_path = '' as $fn$
declare
  v_other text := public.zell_payment_text(p_method_other, 60, 'method_other');
  v_reference text := public.zell_payment_text(p_reference, 100, 'reference');
  v_note text := public.zell_payment_text(p_note, 300, 'note');
  v_name text;
  v_paid integer;
  v_id bigint;
begin
  if p_kind is null or p_kind not in ('payment', 'refund') then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'kind';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'amount_piastres';
  end if;
  if p_purpose is null or p_purpose not in ('confirmation_fee', 'balance') then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'purpose';
  end if;
  if (p_method_id is null) = (v_other is null) then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'method';
  end if;
  if p_method_id is not null then
    select m.name into v_name from public.zell_payment_methods m where m.id = p_method_id and not m.is_archived;
    if v_name is null then
      raise exception 'ZELL_PAY_METHOD_UNAVAILABLE' using errcode = '45428';
    end if;
  else
    v_name := v_other;
  end if;
  if p_kind = 'payment' then
    if p_order.status in ('cancelled', 'refused') then
      raise exception 'ZELL_PAY_NOT_ALLOWED_IN_STATUS' using errcode = '45422';
    end if;
    if p_order.paid_piastres::bigint + p_amount > p_order.total_piastres then
      raise exception 'ZELL_PAY_EXCEEDS_TOTAL' using errcode = '45423';
    end if;
    v_paid := p_order.paid_piastres + p_amount;
  else
    if p_amount > p_order.paid_piastres then
      raise exception 'ZELL_PAY_REFUND_EXCEEDS_PAID' using errcode = '45424';
    end if;
    v_paid := p_order.paid_piastres - p_amount;
  end if;
  begin
    insert into public.order_payments (order_id, kind, amount_piastres, purpose, method_id, method_name, method_is_other,
                                       reference, note, actor, command_id, request_hash, paid_after_piastres)
    values (p_order.id, p_kind, p_amount, p_purpose, p_method_id, v_name, p_method_id is null,
            v_reference, v_note, p_actor, p_command_id, p_hash, v_paid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ZELL_PAY_COMMAND_REUSED' using errcode = '45425';
  end;
  update public.orders set paid_piastres = v_paid, updated_at = pg_catalog.now() where id = p_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (p_order.id, case when p_kind = 'payment' then 'payment_recorded' else 'payment_refunded' end, p_actor,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'payment_id', v_id, 'amount_piastres', p_amount, 'purpose', p_purpose, 'method', v_name,
            'reference', v_reference, 'paid_after_piastres', v_paid)));
  return v_id;
end
$fn$;

-- دفعة أو رد بـ idempotency: نفس command_id بنفس العملية والطلب والممثل والبصمة = لقطة النتيجة الأصلية (replay)،
-- وأي اختلاف = 45425. البصمة بتتحسب بعد التطبيع (zell_payment_text زي zell_payment_apply)، فنفس المعنى بمسافات = replay.
-- الإعادة بتتفحص بعد قفل الطلب وقبل فحص النسخة والحالة. الأمر بيتسجّل آخر حاجة، فأي فشل مابيسيبش أمر. داخلية.
create function public.zell_payment_entry(p_kind text, p_owner_only boolean, p_command_id uuid, p_order_id integer,
                                          p_expected_updated_at timestamptz, p_amount integer, p_purpose text,
                                          p_method_id integer, p_method_other text, p_reference text, p_note text)
returns jsonb language plpgsql set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(p_owner_only);
  v_hash text;
  v_order public.orders;
  v_cmd public.zell_payment_commands;
  v_id bigint;
  v_result jsonb;
begin
  if p_command_id is null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'command_id';
  end if;
  v_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
              'op', p_kind, 'order_id', p_order_id, 'amount_piastres', p_amount, 'purpose', p_purpose,
              'method_id', p_method_id, 'method_other', public.zell_payment_text(p_method_other, 60, 'method_other'),
              'reference', public.zell_payment_text(p_reference, 100, 'reference'),
              'note', public.zell_payment_text(p_note, 300, 'note'))::text);
  v_order := public.zell_payment_lock(p_order_id);
  -- نفس command_id على طلبين في نفس اللحظة: التاني بيستنى هنا وبعدين بياخد 45425 (مش خطأ تكرار مفتاح).
  perform pg_catalog.pg_advisory_xact_lock(45425, pg_catalog.hashtext(p_command_id::text));
  select c.* into v_cmd from public.zell_payment_commands c where c.command_id = p_command_id;
  if found then
    if v_cmd.operation = p_kind and v_cmd.order_id = p_order_id and v_cmd.actor = v_actor and v_cmd.request_hash = v_hash then
      return v_cmd.result || pg_catalog.jsonb_build_object('replay', true);
    end if;
    raise exception 'ZELL_PAY_COMMAND_REUSED' using errcode = '45425';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_order.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  v_id := public.zell_payment_apply(p_kind, v_order, v_actor, p_command_id, v_hash, p_amount, p_purpose,
                                    p_method_id, p_method_other, p_reference, p_note);
  v_result := public.zell_payment_summary(p_order_id, false) || pg_catalog.jsonb_build_object('replay', false, 'payment_id', v_id);
  insert into public.zell_payment_commands (command_id, operation, order_id, actor, request_hash, result)
  values (p_command_id, p_kind, p_order_id, v_actor, v_hash, v_result);
  return v_result;
end
$fn$;

create function public.zell_payment_settings_json()
returns jsonb language sql stable set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'confirmation_fee', s.confirmation_fee, 'customer_credit_enabled', s.customer_credit_enabled,
           'payment_numbers', s.payment_numbers, 'fee_policy', s.fee_policy, 'whatsapp_template', s.whatsapp_template,
           'updated_at', s.updated_at)
    from public.zell_payment_settings s where s.id
$fn$;

create function public.zell_payment_methods_json()
returns jsonb language sql stable set search_path = '' as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'id', m.id, 'name', m.name, 'sort_order', m.sort_order, 'is_archived', m.is_archived,
                    'used', exists (select 1 from public.order_payments p where p.method_id = m.id),
                    'updated_at', m.updated_at) order by m.is_archived, m.sort_order, m.id), '[]'::jsonb)
    from public.zell_payment_methods m
$fn$;

-- (5-ب) الدوال العامة (EXECUTE لـ authenticated بس): الهوية من الجلسة (zell_order_actor من A1)، ومفيش معامل للممثل.

-- تسجيل دفعة: الأدمن والمالك (س١٢).
create function public.zell_payment_record(p_command_id uuid, p_order_id integer, p_expected_updated_at timestamptz,
                                           p_amount_piastres integer, p_purpose text, p_method_id integer default null,
                                           p_method_other text default null, p_reference text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
begin
  return public.zell_payment_entry('payment', false, p_command_id, p_order_id, p_expected_updated_at, p_amount_piastres,
                                   p_purpose, p_method_id, p_method_other, p_reference, p_note);
end
$fn$;

-- الرد (قيد عكسي): المالك بس.
create function public.zell_payment_refund(p_command_id uuid, p_order_id integer, p_expected_updated_at timestamptz,
                                           p_amount_piastres integer, p_purpose text, p_method_id integer default null,
                                           p_method_other text default null, p_reference text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
begin
  return public.zell_payment_entry('refund', true, p_command_id, p_order_id, p_expected_updated_at, p_amount_piastres,
                                   p_purpose, p_method_id, p_method_other, p_reference, p_note);
end
$fn$;

-- التسليم (§٣-٤): التحصيل اختياري في نفس المعاملة، والباقي لازم يبقى صفر، إلا لو الآجل متفعّل والاختيار صريح (p_on_credit).
create function public.zell_payment_deliver_order(p_command_id uuid, p_order_id integer, p_expected_updated_at timestamptz,
                                                  p_amount_piastres integer default null, p_method_id integer default null,
                                                  p_method_other text default null, p_reference text default null,
                                                  p_note text default null, p_on_credit boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_hash text;
  v_order public.orders;
  v_cmd public.zell_payment_commands;
  v_id bigint;
  v_credit boolean;
  v_on_credit boolean := false;
  v_result jsonb;
begin
  if p_command_id is null or p_on_credit is null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'command_id';
  end if;
  v_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
              'op', 'deliver', 'order_id', p_order_id, 'amount_piastres', p_amount_piastres, 'method_id', p_method_id,
              'method_other', public.zell_payment_text(p_method_other, 60, 'method_other'),
              'reference', public.zell_payment_text(p_reference, 100, 'reference'),
              'note', public.zell_payment_text(p_note, 300, 'note'), 'on_credit', p_on_credit)::text);
  v_order := public.zell_payment_lock(p_order_id);
  -- الإعادة زي zell_payment_entry: بعد القفل وقبل النسخة والحالة، واللقطة الأصلية حتى لو الطلب اتغيّر بعد التسليم.
  perform pg_catalog.pg_advisory_xact_lock(45425, pg_catalog.hashtext(p_command_id::text));
  select c.* into v_cmd from public.zell_payment_commands c where c.command_id = p_command_id;
  if found then
    if v_cmd.operation = 'deliver' and v_cmd.order_id = p_order_id and v_cmd.actor = v_actor and v_cmd.request_hash = v_hash then
      return v_cmd.result || pg_catalog.jsonb_build_object('replay', true);
    end if;
    raise exception 'ZELL_PAY_COMMAND_REUSED' using errcode = '45425';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_order.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_amount_piastres is not null then
    v_id := public.zell_payment_apply('payment', v_order, v_actor, p_command_id, v_hash, p_amount_piastres, 'balance',
                                      p_method_id, p_method_other, p_reference, p_note);
    select o.* into v_order from public.orders o where o.id = p_order_id;
  elsif p_method_id is not null or p_method_other is not null or p_reference is not null or p_note is not null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'amount_piastres';
  end if;
  if v_order.paid_piastres < v_order.total_piastres then
    if not p_on_credit then
      raise exception 'ZELL_PAY_BALANCE_DUE' using errcode = '45420';
    end if;
    select s.customer_credit_enabled into v_credit from public.zell_payment_settings s where s.id;
    if not coalesce(v_credit, false) then
      raise exception 'ZELL_PAY_CREDIT_DISABLED' using errcode = '45421';
    end if;
    v_on_credit := true;
    perform pg_catalog.set_config('zell.payment_credit_order', p_order_id::text, true);
  end if;
  perform public.zell_order_apply_transition(v_order, 'delivered', v_actor, case when v_on_credit then 'تسليم آجل' end);
  perform pg_catalog.set_config('zell.payment_credit_order', '', true);
  v_result := public.zell_payment_summary(p_order_id, false)
              || pg_catalog.jsonb_build_object('replay', false, 'payment_id', v_id, 'on_credit', v_on_credit);
  insert into public.zell_payment_commands (command_id, operation, order_id, actor, request_hash, result)
  values (p_command_id, 'deliver', p_order_id, v_actor, v_hash, v_result);
  return v_result;
end
$fn$;

create function public.zell_payment_order_summary(p_order_id integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
  v_r jsonb;
begin
  if p_order_id is null or p_order_id <= 0 then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'order_id';
  end if;
  v_r := public.zell_payment_summary(p_order_id, true);
  if v_r is null then
    raise exception 'ZELL_ORD_NOT_FOUND' using errcode = '45403';
  end if;
  return v_r;
end
$fn$;

-- طرق الدفع (§٣-٥): القراية للأدمن والمالك، والإدارة للمالك بس.
create function public.zell_payment_list_methods()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return public.zell_payment_methods_json();
end
$fn$;

create function public.zell_payment_add_method(p_name text, p_sort_order integer default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_name text := public.zell_payment_text(p_name, 60, 'name');
  v_sort integer;
  v_id integer;
begin
  if v_name is null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'name';
  end if;
  if p_sort_order is not null and (p_sort_order < 0 or p_sort_order > 100000) then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'sort_order';
  end if;
  v_sort := coalesce(p_sort_order, (select coalesce(pg_catalog.max(m.sort_order), 0) + 10 from public.zell_payment_methods m));
  if v_sort > 100000 then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'sort_order';
  end if;
  begin
    insert into public.zell_payment_methods (name, sort_order) values (v_name, v_sort) returning id into v_id;
  exception when unique_violation then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'name_taken';
  end;
  insert into public.zell_payment_config_log (kind, actor, old_value, new_value)
  values ('method_add', v_actor, null, pg_catalog.jsonb_build_object('id', v_id, 'name', v_name, 'sort_order', v_sort));
  return public.zell_payment_methods_json();
end
$fn$;

-- تعديل الاسم والترتيب والأرشفة/الرجوع في نداء واحد (بفحص النسخة).
create function public.zell_payment_update_method(p_id integer, p_expected_updated_at timestamptz, p_name text,
                                                  p_sort_order integer, p_is_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_name text := public.zell_payment_text(p_name, 60, 'name');
  v_old public.zell_payment_methods;
  v_now timestamptz := pg_catalog.now();
begin
  if p_id is null or v_name is null or p_sort_order is null or p_sort_order < 0 or p_sort_order > 100000 or p_is_archived is null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'method';
  end if;
  select m.* into v_old from public.zell_payment_methods m where m.id = p_id for update;
  if not found then
    raise exception 'ZELL_PAY_METHOD_UNAVAILABLE' using errcode = '45428';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_old.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  begin
    update public.zell_payment_methods
       set name = v_name, sort_order = p_sort_order, is_archived = p_is_archived, updated_at = v_now
     where id = p_id;
  exception when unique_violation then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'name_taken';
  end;
  insert into public.zell_payment_config_log (kind, actor, old_value, new_value)
  values ('method_update', v_actor,
          pg_catalog.jsonb_build_object('id', v_old.id, 'name', v_old.name, 'sort_order', v_old.sort_order, 'is_archived', v_old.is_archived),
          pg_catalog.jsonb_build_object('id', p_id, 'name', v_name, 'sort_order', p_sort_order, 'is_archived', p_is_archived));
  return public.zell_payment_methods_json();
end
$fn$;

-- الحذف النهائي بس لو الطريقة مااتستخدمتش في أي دفعة (غير كده أرشفة).
create function public.zell_payment_delete_method(p_id integer, p_expected_updated_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_old public.zell_payment_methods;
begin
  if p_id is null then
    raise exception 'ZELL_PAY_INVALID_INPUT' using errcode = '45416', detail = 'method';
  end if;
  select m.* into v_old from public.zell_payment_methods m where m.id = p_id for update;
  if not found then
    raise exception 'ZELL_PAY_METHOD_UNAVAILABLE' using errcode = '45428';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_old.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if exists (select 1 from public.order_payments p where p.method_id = p_id) then
    raise exception 'ZELL_PAY_METHOD_IN_USE' using errcode = '45426';
  end if;
  delete from public.zell_payment_methods where id = p_id;
  insert into public.zell_payment_config_log (kind, actor, old_value, new_value)
  values ('method_delete', v_actor,
          pg_catalog.jsonb_build_object('id', v_old.id, 'name', v_old.name, 'sort_order', v_old.sort_order, 'is_archived', v_old.is_archived),
          null);
  return public.zell_payment_methods_json();
end
$fn$;

-- الإعدادات: القراية للأدمن والمالك (الرسالة والأرقام)، والحفظ للمالك بس بالتحقق الكامل.
create function public.zell_payment_get_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return public.zell_payment_settings_json();
end
$fn$;

create function public.zell_payment_save_settings(p_expected_updated_at timestamptz, p_confirmation_fee jsonb,
                                                  p_customer_credit_enabled boolean, p_payment_numbers text default null,
                                                  p_fee_policy text default null, p_whatsapp_template text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_numbers text := public.zell_payment_text(p_payment_numbers, 1000, 'payment_numbers');
  v_policy text := public.zell_payment_text(p_fee_policy, 1000, 'fee_policy');
  v_template text := public.zell_payment_text(p_whatsapp_template, 2000, 'whatsapp_template');
  v_old jsonb;
  v_updated timestamptz;
  v_fee jsonb;
begin
  select s.updated_at into v_updated from public.zell_payment_settings s where s.id for update;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_updated) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_customer_credit_enabled is null then
    raise exception 'ZELL_PAY_SETTINGS_INVALID' using errcode = '45417', detail = 'customer_credit_enabled';
  end if;
  v_fee := public.zell_payment_validate_fee(p_confirmation_fee);
  v_old := public.zell_payment_settings_json();
  update public.zell_payment_settings
     set confirmation_fee = v_fee, customer_credit_enabled = p_customer_credit_enabled, payment_numbers = v_numbers,
         fee_policy = v_policy, whatsapp_template = v_template, updated_at = pg_catalog.now(), updated_by = v_actor
   where id;
  insert into public.zell_payment_config_log (kind, actor, old_value, new_value)
  values ('settings', v_actor, v_old, public.zell_payment_settings_json());
  return public.zell_payment_settings_json();
end
$fn$;

-- (6) دالة الانتقال (A1، داخلية): نفس النص + قاعدتين (قرارات ٢ و٤). CREATE OR REPLACE = نفس المالك والصلاحيات.
create or replace function public.zell_order_apply_transition(p_order public.orders, p_to text, p_actor uuid, p_reason text)
returns timestamptz language plpgsql set search_path = '' as $fn$
declare
  v_gate text;
  v_open boolean := public.zell_order_gate_is_open();
  v_now timestamptz := pg_catalog.now();
  v_money record;
begin
  if p_to is null or p_to not in ('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'refused') then
    raise exception 'ZELL_ORD_INVALID_INPUT' using errcode = '45408';
  end if;
  select t.gate into v_gate from public.order_status_transitions t
   where t.from_status = p_order.status and t.to_status = p_to;
  if v_gate is null or (v_gate = 'closed' and v_open) then
    raise exception 'ZELL_ORD_TRANSITION_NOT_ALLOWED' using errcode = '45405';
  end if;
  if v_gate = 'open' and not v_open then
    raise exception 'ZELL_ORD_GATE_CLOSED' using errcode = '45406';
  end if;
  -- 0021-A P1: المقدم قبل التأكيد والتجهيز (قرار ٢)، والباقي قبل التسليم إلا بالآجل الصريح من zell_payment_deliver_order (قرار ٤).
  select o.paid_piastres, o.total_piastres, o.confirmation_fee_piastres into v_money
    from public.orders o where o.id = p_order.id;
  if p_to in ('confirmed', 'preparing') and v_money.paid_piastres < v_money.confirmation_fee_piastres then
    raise exception 'ZELL_PAY_DEPOSIT_REQUIRED' using errcode = '45419';
  end if;
  if p_to = 'delivered' and v_money.paid_piastres < v_money.total_piastres
     and not (coalesce(pg_catalog.current_setting('zell.payment_credit_order', true), '') = p_order.id::text
              and coalesce((select s.customer_credit_enabled from public.zell_payment_settings s where s.id), false)) then
    raise exception 'ZELL_PAY_BALANCE_DUE' using errcode = '45420';
  end if;
  update public.orders set status = p_to, updated_at = v_now where id = p_order.id;
  insert into public.order_events (order_id, kind, actor, payload)
  values (p_order.id, 'status_changed', p_actor,
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('from', p_order.status, 'to', p_to, 'reason', p_reason)));
  return v_now;
end
$fn$;

-- (7) EXECUTE: الكل مسحوب، وبعدين: العامة الـ 10 لـ authenticated، والرسوم لمالك zell_create_order و postgres.
revoke all on function
  public.zell_payment_text(text, integer, text), public.zell_payment_cfg_int(jsonb, text, bigint),
  public.zell_payment_fee_calc(jsonb, integer, integer, boolean, boolean), public.zell_payment_validate_fee(jsonb),
  public.zell_payment_order_fee(integer, integer, boolean, boolean), public.zell_payment_lock(integer),
  public.zell_payment_summary(integer, boolean),
  public.zell_payment_apply(text, public.orders, uuid, uuid, text, integer, text, integer, text, text, text),
  public.zell_payment_entry(text, boolean, uuid, integer, timestamptz, integer, text, integer, text, text, text),
  public.zell_payment_settings_json(), public.zell_payment_methods_json(),
  public.zell_payment_record(uuid, integer, timestamptz, integer, text, integer, text, text, text),
  public.zell_payment_refund(uuid, integer, timestamptz, integer, text, integer, text, text, text),
  public.zell_payment_deliver_order(uuid, integer, timestamptz, integer, integer, text, text, text, boolean),
  public.zell_payment_order_summary(integer), public.zell_payment_list_methods(),
  public.zell_payment_add_method(text, integer), public.zell_payment_update_method(integer, timestamptz, text, integer, boolean),
  public.zell_payment_delete_method(integer, timestamptz), public.zell_payment_get_settings(),
  public.zell_payment_save_settings(timestamptz, jsonb, boolean, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.zell_payment_record(uuid, integer, timestamptz, integer, text, integer, text, text, text),
  public.zell_payment_refund(uuid, integer, timestamptz, integer, text, integer, text, text, text),
  public.zell_payment_deliver_order(uuid, integer, timestamptz, integer, integer, text, text, text, boolean),
  public.zell_payment_order_summary(integer), public.zell_payment_list_methods(),
  public.zell_payment_add_method(text, integer), public.zell_payment_update_method(integer, timestamptz, text, integer, boolean),
  public.zell_payment_delete_method(integer, timestamptz), public.zell_payment_get_settings(),
  public.zell_payment_save_settings(timestamptz, jsonb, boolean, text, text, text)
  to authenticated;
grant execute on function public.zell_payment_fee_calc(jsonb, integer, integer, boolean, boolean),
  public.zell_payment_validate_fee(jsonb), public.zell_payment_cfg_int(jsonb, text, bigint),
  public.zell_payment_order_fee(integer, integer, boolean, boolean) to postgres;
do $p1exec$
declare
  v_owner text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner) into strict v_owner from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)');
  if v_owner <> 'postgres' then
    execute pg_catalog.format('grant execute on function public.zell_payment_order_fee(integer, integer, boolean, boolean) to %I', v_owner);
  end if;
end
$p1exec$;

reset role;
revoke create on schema public from zell_order_definer;

-- (8) zell_create_order (§٦-١): من التعريف الحي بعد D (البصمة في الـ preflight)، والفرق الوحيد عمود الرسوم.
--     CREATE OR REPLACE بنفس التوقيع = نفس المالك والصلاحيات وprosecdef. الإجمالي وكل الحسابات زي ما هي بالحرف.
CREATE OR REPLACE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text DEFAULT NULL::text, p_installation boolean DEFAULT false, p_coupon_code text DEFAULT NULL::text, p_preferred_delivery jsonb DEFAULT NULL::jsonb)
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
          confirmation_fee_piastres
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
                                        s.shipping::integer, s.has_mtm, v_install)
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

-- (9) postflight
do $p1post$
declare
  v_list text;
  v_oid oid := pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)');
begin
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24 then
    raise exception 'ZELL_0021A_P1_POST_FUNCTIONS';
  end if;
  select pg_catalog.string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%'
     and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prosecdef;
  if v_list is distinct from 'zell_payment_add_method,zell_payment_delete_method,zell_payment_deliver_order,zell_payment_get_settings,'
                             || 'zell_payment_list_methods,zell_payment_order_summary,zell_payment_record,zell_payment_refund,'
                             || 'zell_payment_save_settings,zell_payment_update_method' then
    raise exception 'ZELL_0021A_P1_POST_EXECUTE %', v_list;
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%'
                and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                     or (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') and not p.prosecdef))) then
    raise exception 'ZELL_0021A_P1_POST_EXECUTE_OTHER';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%'
            and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 11 then
    raise exception 'ZELL_0021A_P1_POST_A1';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') <> 1
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_oid) <> '811d4d573d750db9c7e5164799536aa6'
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege(
              (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_oid),
              'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE') then
    raise exception 'ZELL_0021A_P1_POST_CREATE_ORDER';
  end if;
  if (select count(*) from public.erp_capabilities) <> 31
     or (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') <> 23
     or exists (select 1 from public.admin_users a
                 where a.role = 'admin' and a.is_active
                   and not exists (select 1 from public.erp_user_grants g
                                    where g.user_id = a.user_id and g.capability_key = 'zell.orders.payments_record')) then
    raise exception 'ZELL_0021A_P1_POST_CATALOG';
  end if;
  if (select count(*) from public.zell_payment_settings) <> 1
     or (select count(*) from public.zell_payment_methods) <> 4
     or exists (select 1 from public.zell_payment_settings s
                 where s.confirmation_fee <> '{"enabled": false}'::jsonb or s.customer_credit_enabled) then
    raise exception 'ZELL_0021A_P1_POST_SETTINGS';
  end if;
  if exists (select 1 from public.orders o where o.paid_piastres <> 0 or o.confirmation_fee_piastres <> 0) then
    raise exception 'ZELL_0021A_P1_POST_ORDERS';
  end if;
  if pg_catalog.to_regclass('public.zell_payment_commands') is null then
    raise exception 'ZELL_0021A_P1_POST_COMMANDS';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass('public.zell_payment_commands'))
     or pg_catalog.has_table_privilege('anon', 'public.zell_payment_commands', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.zell_payment_commands', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.zell_payment_commands', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or exists (select 1 from public.zell_payment_commands) then
    raise exception 'ZELL_0021A_P1_POST_COMMANDS';
  end if;
end
$p1post$;
-- <<< 0021A_P1 BODY
commit;
