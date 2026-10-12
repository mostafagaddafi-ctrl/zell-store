-- 0021-D2 W1 — تحكم المالك في موعد التسليم في Checkout (SQL بس)
--
-- العقد: docs/contracts/0021-D2.md (§٢-١ الإعداد · §٢-٢ الدوال · §٣ الأكواد · §٤ الرجوع · §٦ W1).
--   • جدول صف واحد zell_delivery_settings (العميل يختار الموعد · إظهار السطر · نص السطر ≤ 300) + سجل append-only
--     zell_delivery_settings_log. القيم وقت التطبيق = السلوك الحالي (العميل بيختار، ومفيش سطر)، فالتطبيق مابيغيّرش حاجة للعميل.
--   • 3 دوال مالكها zell_order_definer (security definer، search_path فاضي):
--       zell_delivery_settings_get()   — أي أدمن شغّال، EXECUTE لـ authenticated.
--       zell_delivery_settings_save(…) — المالك بس، EXECUTE لـ authenticated. النسخة 45404، والتحقق 45430 بالحقل.
--       zell_checkout_delivery_settings() — للمتجر، EXECUTE لـ service_role بس.
--   • مفيش أي تعديل في zell_create_order ولا zell_checkout_delivery_periods ولا الإيصال، والأسماء برّه عدّادات
--     zell_order_* (24) و zell_payment_* (24).
--   • الأكواد: 45430 جديد (الـ preflight بيرفض لو مستخدم في أي دالة) · 45404 و 45413 و 45400–45402 من A1.
-- بعد A1 و D و P1 و P2 (الـ preflight بيتأكد). الرجوع: 0021d2_delivery_settings_rollback.sql — بعد revert كود W2،
--   وبيرفض بعد أول سطر في السجل (forward-fix بس).
-- التحقق: 0021d2_delivery_settings_verify.sql · الاختبار قبل التطبيق: 0021d2_delivery_settings_ptest.sql ·
-- CI: backend/db/ci/0021d2_sql_ci.sh + backend/db/ci/0021d2_flows.sql
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0021d2-delivery-settings';
--   (التاريخ = يوم التطبيق الفعلي؛ من غيره ZELL_0021D2_APPROVAL_MISSING)
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، قبل نشر كود W2.

begin;
-- >>> 0021D2 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: الموافقة · المتطلبات (A1 · D · P1 · P2) · مش متطبّق قبل كده · الكود 45430 مش مستخدم في أي دالة.
do $d2pre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021D2_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021D2_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24 then
    raise exception 'ZELL_0021D2_PREREQ_MISSING';
  end if;
  if pg_catalog.to_regclass('public.zell_delivery_settings') is not null
     or pg_catalog.to_regclass('public.zell_delivery_settings_log') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('zell_delivery_settings_get', 'zell_delivery_settings_save',
                                     'zell_checkout_delivery_settings', 'zell_delivery_settings_trg_append_only')) then
    raise exception 'ZELL_0021D2_ALREADY_APPLIED';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.prosrc like '%45430%') then
    raise exception 'ZELL_0021D2_CODE_TAKEN';
  end if;
end
$d2pre$;

-- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و authenticated و service_role.
--     القيم وقت التطبيق = السلوك الحالي: العميل بيختار الموعد، ومفيش سطر (العقد §٢-١، ر٤).
create table public.zell_delivery_settings (
  id                      boolean not null default true constraint zell_delivery_settings_pkey primary key
                          constraint zell_delivery_settings_single check (id),
  customer_choice_enabled boolean not null,
  note_enabled            boolean not null,
  note_text               text,
  updated_at              timestamptz not null default pg_catalog.now(),
  updated_by              uuid,
  constraint zell_delivery_settings_note_text_shape check (
    note_text is null
    or (note_text = pg_catalog.btrim(note_text, E' \t\r\n') and pg_catalog.char_length(note_text) between 1 and 300)),
  constraint zell_delivery_settings_note_needs_text check (not note_enabled or note_text is not null)
);
insert into public.zell_delivery_settings (id, customer_choice_enabled, note_enabled, note_text)
values (true, true, false, null);

create table public.zell_delivery_settings_log (
  id         bigint generated always as identity constraint zell_delivery_settings_log_pkey primary key,
  actor      uuid not null,
  old_value  jsonb not null,
  new_value  jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);

revoke all on table public.zell_delivery_settings, public.zell_delivery_settings_log
  from public, anon, authenticated, service_role;
revoke all on sequence public.zell_delivery_settings_log_id_seq from public, anon, authenticated, service_role;
grant select, update on table public.zell_delivery_settings to zell_order_definer;
grant select, insert on table public.zell_delivery_settings_log to zell_order_definer;
alter table public.zell_delivery_settings enable row level security;
alter table public.zell_delivery_settings_log enable row level security;
create policy zell_order_definer_all on public.zell_delivery_settings
  for all to zell_order_definer using (true) with check (true);
create policy zell_order_definer_all on public.zell_delivery_settings_log
  for all to zell_order_definer using (true) with check (true);

-- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة الـ trigger مالكها
--     postgres (invoker). نفس كود A1 للسجل (45413).
create function public.zell_delivery_settings_trg_append_only()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  raise exception 'ZELL_DELIVERY_SETTINGS_APPEND_ONLY' using errcode = '45413';
end
$fn$;
revoke all on function public.zell_delivery_settings_trg_append_only() from public, anon, authenticated, service_role;

create trigger zell_delivery_settings_log_immutable before update or delete on public.zell_delivery_settings_log
  for each row execute function public.zell_delivery_settings_trg_append_only();
create trigger zell_delivery_settings_log_no_truncate before truncate on public.zell_delivery_settings_log
  for each statement execute function public.zell_delivery_settings_trg_append_only();
create trigger zell_delivery_settings_no_delete before delete on public.zell_delivery_settings
  for each row execute function public.zell_delivery_settings_trg_append_only();
create trigger zell_delivery_settings_no_truncate before truncate on public.zell_delivery_settings
  for each statement execute function public.zell_delivery_settings_trg_append_only();

-- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و zell_payment_* (ر٥).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

-- قراية الإعداد للوحة: أي أدمن شغّال (zell_order_actor(false)).
create function public.zell_delivery_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(false);
begin
  return (
    select pg_catalog.jsonb_build_object(
             'customer_choice_enabled', s.customer_choice_enabled,
             'note_enabled', s.note_enabled,
             'note_text', s.note_text,
             'updated_at', s.updated_at)
      from public.zell_delivery_settings s where s.id);
end
$fn$;

-- الحفظ: المالك بس (45402 من zell_order_actor). النسخة (45404) قبل التحقق (45430 بالحقل في detail).
-- التطبيع: trim للمسافات والتاب والسطور، والفاضي NULL (من غير NFC، زي P1). الحفظ من غير تغيير مابيكتبش سطر ولا بيغيّر النسخة.
create function public.zell_delivery_settings_save(p_expected_updated_at timestamptz, p_customer_choice_enabled boolean,
                                                   p_note_enabled boolean, p_note_text text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_row public.zell_delivery_settings;
  v_text text := nullif(pg_catalog.btrim(coalesce(p_note_text, ''), E' \t\r\n'), '');
  v_old jsonb;
  v_new jsonb;
  v_changed boolean;
begin
  select s.* into v_row from public.zell_delivery_settings s where s.id for update;
  if not found or p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_row.updated_at) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_ORD_CONFLICT' using errcode = '45404';
  end if;
  if p_customer_choice_enabled is null then
    raise exception 'ZELL_DELIVERY_SETTINGS_INVALID' using errcode = '45430', detail = 'customer_choice_enabled';
  end if;
  if p_note_enabled is null then
    raise exception 'ZELL_DELIVERY_SETTINGS_INVALID' using errcode = '45430', detail = 'note_enabled';
  end if;
  if (v_text is not null and pg_catalog.char_length(v_text) > 300) or (p_note_enabled and v_text is null) then
    raise exception 'ZELL_DELIVERY_SETTINGS_INVALID' using errcode = '45430', detail = 'note_text';
  end if;
  v_old := pg_catalog.jsonb_build_object('customer_choice_enabled', v_row.customer_choice_enabled,
                                         'note_enabled', v_row.note_enabled, 'note_text', v_row.note_text);
  v_new := pg_catalog.jsonb_build_object('customer_choice_enabled', p_customer_choice_enabled,
                                         'note_enabled', p_note_enabled, 'note_text', v_text);
  v_changed := v_new is distinct from v_old;
  if v_changed then
    update public.zell_delivery_settings s
       set customer_choice_enabled = p_customer_choice_enabled,
           note_enabled = p_note_enabled,
           note_text = v_text,
           updated_at = pg_catalog.now(),
           updated_by = v_actor
     where s.id
    returning s.* into v_row;
    insert into public.zell_delivery_settings_log (actor, old_value, new_value) values (v_actor, v_old, v_new);
  end if;
  return pg_catalog.jsonb_build_object(
           'customer_choice_enabled', v_row.customer_choice_enabled,
           'note_enabled', v_row.note_enabled,
           'note_text', v_row.note_text,
           'updated_at', v_row.updated_at,
           'changed', v_changed);
end
$fn$;

-- قراية الإعداد للمتجر (Checkout و /api/orders): service_role بس، زي zell_checkout_delivery_periods.
-- السطر بيرجع بس لو note_enabled، وإلا null.
create function public.zell_checkout_delivery_settings()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'customer_choice_enabled', s.customer_choice_enabled,
           'note', case when s.note_enabled then s.note_text end)
    from public.zell_delivery_settings s where s.id
$fn$;

revoke all on function public.zell_delivery_settings_get(),
  public.zell_delivery_settings_save(timestamptz, boolean, boolean, text),
  public.zell_checkout_delivery_settings()
  from public, anon, authenticated, service_role;
grant execute on function public.zell_delivery_settings_get(),
  public.zell_delivery_settings_save(timestamptz, boolean, boolean, text) to authenticated;
grant execute on function public.zell_checkout_delivery_settings() to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (4) postflight
do $d2post$
declare
  v_get oid := pg_catalog.to_regprocedure('public.zell_delivery_settings_get()');
  v_save oid := pg_catalog.to_regprocedure('public.zell_delivery_settings_save(timestamptz, boolean, boolean, text)');
  v_chk oid := pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()');
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
                       (values ('public.zell_delivery_settings'), ('public.zell_delivery_settings_log')) t(n)
                 where pg_catalog.has_table_privilege(r.n, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n)
                 where pg_catalog.has_sequence_privilege(r.n, 'public.zell_delivery_settings_log_id_seq', 'USAGE,SELECT,UPDATE'))
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE')
     or (select count(*) from public.zell_delivery_settings) <> 1
     or not exists (select 1 from public.zell_delivery_settings s
                     where s.id and s.customer_choice_enabled and not s.note_enabled and s.note_text is null)
     or (select count(*) from public.zell_delivery_settings_log) <> 0
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24 then
    raise exception 'ZELL_0021D2_POST_SHAPE';
  end if;
end
$d2post$;
-- <<< 0021D2 BODY
commit;
