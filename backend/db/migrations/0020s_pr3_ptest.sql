-- 0020-S PR-3 — اختبار قبل التطبيق (pre-apply ptest) لـ 0020s_pr3_revoke_service_role.sql
--
-- • قبل التطبيق بس: 0020-S PR-1 متطبّق، و service_role لسه عنده EXECUTE على الـ 23 القديمة. غير كده بيقف بـ
--   ZELL_0020S3_PTEST_PRE_APPLY_ONLY. بعد التطبيق: 0020s_inv_session_verify.sql (المرحلة pr3).
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد في الآخر (0021p_txn_shape.py في CI).
-- • جسم الـ migration منسوخ بالحرف بين علامات >>> و <<< (md5 في CI).
-- • ملفين تشغيل: production (الافتراضي) و ci. الـ skip المتوقع في production: P06 دايمًا (كتابة = CI بس)، و P07 لو مفيش أدمن شغال.
-- • الأثر على Production: قراية بس (مفيش كتابة ومفيش sequences). ⚠ تشغيله على Production محتاج موافقة منفصلة.

begin;
set local idle_in_transaction_session_timeout = '30s';
set local zell.ptest_profile = 'production';

do $zguard$
begin
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') <> 23
     or not exists (select 1 from pg_catalog.pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                       and p.proname not like 'zell\_inv\_session\_%'
                       and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception 'ZELL_0020S3_PTEST_PRE_APPLY_ONLY';
  end if;
  if pg_catalog.current_setting('zell.ptest_profile', true) not in ('production', 'ci') then
    raise exception 'ZELL_0020S3_PTEST_PROFILE';
  end if;
  if not pg_catalog.pg_has_role('postgres', 'authenticated', 'SET') or not pg_catalog.pg_has_role('postgres', 'anon', 'SET')
     or not pg_catalog.pg_has_role('postgres', 'service_role', 'SET')
     or not pg_catalog.pg_has_role('postgres', 'zell_inventory_definer', 'SET') then
    raise exception 'ZELL_0020S3_PTEST_CALLER_MODEL';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zt_fx (owner_id uuid, admin_id uuid) on commit drop;
create temporary table zt_expect (expected text[], owners_active integer, admins_active integer) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end,
          left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_skip(p_name text, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, 'skip', left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values ('ABORT_' || p_block, 'ABORT_' || p_block || ' block raised an unexpected error', 'fail',
          left(coalesce(p_state, '') || ' ' || coalesce(p_message, ''), 400));
$f$;

-- نداء زي PostgREST: claims نص خام ('' = من غير جلسة) + دور الداتابيز. أي خطأ بيرجع {_error, _message}.
create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated')
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    execute 'set local role ' || quote_ident(p_db_role);
    execute p_sql into r;
    execute 'reset role';
    perform pg_catalog.set_config('request.jwt.claims', '', true);
  exception when others then
    return jsonb_build_object('_error', sqlstate, '_message', left(sqlerrm, 200));
  end;
  return r;
end
$f$;

create function pg_temp.ok(p jsonb)
returns boolean language sql as $f$
  select p is not null and not (jsonb_typeof(p) = 'object' and p ? '_error');
$f$;

do $zfx$
declare
  v_ci boolean := pg_catalog.current_setting('zell.ptest_profile', true) = 'ci';
  v_o uuid;
  v_a uuid;
  v_no integer;
  v_na integer;
begin
  select count(*) filter (where u.role = 'owner' and u.is_active), count(*) filter (where u.role = 'admin' and u.is_active)
    into v_no, v_na from public.admin_users u;
  select u.user_id into v_o from public.admin_users u where u.role = 'owner' and u.is_active order by u.created_at, u.user_id limit 1;
  select u.user_id into v_a from public.admin_users u where u.role = 'admin' and u.is_active order by u.created_at, u.user_id limit 1;
  if v_o is null then
    raise exception 'ZELL_0020S3_PTEST_FIXTURE';
  end if;
  insert into pg_temp.zt_fx values (v_o, v_a);
  insert into pg_temp.zt_expect values (case when v_ci then array[]::text[] when v_a is null then array['P06', 'P07'] else array['P06'] end, v_no, v_na);
end
$zfx$;

-- >>> 0020S3 BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- الـ 23 دالة العامة القديمة (بـ p_actor).
create temporary table zell_0020s3_old (old_sig text primary key) on commit drop;
insert into pg_temp.zell_0020s3_old (old_sig) values
  ('public.zell_inv_create_location(uuid, uuid, text, text)'),
  ('public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)'),
  ('public.zell_inv_create_supplier(uuid, uuid, text, text, text)'),
  ('public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)'),
  ('public.zell_inv_create_purchase(uuid, uuid, jsonb)'),
  ('public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)'),
  ('public.zell_inv_post_purchase(uuid, uuid, bigint, integer)'),
  ('public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)'),
  ('public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)'),
  ('public.zell_inv_create_opening(uuid, uuid, jsonb)'),
  ('public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)'),
  ('public.zell_inv_post_opening(uuid, uuid, bigint, integer)'),
  ('public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)'),
  ('public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)'),
  ('public.zell_inv_list_locations(uuid, boolean, integer, bigint)'),
  ('public.zell_inv_list_suppliers(uuid, boolean, integer, text)'),
  ('public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)'),
  ('public.zell_inv_get_purchase(uuid, bigint)'),
  ('public.zell_inv_preview_purchase(uuid, jsonb)'),
  ('public.zell_inv_list_openings(uuid, text, integer, bigint)'),
  ('public.zell_inv_get_opening(uuid, bigint)'),
  ('public.zell_inv_preview_opening(uuid, jsonb)'),
  ('public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)');

-- بصمة كل دوال zell_inv_% (67): التوقيع + md5 الجسم + المالك + الأمان + التقلب + الإعدادات، والـ ACL لكل دالة ماعدا الـ 23 القديمة
-- (هي بس اللي الـ ACL بتاعها بيتغيّر هنا).
create or replace function pg_temp.zell_0020s3_fp()
returns text
language sql
stable
as $f$
  select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || p.proowner::regrole::text
                                 || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(p.proconfig::text, '')
                                 || ':' || case when p.oid in (select pg_catalog.to_regprocedure(o.old_sig) from pg_temp.zell_0020s3_old o)
                                                then '' else coalesce(p.proacl::text, '') end,
                                 ',' order by p.oid::regprocedure::text), ''))
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%';
$f$;

-- (1) preflight
do $zs3_pre$
declare
  v_n integer;
  v_bad text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020S3_WRONG_CALLER';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0020S3_SERVER_VERSION';
  end if;
  if pg_catalog.to_regrole('zell_inventory_definer') is null
     or not pg_catalog.pg_has_role('postgres', 'zell_inventory_definer', 'SET') then
    raise exception 'ZELL_0020S3_DEFINER';
  end if;
  -- 0020-S PR-1 لازم يكون متطبّق بالكامل (والجلسة هي الطريق الوحيد بعد الملف ده).
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') <> 23
     or pg_catalog.to_regprocedure('public.zell_inv_claims_actor()') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 67 then
    raise exception 'ZELL_0020S3_NEEDS_0020S';
  end if;
  if exists (select 1 from pg_temp.zell_0020s3_old o where pg_catalog.to_regprocedure(o.old_sig) is null) then
    raise exception 'ZELL_0020S3_OLD_MISSING';
  end if;
  select count(*) into v_n from pg_temp.zell_0020s3_old o
   where pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE');
  if v_n = 0 then
    raise exception 'ZELL_0020S3_ALREADY_APPLIED';
  end if;
  if v_n <> 23 then
    raise exception 'ZELL_0020S3_PARTIAL';
  end if;
  -- الـ ACL المباشر للقديمة = المالك + service_role بالظبط (زي 0020)، وauthenticated و anon مالهمش.
  select string_agg(o.old_sig, ',') into v_bad
    from pg_temp.zell_0020s3_old o
   where (select array_agg(distinct a.grantee order by a.grantee)
            from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
           where p.oid = pg_catalog.to_regprocedure(o.old_sig))
         is distinct from (select array_agg(g order by g)
                             from unnest(array['zell_inventory_definer'::regrole::oid, 'service_role'::regrole::oid]) g)
      or pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE');
  if v_bad is not null then
    raise exception 'ZELL_0020S3_OLD_ACL %', left(v_bad, 120);
  end if;
end
$zs3_pre$;

create temporary table zell_0020s3_fp_before (fp text not null) on commit drop;
insert into pg_temp.zell_0020s3_fp_before (fp) values (pg_temp.zell_0020s3_fp());

-- (2) سحب EXECUTE من service_role على الـ 23 القديمة. الـ grant اتعمل من zell_inventory_definer في 0020،
--     فالسحب بيتعمل بنفس الدور (SET LOCAL ROLE). مفيش أي تغيير تاني: لا أجسام ولا دوال جديدة ولا grants تانية.
set local role zell_inventory_definer;
revoke execute on function public.zell_inv_create_location(uuid, uuid, text, text) from service_role;
revoke execute on function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) from service_role;
revoke execute on function public.zell_inv_create_supplier(uuid, uuid, text, text, text) from service_role;
revoke execute on function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) from service_role;
revoke execute on function public.zell_inv_create_purchase(uuid, uuid, jsonb) from service_role;
revoke execute on function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) from service_role;
revoke execute on function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) from service_role;
revoke execute on function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) from service_role;
revoke execute on function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) from service_role;
revoke execute on function public.zell_inv_create_opening(uuid, uuid, jsonb) from service_role;
revoke execute on function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) from service_role;
revoke execute on function public.zell_inv_post_opening(uuid, uuid, bigint, integer) from service_role;
revoke execute on function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) from service_role;
revoke execute on function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) from service_role;
revoke execute on function public.zell_inv_list_locations(uuid, boolean, integer, bigint) from service_role;
revoke execute on function public.zell_inv_list_suppliers(uuid, boolean, integer, text) from service_role;
revoke execute on function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) from service_role;
revoke execute on function public.zell_inv_get_purchase(uuid, bigint) from service_role;
revoke execute on function public.zell_inv_preview_purchase(uuid, jsonb) from service_role;
revoke execute on function public.zell_inv_list_openings(uuid, text, integer, bigint) from service_role;
revoke execute on function public.zell_inv_get_opening(uuid, bigint) from service_role;
revoke execute on function public.zell_inv_preview_opening(uuid, jsonb) from service_role;
revoke execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) from service_role;
reset role;

-- (3) postflight
do $zs3_post$
declare
  v_bad text;
  v_definer oid := 'zell_inventory_definer'::regrole;
begin
  if (select b.fp from pg_temp.zell_0020s3_fp_before b) is distinct from pg_temp.zell_0020s3_fp() then
    raise exception 'ZELL_0020S3_FP_CHANGED';
  end if;
  -- القديمة داخلية: الـ ACL المباشر = المالك بس، ومفيش EXECUTE فعلي لأي دور من التلاتة، والمالك لسه يقدر (الدوال الجديدة بتناديها).
  select string_agg(o.old_sig, ',') into v_bad
    from pg_temp.zell_0020s3_old o
   where (select array_agg(distinct a.grantee)
            from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
           where p.oid = pg_catalog.to_regprocedure(o.old_sig)) is distinct from array[v_definer]
      or pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
      or not pg_catalog.has_function_privilege('zell_inventory_definer', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE');
  if v_bad is not null then
    raise exception 'ZELL_0020S3_OLD_ACL_POST %', left(v_bad, 120);
  end if;
  -- مفيش أي zell_inv_% فاضل لـ service_role.
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception 'ZELL_0020S3_SERVICE_ROLE_LEFT';
  end if;
end
$zs3_post$;

notify pgrst, 'reload schema';
-- <<< 0020S3 BODY

do $zP$
declare
  v_o uuid;
  v_a uuid;
  v_c text;
  v_n integer;
  v_bad text := '';
  m record;
  r jsonb;
  r_old jsonb;
begin
  select f.owner_id, f.admin_id into v_o, v_a from pg_temp.zt_fx f;
  v_c := jsonb_build_object('sub', v_o, 'role', 'authenticated')::text;

  select count(*) into v_n
    from pg_temp.zell_0020s3_old o
   where (select array_agg(distinct a.grantee) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
           where p.oid = pg_catalog.to_regprocedure(o.old_sig)) = array['zell_inventory_definer'::regrole::oid]
     and not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
     and not pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')
     and pg_catalog.has_function_privilege('zell_inventory_definer', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE');
  perform pg_temp.zt('P01 old 23: owner-only ACL, no EXECUTE for service_role / authenticated / anon, owner still can', v_n = 23, v_n::text);

  select count(*) into v_n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%'
     and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.zt('P02 session 23 unchanged: authenticated only; claims_actor still internal',
    v_n = 23 and not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.zell_inv_claims_actor()'), 'EXECUTE')
             and not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.zell_inv_claims_actor()'), 'EXECUTE'),
    v_n::text);

  perform pg_temp.zt('P03 fingerprint of all 67 (bodies, owners, config; ACL except the old 23) unchanged',
    (select b.fp from pg_temp.zell_0020s3_fp_before b) = pg_temp.zell_0020s3_fp(), '');

  for m in
    select o.old_sig,
           'select ' || pg_catalog.to_regprocedure(o.old_sig)::text || '' as sig,
           (select 'select ' || split_part(o.old_sig, '(', 1) || '(' || string_agg('null::' || pg_catalog.format_type(u.t, null), ', ' order by u.o) || ')'
              from pg_catalog.pg_proc p cross join lateral unnest(p.proargtypes::oid[]) with ordinality as u(t, o)
             where p.oid = pg_catalog.to_regprocedure(o.old_sig)) as call_old
      from pg_temp.zell_0020s3_old o
  loop
    r := pg_temp.as_user('', m.call_old, 'service_role');
    if r ->> '_error' is distinct from '42501' then v_bad := v_bad || split_part(m.old_sig, '(', 1) || '=' || coalesce(r ->> '_error', 'ok') || ' '; end if;
  end loop;
  perform pg_temp.zt('P04 service_role on each old function -> 42501 (all 23)', v_bad = '', v_bad);

  v_bad := '';
  for m in
    select * from (values
      ('list_locations', 'true, 50, null'),
      ('list_suppliers', 'true, 50, null'),
      ('list_purchases', 'null, null, 50, null'),
      ('list_openings', 'null, 50, null'),
      ('list_lots', '''active'', null, null, 50, null')) as v(fn, args)
  loop
    r := pg_temp.as_user(v_c, 'select public.zell_inv_session_' || m.fn || '(' || m.args || ')');
    r_old := pg_temp.as_user('', format('select public.zell_inv_%s(%L::uuid, %s)', m.fn, v_o, m.args), 'zell_inventory_definer');
    if not (pg_temp.ok(r) and r = r_old) then
      v_bad := v_bad || m.fn || '=' || left(coalesce(r ->> '_error', r::text, 'null'), 40) || ' ';
    end if;
  end loop;
  perform pg_temp.zt('P05 owner session reads still work and = old function (called as its owner)', v_bad = '', v_bad);

  if pg_catalog.current_setting('zell.ptest_profile', true) <> 'ci' then
    perform pg_temp.zt_skip('P06 owner session write (create_supplier) still works', 'CI only (no writes on Production)');
  else
    r := pg_temp.as_user(v_c, format('select public.zell_inv_session_create_supplier(%L::uuid, %L, null, null)', gen_random_uuid(), 'مورد اختبار PR-3'));
    perform pg_temp.zt('P06 owner session write (create_supplier) still works', pg_temp.ok(r) and r ? 'supplierId', r::text);
  end if;

  if v_a is null then
    perform pg_temp.zt_skip('P07 active admin (not owner) via session -> 45200', 'no active admin');
  else
    r := pg_temp.as_user(jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, 'select public.zell_inv_session_list_locations(true, 50, null)');
    perform pg_temp.zt('P07 active admin (not owner) via session -> 45200', r ->> '_error' = '45200', r::text);
  end if;

  r := pg_temp.as_user('', 'select public.zell_inv_session_list_locations(true, 50, null)');
  perform pg_temp.zt('P08 no session -> 45200', r ->> '_error' = '45200', r::text);
  r := pg_temp.as_user('', 'select public.zell_inv_session_list_locations(true, 50, null)', 'service_role');
  perform pg_temp.zt('P09 service_role on session function -> 42501 (unchanged)', r ->> '_error' = '42501', r::text);
exception when others then
  perform pg_temp.zt_block_fail('P', sqlstate, sqlerrm);
end
$zP$;

-- أعمدة psql -tA: 1 ord · 2 kind · 7 profile · 8 pass · 9 fail · 10 skip · 11 verdict · 12 active_owners · 13 active_admins
--   14 expected_skips · 15 actual_skips
with r as (
  select * from pg_temp.zt_results
), c as (
  select count(*) filter (where r.outcome = 'pass') as pass_n,
         count(*) filter (where r.outcome = 'fail') as fail_n,
         count(*) filter (where r.outcome = 'skip') as skip_n
    from r
), a as (
  select array(select r.id from r where r.outcome = 'skip' order by r.id collate "C") as actual
), e as (
  select x.expected, x.owners_active, x.admins_active from pg_temp.zt_expect x
)
select 0::integer as ord,
       'summary'::text as kind,
       null::text as test_id,
       null::text as test_name,
       null::text as outcome,
       null::text as detail,
       pg_catalog.current_setting('zell.ptest_profile', true) as profile,
       c.pass_n as pass,
       c.fail_n as fail,
       c.skip_n as skip,
       case when c.fail_n = 0 and c.pass_n > 0 and a.actual = e.expected then 'PASS' else 'FAIL' end as verdict,
       e.owners_active as active_owners,
       e.admins_active as active_admins,
       array_to_string(e.expected, ',') as expected_skips,
       array_to_string(a.actual, ',') as actual_skips
  from c, a, e
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail,
       null::text, null::bigint, null::bigint, null::bigint, null::text, null::integer, null::integer, null::text, null::text
  from r
order by 1;

rollback;
