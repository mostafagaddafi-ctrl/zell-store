-- 0021-P — التحقق بعد التطبيق (post-apply verification) لـ 0021p_erp_access.sql + 0021p_zell_erp_access.sql
--
-- • قراءة بس: catalog + نداءات قراءة. مفيش DDL ولا كتابة، والمعاملة بترجع دايمًا.
-- • بيتأكد من: الأدوار وشكل العضوية · الجداول وRLS والصلاحيات · ملكية الدوال و EXECUTE (service_role بالظبط على
--   ٩ دوال محرك + ٣ دوال محوّل) · الواجهة (المالك والخصائص والنتيجة) · الـ triggers · العدّاد = العدد الفعلي ·
--   القائمة والقوالب · المطابقة (strict بعد التطبيق مباشرة، أو info بعد كده).
-- • النتيجة في رسالة ZELL_0021P_VERIFY_RESULT (الرسالة exception عن قصد).

begin;
select pg_catalog.set_config('zell.verify_parity', 'strict', true);   -- 'strict' | 'info'
set local statement_timeout = '50s';

do $zverify$
declare
  v_fail text[] := '{}';
  v_list text;
  v_owner uuid;
  v_r jsonb;
  v_parity jsonb;
  v_guard integer;
  v_actual integer;
  v_strict boolean := pg_catalog.current_setting('zell.verify_parity', true) <> 'info';
  v_admins integer;
  r record;
begin
  -- (أ) الأدوار
  for r in select x.role from (values ('erp_definer'), ('zell_erp_definer')) as x(role) loop
    if pg_catalog.to_regrole(r.role) is null then
      v_fail := v_fail || ('role_missing:' || r.role);
    elsif not exists (select 1 from pg_catalog.pg_roles g where g.rolname = r.role and not g.rolcanlogin
                        and not g.rolbypassrls and not g.rolinherit and not g.rolsuper and not g.rolcreaterole)
       or not exists (select 1 from pg_catalog.pg_auth_members m
                       where m.roleid = r.role::regrole and m.member = 'postgres'::regrole and m.set_option)
       or exists (select 1 from pg_catalog.pg_auth_members m
                   where m.roleid = r.role::regrole and m.member = 'postgres'::regrole and m.inherit_option) then
      v_fail := v_fail || ('role_shape:' || r.role);
    end if;
  end loop;

  -- (ب) الجداول: موجودة + RLS + صفر صلاحيات لـ service_role/anon/authenticated
  select string_agg(t.n, ',') into v_list
    from (values ('erp_capabilities'), ('erp_presets'), ('erp_preset_items'), ('erp_user_grants'), ('erp_user_access'),
                 ('erp_commands'), ('erp_access_audit'), ('erp_access_shadow_events'),
                 ('zell_erp_owner_guard'), ('zell_erp_admin_users_log')) as t(n)
   where pg_catalog.to_regclass('public.' || t.n) is null
      or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass('public.' || t.n))
      or pg_catalog.has_table_privilege('service_role', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_table_privilege('anon', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  if v_list is not null then
    v_fail := v_fail || ('tables:' || v_list);
  end if;
  if pg_catalog.has_table_privilege('zell_erp_definer', 'public.admin_users', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    v_fail := v_fail || 'zell_erp_definer_touches_admin_users'::text;
  end if;

  -- (ج) EXECUTE لـ service_role بالظبط
  select string_agg(p.proname::text collate "C", ',' order by p.proname::text collate "C") into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
     and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v_list is distinct from 'erp_access_apply_preset,erp_access_audit_page,erp_access_grant,erp_access_revoke,erp_access_revoke_all,erp_access_shadow_report,erp_access_snapshot,erp_effective_capabilities,erp_record_shadow_event,zell_erp_access_parity,zell_erp_access_users,zell_erp_set_user_active' then
    v_fail := v_fail || ('service_execute:' || coalesce(v_list, ''));
  end if;
  select string_agg(p.proname::text, ',') into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
     and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_list is not null then
    v_fail := v_fail || ('public_execute:' || v_list);
  end if;

  -- (د) ملكية الدوال
  select string_agg(p.proname::text, ',') into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'erp\_%'
     and p.proname not in ('erp_actor_status_v1', 'erp_trg_immutable')
     and pg_catalog.pg_get_userbyid(p.proowner) <> 'erp_definer';
  if v_list is not null then
    v_fail := v_fail || ('engine_owners:' || v_list);
  end if;
  select string_agg(p.proname::text, ',') into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('zell_erp_set_user_active', 'zell_erp_access_users', 'zell_erp_access_parity')
     and pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_erp_definer';
  if v_list is not null then
    v_fail := v_fail || ('adapter_owners:' || v_list);
  end if;

  -- (هـ) الواجهة
  if (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
       where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure) <> 'zell_erp_definer'
     or not (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
               from pg_catalog.pg_proc p where p.oid = 'public.erp_actor_status_v1(uuid)'::regprocedure)
     or not pg_catalog.has_function_privilege('erp_definer', 'public.erp_actor_status_v1(uuid)', 'EXECUTE') then
    v_fail := v_fail || 'interface_shape'::text;
  end if;

  -- (و) الـ triggers
  select string_agg(t.tgname, ',') into v_list
    from (values ('admin_users', 'zell_erp_admin_users_user_id_immutable'), ('admin_users', 'zell_erp_owner_guard_count'),
                 ('admin_users', 'zell_erp_admin_users_log_change'), ('admin_users', 'zell_erp_admin_users_no_truncate'),
                 ('zell_erp_owner_guard', 'zell_erp_owner_guard_no_direct'), ('zell_erp_owner_guard', 'zell_erp_owner_guard_no_truncate'),
                 ('zell_erp_admin_users_log', 'zell_erp_admin_users_log_immutable'),
                 ('erp_access_audit', 'erp_access_audit_immutable'), ('erp_commands', 'erp_commands_immutable'),
                 ('erp_user_grants', 'erp_user_grants_no_truncate')) as t(tbl, tgname)
   where not exists (select 1 from pg_catalog.pg_trigger g
                      where g.tgrelid = ('public.' || t.tbl)::regclass and g.tgname = t.tgname and g.tgenabled = 'O');
  if v_list is not null then
    v_fail := v_fail || ('triggers:' || v_list);
  end if;

  -- (ز) العدّاد + مالك شغال
  select g.active_owner_count into v_guard from public.zell_erp_owner_guard g where g.id = 1;
  select count(*)::integer into v_actual from public.admin_users a where a.role = 'owner' and a.is_active;
  if v_guard is distinct from v_actual or v_actual < 1 then
    v_fail := v_fail || ('guard:' || coalesce(v_guard::text, 'null') || '/' || v_actual);
  end if;

  -- (ح) القائمة والقوالب
  if (select count(*) from public.erp_capabilities) <> 29
     or (select count(*) from public.erp_capabilities c where c.category in ('operational', 'sales')) <> 22
     or (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') <> 22
     or exists (select 1 from public.erp_preset_items i where i.preset_key = 'zell.warehouse') then
    v_fail := v_fail || 'catalog'::text;
  end if;

  -- (ط) نداءات قراءة: الواجهة والصلاحيات الفعلية والمطابقة
  select a.user_id into v_owner from public.admin_users a where a.role = 'owner' and a.is_active
   order by a.created_at, a.user_id limit 1;
  select count(*)::integer into v_admins from public.admin_users a where a.role = 'admin' and a.is_active;
  set local role zell_erp_definer;
  select pg_catalog.to_jsonb(s) into v_r from public.erp_actor_status_v1(v_owner) s;
  v_parity := public.zell_erp_access_parity(v_owner);
  reset role;
  if v_r is distinct from '{"is_active": true, "is_owner": true}'::jsonb then
    v_fail := v_fail || ('interface_owner:' || coalesce(v_r::text, 'null'));
  end if;
  set local role service_role;
  v_r := public.erp_effective_capabilities(v_owner);
  reset role;
  if not coalesce((v_r ->> 'owner')::boolean, false) or jsonb_array_length(v_r -> 'capabilities') <> 29 then
    v_fail := v_fail || ('owner_effective:' || coalesce(v_r::text, 'null'));
  end if;
  if v_strict and not coalesce((v_parity ->> 'clean')::boolean, false) then
    v_fail := v_fail || ('parity:' || coalesce(v_parity::text, 'null'));
  end if;

  if cardinality(v_fail) > 0 then
    raise exception 'ZELL_0021P_VERIFY_RESULT fail checks=% parity=%', array_to_string(v_fail, ' | '), coalesce(v_parity ->> 'clean', 'null');
  end if;
  raise exception 'ZELL_0021P_VERIFY_RESULT ok guard=%/% active_admins=% parity_clean=% mismatches=% migration_audit_rows=% rpc_audit_rows=%',
    v_guard, v_actual, v_admins, v_parity ->> 'clean', v_parity ->> 'mismatches',
    (select count(*) from public.erp_access_audit a where a.source = 'migration'),
    (select count(*) from public.erp_access_audit a where a.source = 'rpc');
end
$zverify$;

rollback;
