-- 0021-P — الرجوع (rollback / freeze) لـ 0021p_erp_access.sql + 0021p_zell_erp_access.sql
--
-- وضعين (السطر اللي تحت):
--   • rollback: قبل أي «استخدام حقيقي» بس، وبتأكيد صريح إن ADMIN_ACCESS_MODE ماخرجش من legacy أبدًا.
--     بيشيل الدوال والـ triggers اللي على admin_users و EXECUTE، وبيرجّع جسم erp_actor_status_v1 للرفض.
--     مابيمسحش أي جدول ولا أي صف (erp_access_audit · erp_user_grants · zell_erp_admin_users_log · العدّاد …)،
--     ولا الأدوار ولا الواجهة نفسها. إعادة التطبيق بعده محتاجة ملف forward-fix لوحده (مش في الـ PR ده).
--   • freeze: في أي وقت. بيسحب EXECUTE من authenticated على دوال الإدارة بس (منح · سحب · قالب · سحب الكل ·
--     إيقاف/تشغيل). القراءة والصلاحيات الفعلية بتفضل شغالة. مفيش أي مسح.
--
-- «استخدام حقيقي» = أي واحدة: سطر في erp_access_audit مصدره مش migration · أي أمر في erp_commands ·
--   أي سطر في zell_erp_admin_users_log · أي سطر في erp_access_shadow_events. بعده: rollback بيرفض، والمسموح
--   freeze أو forward-fix بس (والرجوع للكود: ADMIN_ACCESS_MODE=legacy قبل التقوية).
-- الترتيب دايمًا: الكود الأول (legacy أو revert) وبعدين الداتابيز.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
select pg_catalog.set_config('zell.rollback_mode', 'rollback', true);   -- 'rollback' | 'freeze'
-- للوضع rollback لازم السطر ده يتشال منه التعليق بعد التأكد من Vercel:
-- select pg_catalog.set_config('zell.rollback_attest', 'access-mode-never-left-legacy', true);
set local lock_timeout = '5s';
set local statement_timeout = '50s';

do $zrb$
declare
  v_mode text := pg_catalog.current_setting('zell.rollback_mode', true);
  v_list text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021P_ROLLBACK_WRONG_CALLER';
  end if;
  if v_mode not in ('rollback', 'freeze') then
    raise exception 'ZELL_0021P_ROLLBACK_MODE';
  end if;
  if pg_catalog.to_regrole('erp_definer') is null or pg_catalog.to_regrole('zell_erp_definer') is null
     or pg_catalog.to_regprocedure('public.erp_access_grant(uuid,uuid,uuid,text,integer)') is null
     or pg_catalog.to_regprocedure('public.zell_erp_set_user_active(uuid,uuid,boolean,text)') is null then
    raise exception 'ZELL_0021P_ROLLBACK_NOT_APPLIED';
  end if;

  if v_mode = 'freeze' then
    execute 'set local role zell_erp_definer';
    execute 'revoke execute on function public.zell_erp_access_grant(uuid, uuid, text, integer), '
         || 'public.zell_erp_access_revoke(uuid, uuid, text, integer, text), '
         || 'public.zell_erp_access_apply_preset(uuid, uuid, text, integer), '
         || 'public.zell_erp_access_revoke_all(uuid, uuid, integer, text), '
         || 'public.zell_erp_set_user_active(uuid, uuid, boolean, text) from authenticated';
    execute 'reset role';
    select string_agg(p.proname::text, ',') into v_list
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('zell_erp_access_grant', 'zell_erp_access_revoke', 'zell_erp_access_apply_preset',
                         'zell_erp_access_revoke_all', 'zell_erp_set_user_active')
       and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
    if v_list is not null then
      raise exception 'ZELL_0021P_FREEZE_INCOMPLETE %', v_list;
    end if;
    return;
  end if;

  -- rollback
  if coalesce(pg_catalog.current_setting('zell.rollback_attest', true), '') <> 'access-mode-never-left-legacy' then
    raise exception 'ZELL_0021P_ROLLBACK_ATTEST_REQUIRED';
  end if;
  if exists (select 1 from public.erp_access_audit a where a.source <> 'migration')
     or exists (select 1 from public.erp_commands)
     or exists (select 1 from public.zell_erp_admin_users_log)
     or exists (select 1 from public.erp_access_shadow_events) then
    raise exception 'ZELL_0021P_ROLLBACK_REAL_USE';
  end if;

  -- (أ) المحوّل: triggers admin_users ← جسم الواجهة للرفض ← دوال المحوّل ← الدوال المساعدة.
  execute 'drop trigger zell_erp_admin_users_user_id_immutable on public.admin_users';
  execute 'drop trigger zell_erp_owner_guard_count on public.admin_users';
  execute 'drop trigger zell_erp_admin_users_log_change on public.admin_users';
  execute 'drop trigger zell_erp_admin_users_no_truncate on public.admin_users';

  execute 'grant create on schema public to zell_erp_definer';
  execute 'set local role zell_erp_definer';
  execute 'create or replace function public.erp_actor_status_v1(p_user uuid) '
       || 'returns table (is_active boolean, is_owner boolean) language sql stable security definer '
       || 'set search_path = '''' as $b$ select false, false; $b$';
  execute 'drop function public.zell_erp_my_access()';
  execute 'drop function public.zell_erp_access_grant(uuid, uuid, text, integer)';
  execute 'drop function public.zell_erp_access_revoke(uuid, uuid, text, integer, text)';
  execute 'drop function public.zell_erp_access_apply_preset(uuid, uuid, text, integer)';
  execute 'drop function public.zell_erp_access_revoke_all(uuid, uuid, integer, text)';
  execute 'drop function public.zell_erp_access_snapshot()';
  execute 'drop function public.zell_erp_access_audit_page(bigint, integer)';
  execute 'drop function public.zell_erp_access_shadow_report(date)';
  execute 'drop function public.zell_erp_record_shadow_event(text, text, text)';
  execute 'drop function public.zell_erp_set_user_active(uuid, uuid, boolean, text)';
  execute 'drop function public.zell_erp_access_users()';
  execute 'drop function public.zell_erp_access_parity()';
  execute 'drop function public.zell_erp_require_actor()';
  execute 'drop function public.zell_erp_trusted_actor()';
  execute 'reset role';
  execute 'revoke create on schema public from zell_erp_definer';

  execute 'drop function public.zell_erp_admin_status(uuid)';
  execute 'drop function public.zell_erp_admin_set_active(uuid, boolean, uuid)';
  execute 'drop function public.zell_erp_admin_list()';
  execute 'drop function public.zell_erp_owner_guard_lock()';
  execute 'drop function public.zell_erp_owner_guard_read()';
  execute 'drop function public.zell_erp_admin_users_user_id_immutable()';
  execute 'drop function public.zell_erp_owner_guard_count()';
  execute 'drop function public.zell_erp_admin_users_no_truncate()';
  execute 'drop function public.zell_erp_admin_users_log_change()';

  -- (ب) المحرك: كل الدوال المملوكة لـ erp_definer ما عدا رقم نسخة الواجهة. الواجهة نفسها والجداول بتفضل.
  execute 'set local role erp_definer';
  execute 'drop function public.erp_effective_capabilities(uuid)';
  execute 'drop function public.erp_access_grant(uuid, uuid, uuid, text, integer)';
  execute 'drop function public.erp_access_revoke(uuid, uuid, uuid, text, integer, text)';
  execute 'drop function public.erp_access_apply_preset(uuid, uuid, uuid, text, integer)';
  execute 'drop function public.erp_access_revoke_all(uuid, uuid, uuid, integer, text)';
  execute 'drop function public.erp_access_snapshot(uuid)';
  execute 'drop function public.erp_access_audit_page(uuid, bigint, integer)';
  execute 'drop function public.erp_record_shadow_event(uuid, text, text, text)';
  execute 'drop function public.erp_access_shadow_report(uuid, date)';
  execute 'drop function public.erp_access_target_check(uuid, uuid, text)';
  execute 'drop function public.erp_access_command_finish(uuid, uuid, text, text, jsonb, uuid, text, text[], text[], text)';
  execute 'drop function public.erp_access_command_begin(uuid, uuid, text, text)';
  execute 'drop function public.erp_access_bump(uuid)';
  execute 'drop function public.erp_access_user_version(uuid)';
  execute 'drop function public.erp_access_preset_keys(text)';
  execute 'drop function public.erp_access_user_keys(uuid)';
  execute 'drop function public.erp_access_lock_user(uuid)';
  execute 'drop function public.erp_access_reason(text, boolean)';
  execute 'drop function public.erp_access_denial(text)';
  execute 'drop function public.erp_access_request_hash(jsonb)';
  execute 'drop function public.erp_require_capability(uuid, text)';
  execute 'drop function public.erp_has_capability(uuid, text)';
  execute 'drop function public.erp_actor_status(uuid)';
  execute 'reset role';

  -- (ج) postflight
  select string_agg(p.proname::text, ',') into v_list
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'erp\_%' or p.proname like 'zell\_erp\_%')
     and (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v_list is not null then
    raise exception 'ZELL_0021P_ROLLBACK_EXECUTE_LEFT %', v_list;
  end if;
  if pg_catalog.to_regclass('public.erp_access_audit') is null or pg_catalog.to_regclass('public.erp_user_grants') is null
     or pg_catalog.to_regclass('public.zell_erp_admin_users_log') is null or pg_catalog.to_regclass('public.zell_erp_owner_guard') is null
     or pg_catalog.to_regprocedure('public.erp_actor_status_v1(uuid)') is null then
    raise exception 'ZELL_0021P_ROLLBACK_LOST_TABLES';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger g
              where g.tgrelid = 'public.admin_users'::regclass and g.tgname like 'zell\_erp\_%') then
    raise exception 'ZELL_0021P_ROLLBACK_TRIGGERS_LEFT';
  end if;
end
$zrb$;

commit;
