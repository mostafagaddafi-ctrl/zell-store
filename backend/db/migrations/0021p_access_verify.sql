-- 0021-P — التحقق بعد التطبيق (post-apply verification) لـ 0021p_erp_access.sql + 0021p_zell_erp_access.sql
--
-- • قراءة بس: catalog + نداءات قراءة. مفيش DDL ولا كتابة (ولا حتى جداول مؤقتة)، والمعاملة بترجع دايمًا.
-- • بيتأكد من: الأدوار وشكل العضوية · الجداول وRLS والصلاحيات · ملكية الدوال · الحد العام (authenticated على ١٢
--   دالة محوّل بالظبط، وservice_role و anon صفر، ودوال المحرك كلها داخلية) · الواجهة (المالك والخصائص والنتيجة) ·
--   الـ triggers · العدّاد = العدد الفعلي · القائمة والقوالب · المطابقة (strict بعد التطبيق مباشرة، أو info بعد كده).
-- • النداءات بتتعمل بجلسة مالك مُحاكاة (claims محلية جوه المعاملة)، زي ما PostgREST بيعمل.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، ومفيش COMMIT/END/PREPARE (الـ CI بيفحص الجمل).
-- • النتيجة صفوف في SELECT واحد في الآخر، مش exception: صف الملخص (ord=0) وبعده صف لكل فحص (التفاصيل ≤ 400 حرف).
--   الدرس: أي ملف يتشغّل عبر Retool لازم يرجّع النتيجة صفوف، مش exception طويل.
-- • كل فحص بيمسك أخطاءه ويسجّلها صف fail باسم ABORT_<id>، والملف بيكمّل. النتايج بتتجمع في إعداد محلي للمعاملة
--   (zell.verify_rows) مش في جدول، عشان مفيش أي DDL.
-- • verdict = PASS بس لو fail = 0 وعدد الفحوص الناجحة = 15 بالظبط. ولو صف الملخص مش موجود أو رجع terminated = FAIL.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.verify_parity = 'strict';   -- 'strict' | 'info'
set local statement_timeout = '50s';

do $zverify$
declare
  v_rows jsonb := '[]'::jsonb;
  v_info jsonb := '{}'::jsonb;
  v_list text;
  v_ok boolean;
  v_owner uuid;
  v_iface jsonb;
  v_r jsonb;
  v_parity jsonb;
  v_guard integer;
  v_actual integer;
  v_admins integer;
  v_strict boolean := pg_catalog.current_setting('zell.verify_parity', true) <> 'info';
  r record;
begin
  -- V01: الأدوار
  for r in select x.id, x.role from (values ('V01a', 'erp_definer'), ('V01b', 'zell_erp_definer')) as x(id, role) loop
    begin
      if pg_catalog.to_regrole(r.role) is null then
        v_ok := false;
        v_list := 'missing';
      else
        v_ok := exists (select 1 from pg_catalog.pg_roles g where g.rolname = r.role and not g.rolcanlogin
                          and not g.rolbypassrls and not g.rolinherit and not g.rolsuper and not g.rolcreaterole)
            and exists (select 1 from pg_catalog.pg_auth_members m
                         where m.roleid = r.role::regrole and m.member = 'postgres'::regrole and m.set_option)
            and not exists (select 1 from pg_catalog.pg_auth_members m
                             where m.roleid = r.role::regrole and m.member = 'postgres'::regrole and m.inherit_option);
        v_list := case when v_ok then null else 'shape' end;
      end if;
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', r.id,
        'name', r.id || ' role ' || r.role || ': nologin, noinherit, no bypassrls, postgres SET without INHERIT', 'ok', v_ok, 'detail', v_list));
    exception when others then
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_' || r.id,
        'name', 'ABORT_' || r.id || ' raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
    end;
  end loop;

  -- V02: الجداول موجودة + RLS + صفر صلاحيات لـ service_role/anon/authenticated
  begin
    select string_agg(t.n, ',') into v_list
      from (values ('erp_capabilities'), ('erp_presets'), ('erp_preset_items'), ('erp_user_grants'), ('erp_user_access'),
                   ('erp_commands'), ('erp_access_audit'), ('erp_access_shadow_events'),
                   ('zell_erp_owner_guard'), ('zell_erp_admin_users_log')) as t(n)
     where pg_catalog.to_regclass('public.' || t.n) is null
        or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass('public.' || t.n))
        or pg_catalog.has_table_privilege('service_role', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_table_privilege('anon', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_table_privilege('authenticated', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V02',
      'name', 'V02 10 tables exist, RLS on, no privileges for service_role/anon/authenticated', 'ok', v_list is null, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V02',
      'name', 'ABORT_V02 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V03: zell_erp_definer مالوش أي صلاحية على admin_users
  begin
    v_ok := not pg_catalog.has_table_privilege('zell_erp_definer', 'public.admin_users', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V03',
      'name', 'V03 zell_erp_definer has no privilege on admin_users', 'ok', v_ok, 'detail', null));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V03',
      'name', 'ABORT_V03 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V04: الحد العام = ١٢ دالة محوّل بالظبط لـ authenticated
  begin
    select string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
       and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE');
    v_ok := v_list is not distinct from 'zell_erp_access_apply_preset,zell_erp_access_audit_page,zell_erp_access_grant,zell_erp_access_parity,zell_erp_access_revoke,zell_erp_access_revoke_all,zell_erp_access_shadow_report,zell_erp_access_snapshot,zell_erp_access_users,zell_erp_my_access,zell_erp_record_shadow_event,zell_erp_set_user_active';
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V04',
      'name', 'V04 authenticated EXECUTE is exactly the 12 adapter RPCs', 'ok', v_ok,
      'detail', case when v_ok then null else coalesce(v_list, '') end));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V04',
      'name', 'ABORT_V04 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V05: service_role و anon صفر EXECUTE
  begin
    select string_agg(p.proname::text, ',') into v_list
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
       and (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
            or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V05',
      'name', 'V05 service_role and anon: no EXECUTE on erp_* / zell_erp_*', 'ok', v_list is null, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V05',
      'name', 'ABORT_V05 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V06: دوال المحرك مالكها erp_definer
  begin
    select string_agg(p.proname::text, ',') into v_list
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
       and p.proname not in ('erp_actor_status_v1', 'erp_trg_immutable')
       and pg_catalog.pg_get_userbyid(p.proowner) <> 'erp_definer';
    v_ok := v_list is null and exists (select 1 from pg_catalog.pg_proc p
                                        where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
                                          and pg_catalog.pg_get_userbyid(p.proowner) = 'erp_definer');
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V06',
      'name', 'V06 engine functions owned by erp_definer', 'ok', v_ok,
      'detail', case when v_ok then null else coalesce(v_list, 'no engine functions') end));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V06',
      'name', 'ABORT_V06 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V07: دوال المحوّل (١٤) مالكها zell_erp_definer
  begin
    select string_agg(x.n, ',') into v_list
      from (values ('zell_erp_trusted_actor'), ('zell_erp_require_actor'), ('zell_erp_my_access'), ('zell_erp_access_grant'),
                   ('zell_erp_access_revoke'), ('zell_erp_access_apply_preset'), ('zell_erp_access_revoke_all'),
                   ('zell_erp_access_snapshot'), ('zell_erp_access_audit_page'), ('zell_erp_access_shadow_report'),
                   ('zell_erp_record_shadow_event'), ('zell_erp_set_user_active'), ('zell_erp_access_users'),
                   ('zell_erp_access_parity')) as x(n)
     where not exists (select 1 from pg_catalog.pg_proc p
                        where p.pronamespace = 'public'::regnamespace and p.proname = x.n)
        or exists (select 1 from pg_catalog.pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname = x.n
                      and pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_erp_definer');
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V07',
      'name', 'V07 14 adapter functions exist, owned by zell_erp_definer', 'ok', v_list is null, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V07',
      'name', 'ABORT_V07 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V08: الواجهة (المالك والخصائص و EXECUTE لـ erp_definer)
  begin
    select pg_catalog.format('owner=%s secdef=%s volatile=%s config=%s',
             pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proconfig),
           pg_catalog.pg_get_userbyid(p.proowner) = 'zell_erp_definer'
             and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
             and pg_catalog.has_function_privilege('erp_definer', p.oid, 'EXECUTE')
      into v_list, v_ok
      from pg_catalog.pg_proc p where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure;
    v_ok := coalesce(v_ok, false);
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V08',
      'name', 'V08 interface: owner zell_erp_definer, security definer, stable, empty search_path, EXECUTE for erp_definer',
      'ok', v_ok, 'detail', case when v_ok then null else v_list end));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V08',
      'name', 'ABORT_V08 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V09: الـ triggers موجودة ومفعّلة
  begin
    select string_agg(t.tgname, ',') into v_list
      from (values ('admin_users', 'zell_erp_admin_users_user_id_immutable'), ('admin_users', 'zell_erp_owner_guard_count'),
                   ('admin_users', 'zell_erp_admin_users_log_change'), ('admin_users', 'zell_erp_admin_users_no_truncate'),
                   ('zell_erp_owner_guard', 'zell_erp_owner_guard_no_direct'), ('zell_erp_owner_guard', 'zell_erp_owner_guard_no_truncate'),
                   ('zell_erp_admin_users_log', 'zell_erp_admin_users_log_immutable'),
                   ('erp_access_audit', 'erp_access_audit_immutable'), ('erp_commands', 'erp_commands_immutable'),
                   ('erp_user_grants', 'erp_user_grants_no_truncate')) as t(tbl, tgname)
     where pg_catalog.to_regclass('public.' || t.tbl) is null
        or not exists (select 1 from pg_catalog.pg_trigger g
                        where g.tgrelid = pg_catalog.to_regclass('public.' || t.tbl) and g.tgname = t.tgname and g.tgenabled = 'O');
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V09',
      'name', 'V09 10 triggers present and enabled', 'ok', v_list is null, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V09',
      'name', 'ABORT_V09 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V10: العدّاد = عدد الملاك الشغالين، وفيه مالك شغال
  begin
    select count(*)::integer into v_actual from public.admin_users a where a.role = 'owner' and a.is_active;
    select count(*)::integer into v_admins from public.admin_users a where a.role = 'admin' and a.is_active;
    v_info := v_info || pg_catalog.jsonb_build_object('active_owners', v_actual, 'active_admins', v_admins);
    select g.active_owner_count into v_guard from public.zell_erp_owner_guard g where g.id = 1;
    v_info := v_info || pg_catalog.jsonb_build_object('guard', v_guard);
    v_ok := v_guard is not distinct from v_actual and v_actual >= 1;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V10',
      'name', 'V10 owner guard equals active owners (>= 1)', 'ok', v_ok,
      'detail', 'guard=' || coalesce(v_guard::text, 'null') || ' active_owners=' || coalesce(v_actual::text, 'null')));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V10',
      'name', 'ABORT_V10 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V11: القائمة والقوالب
  begin
    select pg_catalog.format('capabilities=%s grantable=%s admin_today=%s warehouse=%s',
             (select count(*) from public.erp_capabilities),
             (select count(*) from public.erp_capabilities c where c.category in ('operational', 'sales')),
             (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today'),
             (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.warehouse'))
      into v_list;
    v_ok := v_list = 'capabilities=29 grantable=22 admin_today=22 warehouse=0';
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V11',
      'name', 'V11 catalog 29 (22 grantable), preset admin_today 22, warehouse empty', 'ok', v_ok, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V11',
      'name', 'ABORT_V11 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V12: الواجهة بترجع (true, true) لأول مالك شغال
  begin
    select a.user_id into v_owner from public.admin_users a where a.role = 'owner' and a.is_active
     order by a.created_at, a.user_id limit 1;
    set local role zell_erp_definer;
    select pg_catalog.to_jsonb(s) into v_iface from public.erp_actor_status_v1(v_owner) s;
    reset role;
    v_ok := v_owner is not null and v_iface is not distinct from '{"is_active": true, "is_owner": true}'::jsonb;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V12',
      'name', 'V12 interface returns (true, true) for the first active owner', 'ok', v_ok,
      'detail', case when v_ok then null else coalesce(v_iface::text, 'null') end));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V12',
      'name', 'ABORT_V12 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- نداءات القراءة بجلسة مالك مُحاكاة: الصلاحيات الفعلية والمطابقة
  begin
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    set local role zell_erp_definer;
    v_r := public.zell_erp_my_access();
    v_parity := public.zell_erp_access_parity();
    reset role;
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    v_info := v_info || pg_catalog.jsonb_build_object('parity_clean', v_parity ->> 'clean', 'mismatches', v_parity ->> 'mismatches');
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V13',
      'name', 'ABORT_V13 owner-session reads raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V13: جلسة المالك: تجاوز المالك و ٢٩ صلاحية
  begin
    v_ok := coalesce((v_r ->> 'owner')::boolean, false) and coalesce(pg_catalog.jsonb_array_length(v_r -> 'capabilities'), 0) = 29;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V13',
      'name', 'V13 owner session: owner bypass, all 29 capabilities', 'ok', v_ok,
      'detail', case when v_ok then null else coalesce(v_r::text, 'null') end));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V13b',
      'name', 'ABORT_V13b raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- V14: المطابقة (strict: لازم clean · info: بتتعرض بس)
  begin
    if v_strict then
      v_ok := coalesce((v_parity ->> 'clean')::boolean, false);
      v_list := case when v_ok then null else coalesce(v_parity::text, 'null') end;
    else
      v_ok := v_parity is not null;
      v_list := 'info mode: clean=' || coalesce(v_parity ->> 'clean', 'null');
    end if;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'V14',
      'name', 'V14 parity clean (strict) / reported (info)', 'ok', v_ok, 'detail', v_list));
  exception when others then
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', 'ABORT_V14',
      'name', 'ABORT_V14 raised an unexpected error', 'ok', false, 'detail', sqlstate || ' ' || sqlerrm));
  end;

  -- معلومات للملخص (مش فحص)
  begin
    v_info := v_info || pg_catalog.jsonb_build_object(
      'migration_audit_rows', (select count(*) from public.erp_access_audit a where a.source = 'migration'),
      'rpc_audit_rows', (select count(*) from public.erp_access_audit a where a.source = 'rpc'));
  exception when others then
    null;
  end;

  perform pg_catalog.set_config('zell.verify_rows', v_rows::text, true);
  perform pg_catalog.set_config('zell.verify_info', v_info::text, true);
end
$zverify$;

-- النتيجة: SELECT واحد بس، مرتب بعمود ord. الصف 0 = الملخص، وبعده صف لكل فحص (التفاصيل ≤ 400 حرف).
with v as (
  select e.value as j, e.ordinality as n
    from pg_catalog.jsonb_array_elements(
           coalesce(nullif(pg_catalog.current_setting('zell.verify_rows', true), ''), '[]')::jsonb
         ) with ordinality as e(value, ordinality)
), i as (
  select coalesce(nullif(pg_catalog.current_setting('zell.verify_info', true), ''), '{}')::jsonb as j
), c as (
  select count(*) filter (where coalesce((v.j ->> 'ok')::boolean, false)) as pass_n,
         count(*) filter (where not coalesce((v.j ->> 'ok')::boolean, false)) as fail_n
    from v
)
select 0::bigint as ord,
       'summary'::text as kind,
       null::text as check_id,
       null::text as check_name,
       null::text as outcome,
       null::text as detail,
       pg_catalog.current_setting('zell.verify_parity', true) as parity_mode,
       c.pass_n as pass,
       c.fail_n as fail,
       15::bigint as expected_checks,
       case when c.fail_n = 0 and c.pass_n = 15 then 'PASS' else 'FAIL' end as verdict,
       i.j ->> 'guard' as guard,
       i.j ->> 'active_owners' as active_owners,
       i.j ->> 'active_admins' as active_admins,
       left(i.j ->> 'parity_clean', 40) as parity_clean,
       left(i.j ->> 'mismatches', 400) as mismatches,
       i.j ->> 'migration_audit_rows' as migration_audit_rows,
       i.j ->> 'rpc_audit_rows' as rpc_audit_rows
  from c, i
union all
select v.n, 'check', left(v.j ->> 'id', 40), left(v.j ->> 'name', 400),
       case when coalesce((v.j ->> 'ok')::boolean, false) then 'pass' else 'fail' end,
       left(v.j ->> 'detail', 400),
       null::text, null::bigint, null::bigint, null::bigint, null::text, null::text, null::text, null::text,
       null::text, null::text, null::text, null::text
  from v
order by 1;

rollback;
