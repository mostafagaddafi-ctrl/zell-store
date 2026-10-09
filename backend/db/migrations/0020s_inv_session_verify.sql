-- 0020-S — التحقق بعد التطبيق (post-apply verification) لـ 0020s_inv_session.sql (المرحلة: PR-1)
--
-- • من غير أي DDL على الداتابيز (جداول ودوال مؤقتة بس)، ومن غير أي كتابة. المعاملة بترجع دايمًا.
-- • الـ catalog: العدد · مفيش overload · شكل كل دالة جديدة · الـ ACL المباشر والفعلي · دالة الهوية داخلية ·
--   الدوال القديمة: مالكها وصلاحية service_role زي ما هي (لحد PR-3) · CREATE للدور على public = false.
-- • السلوك (قراية بس): من غير جلسة = 45200 · أدمن مش مالك = 45200 · claim role غير authenticated = 45200 ·
--   service_role = 42501 · المالك: list_locations بالجلسة = الطريق القديم.
-- • النتيجة صفوف في SELECT واحد في الآخر (صف ملخص + صف لكل فحص). الـ skip المتوقع: V09 لو مفيش أدمن شغال.
-- • old_fp في الملخص = بصمة دوال 0020 القديمة (43)، ولازم تساوي اللي قبل التطبيق (استعلام الأثر).
-- • المرحلة بتتحسب من الـ catalog: pr1 (service_role لسه على الـ 23 القديمة) · pr3 (ولا واحدة، بعد 0020s_pr3_revoke_service_role.sql)
--   · mixed = FAIL. V05 و V08 و V12 بيتوقعوا حسب المرحلة.

begin;
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '15s';

create temporary table zv_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zv_fx (owner_id uuid, admin_id uuid, owners_active integer, admins_active integer, expected text[], stage text) on commit drop;
create temporary table zv_map (old_name text primary key, new_name text not null, old_sig text not null, new_sig text not null) on commit drop;

insert into pg_temp.zv_map (old_name, new_name, old_sig, new_sig) values
  ('zell_inv_create_location', 'zell_inv_session_create_location', 'public.zell_inv_create_location(uuid, uuid, text, text)', 'public.zell_inv_session_create_location(uuid, text, text)'),
  ('zell_inv_update_location', 'zell_inv_session_update_location', 'public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)', 'public.zell_inv_session_update_location(uuid, bigint, integer, text, boolean)'),
  ('zell_inv_create_supplier', 'zell_inv_session_create_supplier', 'public.zell_inv_create_supplier(uuid, uuid, text, text, text)', 'public.zell_inv_session_create_supplier(uuid, text, text, text)'),
  ('zell_inv_update_supplier', 'zell_inv_session_update_supplier', 'public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)', 'public.zell_inv_session_update_supplier(uuid, bigint, integer, text, text, text, boolean)'),
  ('zell_inv_create_purchase', 'zell_inv_session_create_purchase', 'public.zell_inv_create_purchase(uuid, uuid, jsonb)', 'public.zell_inv_session_create_purchase(uuid, jsonb)'),
  ('zell_inv_update_purchase', 'zell_inv_session_update_purchase', 'public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)', 'public.zell_inv_session_update_purchase(uuid, bigint, integer, jsonb)'),
  ('zell_inv_post_purchase', 'zell_inv_session_post_purchase', 'public.zell_inv_post_purchase(uuid, uuid, bigint, integer)', 'public.zell_inv_session_post_purchase(uuid, bigint, integer)'),
  ('zell_inv_discard_purchase', 'zell_inv_session_discard_purchase', 'public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_discard_purchase(uuid, bigint, integer, text)'),
  ('zell_inv_void_purchase', 'zell_inv_session_void_purchase', 'public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_void_purchase(uuid, bigint, integer, text)'),
  ('zell_inv_create_opening', 'zell_inv_session_create_opening', 'public.zell_inv_create_opening(uuid, uuid, jsonb)', 'public.zell_inv_session_create_opening(uuid, jsonb)'),
  ('zell_inv_update_opening', 'zell_inv_session_update_opening', 'public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)', 'public.zell_inv_session_update_opening(uuid, bigint, integer, jsonb)'),
  ('zell_inv_post_opening', 'zell_inv_session_post_opening', 'public.zell_inv_post_opening(uuid, uuid, bigint, integer)', 'public.zell_inv_session_post_opening(uuid, bigint, integer)'),
  ('zell_inv_discard_opening', 'zell_inv_session_discard_opening', 'public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_discard_opening(uuid, bigint, integer, text)'),
  ('zell_inv_void_opening', 'zell_inv_session_void_opening', 'public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)', 'public.zell_inv_session_void_opening(uuid, bigint, integer, text)'),
  ('zell_inv_list_locations', 'zell_inv_session_list_locations', 'public.zell_inv_list_locations(uuid, boolean, integer, bigint)', 'public.zell_inv_session_list_locations(boolean, integer, bigint)'),
  ('zell_inv_list_suppliers', 'zell_inv_session_list_suppliers', 'public.zell_inv_list_suppliers(uuid, boolean, integer, text)', 'public.zell_inv_session_list_suppliers(boolean, integer, text)'),
  ('zell_inv_list_purchases', 'zell_inv_session_list_purchases', 'public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)', 'public.zell_inv_session_list_purchases(text, bigint, integer, bigint)'),
  ('zell_inv_get_purchase', 'zell_inv_session_get_purchase', 'public.zell_inv_get_purchase(uuid, bigint)', 'public.zell_inv_session_get_purchase(bigint)'),
  ('zell_inv_preview_purchase', 'zell_inv_session_preview_purchase', 'public.zell_inv_preview_purchase(uuid, jsonb)', 'public.zell_inv_session_preview_purchase(jsonb)'),
  ('zell_inv_list_openings', 'zell_inv_session_list_openings', 'public.zell_inv_list_openings(uuid, text, integer, bigint)', 'public.zell_inv_session_list_openings(text, integer, bigint)'),
  ('zell_inv_get_opening', 'zell_inv_session_get_opening', 'public.zell_inv_get_opening(uuid, bigint)', 'public.zell_inv_session_get_opening(bigint)'),
  ('zell_inv_preview_opening', 'zell_inv_session_preview_opening', 'public.zell_inv_preview_opening(uuid, jsonb)', 'public.zell_inv_session_preview_opening(jsonb)'),
  ('zell_inv_list_lots', 'zell_inv_session_list_lots', 'public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)', 'public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint)');

create function pg_temp.zv(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zv_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end,
          left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.zv_skip(p_name text, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zv_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, 'skip', left(coalesce(p_detail, ''), 400));
$f$;

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

create function pg_temp.old_fp()
returns text language sql stable as $f$
  select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || p.proowner::regrole::text
                                 || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || p.provolatile::text
                                 || ':' || coalesce(p.proconfig::text, ''), ',' order by p.oid::regprocedure::text), ''))
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
     and p.proname not like 'zell\_inv\_session\_%' and p.proname <> 'zell_inv_claims_actor';
$f$;

do $zv_fx$
declare
  v_o uuid;
  v_a uuid;
  v_no integer;
  v_na integer;
  v_svc integer;
begin
  select count(*) filter (where u.role = 'owner' and u.is_active), count(*) filter (where u.role = 'admin' and u.is_active)
    into v_no, v_na from public.admin_users u;
  select u.user_id into v_o from public.admin_users u where u.role = 'owner' and u.is_active order by u.created_at, u.user_id limit 1;
  select u.user_id into v_a from public.admin_users u where u.role = 'admin' and u.is_active order by u.created_at, u.user_id limit 1;
  select count(*) into v_svc from pg_temp.zv_map m
   where pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE');
  insert into pg_temp.zv_fx values (v_o, v_a, v_no, v_na, case when v_a is null then array['V09'] else array[]::text[] end,
                                    case v_svc when 23 then 'pr1' when 0 then 'pr3' else 'mixed' end);
end
$zv_fx$;

do $zv_catalog$
declare
  v_n integer;
  v_bad text;
  v_definer oid := pg_catalog.to_regrole('zell_inventory_definer');
  v_auth oid := pg_catalog.to_regrole('authenticated');
  v_claims oid := pg_catalog.to_regprocedure('public.zell_inv_claims_actor()');
  v_stage text := (select f.stage from pg_temp.zv_fx f);
begin
  perform pg_temp.zv('V01 23 zell_inv_session_* + zell_inv_claims_actor, zell_inv_% = 67, no overload',
    (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') = 23
    and v_claims is not null
    and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') = 67
    and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                     group by p.proname having count(*) > 1),
    (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')::text);

  select string_agg(m.new_name, ',') into v_bad
    from pg_temp.zv_map m
   where not exists (
     select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_proc o on o.oid = pg_catalog.to_regprocedure(m.old_sig)
      where p.oid = pg_catalog.to_regprocedure(m.new_sig)
        and p.proowner = v_definer and p.prosecdef and p.provolatile = o.provolatile
        and p.prorettype = 'jsonb'::regtype and not p.proretset
        and p.proconfig = array['search_path=""']::text[]
        and pg_catalog.pg_get_function_identity_arguments(p.oid)
            = pg_catalog.regexp_replace(pg_catalog.pg_get_function_identity_arguments(o.oid), '^p_actor uuid(, )?', '')
        and pg_catalog.strpos(p.prosrc, 'public.' || m.old_name || '(public.zell_inv_claims_actor()') > 0
        and p.prosrc !~ 'erp_');
  perform pg_temp.zv('V02 each session fn: owner · definer · search_path · volatility = old · args = old minus p_actor · calls old with session actor',
    v_bad is null, v_bad);

  select string_agg(m.new_name, ',') into v_bad
    from pg_temp.zv_map m
   where (select array_agg(distinct a.grantee order by a.grantee)
            from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
           where p.oid = pg_catalog.to_regprocedure(m.new_sig))
         is distinct from (select array_agg(g order by g) from unnest(array[v_definer, v_auth]) g)
      or exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                  where p.oid = pg_catalog.to_regprocedure(m.new_sig) and a.privilege_type <> 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.new_sig), 'EXECUTE');
  perform pg_temp.zv('V03 session ACL: owner + authenticated EXECUTE only; anon / service_role none', v_bad is null, v_bad);

  perform pg_temp.zv('V04 zell_inv_claims_actor: internal (invoker, stable, search_path), no EXECUTE for authenticated / anon / service_role',
    exists (select 1 from pg_catalog.pg_proc p
             where p.oid = v_claims and p.proowner = v_definer and not p.prosecdef and p.provolatile = 's'
               and p.proconfig = array['search_path=""']::text[] and p.proacl is not null)
    and (select array_agg(distinct a.grantee) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
          where p.oid = v_claims) = array[v_definer]
    and not pg_catalog.has_function_privilege('authenticated', v_claims, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_claims, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_claims, 'EXECUTE'), '');

  select string_agg(m.old_name, ',') into v_bad
    from pg_temp.zv_map m
   where not exists (select 1 from pg_catalog.pg_proc p
                      where p.oid = pg_catalog.to_regprocedure(m.old_sig) and p.proowner = v_definer and p.prosecdef)
      or pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE') is distinct from (v_stage = 'pr1')
      or pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(m.old_sig), 'EXECUTE')
      or (v_stage = 'pr3' and (select array_agg(distinct a.grantee) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                               where p.oid = pg_catalog.to_regprocedure(m.old_sig)) is distinct from array[v_definer]);
  perform pg_temp.zv('V05 old 23 by stage (pr1: EXECUTE service_role only · pr3: owner-only ACL, internal)',
    v_stage in ('pr1', 'pr3') and v_bad is null, 'stage=' || coalesce(v_stage, 'null') || ' ' || coalesce(v_bad, ''));

  perform pg_temp.zv('V06 zell_inventory_definer has no CREATE on public',
    not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE'), '');
exception when others then
  perform pg_temp.zv('V00 catalog block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zv_catalog$;

do $zv_behavior$
declare
  v_o uuid;
  v_a uuid;
  r jsonb;
  r_old jsonb;
  v_stage text;
begin
  select f.owner_id, f.admin_id, f.stage into v_o, v_a, v_stage from pg_temp.zv_fx f;
  r := pg_temp.as_user('', 'select public.zell_inv_session_list_locations(true, 50, null)');
  perform pg_temp.zv('V07 no session -> 45200', r ->> '_error' = '45200', r::text);
  r := pg_temp.as_user(jsonb_build_object('sub', v_o, 'role', 'authenticated')::text, 'select public.zell_inv_session_list_locations(true, 50, null)');
  r_old := pg_temp.as_user('', format('select public.zell_inv_list_locations(%L::uuid, true, 50, null)', v_o),
                           case when v_stage = 'pr3' then 'zell_inventory_definer' else 'service_role' end);
  perform pg_temp.zv('V08 owner session list_locations = old function (pr1: service_role · pr3: its owner)',
    v_o is not null and r is not null and not (r ? '_error') and r = r_old, left(coalesce(r::text, 'null'), 200));
  if v_a is null then
    perform pg_temp.zv_skip('V09 active admin (not owner) -> 45200', 'no active admin');
  else
    r := pg_temp.as_user(jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, 'select public.zell_inv_session_list_locations(true, 50, null)');
    perform pg_temp.zv('V09 active admin (not owner) -> 45200', r ->> '_error' = '45200', r::text);
  end if;
  r := pg_temp.as_user(jsonb_build_object('sub', v_o, 'role', 'anon')::text, 'select public.zell_inv_session_list_locations(true, 50, null)');
  perform pg_temp.zv('V10 owner sub with claim role anon -> 45200', r ->> '_error' = '45200', r::text);
  r := pg_temp.as_user('', 'select public.zell_inv_session_list_locations(true, 50, null)', 'service_role');
  perform pg_temp.zv('V11 service_role on session function -> 42501', r ->> '_error' = '42501', r::text);
  r := pg_temp.as_user('', format('select public.zell_inv_list_locations(%L::uuid, true, 50, null)', v_o), 'service_role');
  if v_stage = 'pr3' then
    perform pg_temp.zv('V12 service_role on old function -> 42501 (pr3)', r ->> '_error' = '42501', r::text);
  else
    perform pg_temp.zv('V12 service_role on old function still works (pr1)', r is not null and not (r ? '_error'), left(coalesce(r::text, 'null'), 200));
  end if;
exception when others then
  perform pg_temp.zv('V00 behavior block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zv_behavior$;

-- أعمدة psql -tA: 1 ord · 2 kind · 7 stage · 8 pass · 9 fail · 10 skip · 11 verdict · 12 active_owners · 13 active_admins
--   14 expected_skips · 15 actual_skips · 16 old_fp
with r as (
  select * from pg_temp.zv_results
), c as (
  select count(*) filter (where r.outcome = 'pass') as pass_n,
         count(*) filter (where r.outcome = 'fail') as fail_n,
         count(*) filter (where r.outcome = 'skip') as skip_n
    from r
), a as (
  select array(select r.id from r where r.outcome = 'skip' order by r.id collate "C") as actual
)
select 0::integer as ord,
       'summary'::text as kind,
       null::text as check_id,
       null::text as check_name,
       null::text as outcome,
       null::text as detail,
       f.stage as stage,
       c.pass_n as pass,
       c.fail_n as fail,
       c.skip_n as skip,
       case when c.fail_n = 0 and c.pass_n + c.skip_n = 12 and a.actual = f.expected and f.stage in ('pr1', 'pr3') then 'PASS' else 'FAIL' end as verdict,
       f.owners_active as active_owners,
       f.admins_active as active_admins,
       array_to_string(f.expected, ',') as expected_skips,
       array_to_string(a.actual, ',') as actual_skips,
       pg_temp.old_fp() as old_fp
  from c, a, pg_temp.zv_fx f
union all
select r.n, 'check', r.id, r.name, r.outcome, r.detail,
       null::text, null::bigint, null::bigint, null::bigint, null::text, null::integer, null::integer, null::text, null::text, null::text
  from r
order by 1;

rollback;
