-- 0021-D2 W1 — اختبار قبل التطبيق (smoke على Production) لـ 0021d2_delivery_settings.sql
--
-- • قبل التطبيق بس، وإلا ZELL_0021D2_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. مفيش حفظ ولا كتابة في السجل (الحالات الكبيرة في CI: 0021d2_flows.sql).
-- • المتوقع: PASS بـ 6 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0021d2';

do $zguard$
begin
  if pg_catalog.to_regclass('public.zell_delivery_settings') is not null
     or pg_catalog.to_regclass('public.zell_delivery_settings_log') is not null
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()') is not null then
    raise exception 'ZELL_0021D2_PTEST_PRE_APPLY_ONLY';
  end if;
  perform pg_catalog.set_config('zell.ptest_co_md5',
    coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.oid) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), ''), true);
  perform pg_catalog.set_config('zell.ptest_periods_md5',
    coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
               where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()')), ''), true);
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
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

do $zT$
declare
  v_get oid := pg_catalog.to_regprocedure('public.zell_delivery_settings_get()');
  v_save oid := pg_catalog.to_regprocedure('public.zell_delivery_settings_save(timestamptz, boolean, boolean, text)');
  v_chk oid := pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()');
  v_res text;
begin
  perform pg_temp.zt('T01 objects: 2 tables (postgres, RLS on), 3 functions (zell_order_definer, definer, empty search_path), 4 guard triggers',
    (select count(*) from pg_catalog.pg_class c
      where c.oid in (pg_catalog.to_regclass('public.zell_delivery_settings'), pg_catalog.to_regclass('public.zell_delivery_settings_log'))
        and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres' and c.relrowsecurity) = 2
    and (select count(*) from pg_catalog.pg_proc p
          where p.oid in (v_get, v_save, v_chk) and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer'
            and p.prosecdef and p.proconfig = array['search_path=""']) = 3
    and (select count(*) from pg_catalog.pg_trigger g
          where g.tgrelid in (pg_catalog.to_regclass('public.zell_delivery_settings'), pg_catalog.to_regclass('public.zell_delivery_settings_log'))
            and not g.tgisinternal and g.tgenabled = 'O') = 4, null);
  v_res := pg_temp.call_as('service_role', 'select public.zell_checkout_delivery_settings()::text');
  perform pg_temp.zt('T02 values = current behaviour: choice on, no note, empty log; service_role checkout read agrees',
    (select s.customer_choice_enabled and not s.note_enabled and s.note_text is null from public.zell_delivery_settings s where s.id)
    and (select count(*) from public.zell_delivery_settings_log) = 0
    and v_res not like 'ERR%' and v_res <> 'null'
    and v_res = '{"note": null, "customer_choice_enabled": true}', v_res);
  perform pg_temp.zt('T03 EXECUTE: get/save authenticated only · checkout service_role only · anon nothing',
    pg_catalog.has_function_privilege('authenticated', v_get, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_chk, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', v_chk, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_get, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_get, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_save, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_chk, 'EXECUTE')
    and pg_temp.call_as('anon', 'select public.zell_checkout_delivery_settings()::text') = 'ERR 42501', null);
  perform pg_temp.zt('T04 tables: no privileges for anon/authenticated/service_role; policies for zell_order_definer only',
    not exists (select 1
                  from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                       (values ('public.zell_delivery_settings'), ('public.zell_delivery_settings_log')) t(n)
                 where pg_catalog.has_table_privilege(r.n, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    and (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename in ('zell_delivery_settings', 'zell_delivery_settings_log')
            and p.roles = array['zell_order_definer']::name[]) = 2
    and not exists (select 1 from pg_catalog.pg_policies p
                     where p.schemaname = 'public' and p.tablename in ('zell_delivery_settings', 'zell_delivery_settings_log')
                       and p.roles <> array['zell_order_definer']::name[]), null);
  perform pg_temp.zt('T05 identity live: get / save without a session -> 45400, nothing written',
    pg_temp.call_as('authenticated', 'select public.zell_delivery_settings_get()::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated',
          'select public.zell_delivery_settings_save(now(), false, true, ' || pg_catalog.quote_literal('ptest') || ')::text') = 'ERR 45400'
    and (select count(*) from public.zell_delivery_settings_log) = 0, null);
  perform pg_temp.zt('T06 nothing else touched: zell_create_order + checkout periods bodies, 24 zell_order_*, 24 zell_payment_*, no CREATE for the definer',
    coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.oid) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), '')
      = pg_catalog.current_setting('zell.ptest_co_md5')
    and coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                   where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()')), '')
      = pg_catalog.current_setting('zell.ptest_periods_md5')
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
    and (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
    and not pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE'), null);
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 6 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
