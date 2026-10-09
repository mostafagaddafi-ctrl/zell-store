-- 0020-S PR-3 — الدوال القديمة zell_inv_* (بـ p_actor) بتبقى داخلية: سحب EXECUTE من service_role على الـ 23 بس
--
-- العقد: docs/contracts/0020-S.md (§٦ بند 3، §٨، §٩ قرار 3). قبله: PR-1 (#109) متطبّق، و PR-2 (#110) منشور ومتجرّب.
--   • بعد الملف ده مفيش أي zell_inv_* بيتنادى بـ service_role. اللوحة بتنادي zell_inv_session_* بجلسة المستخدم بس.
--   • الدوال القديمة مابتتمسحش (قرار المراجع): بتفضل، والدوال الجديدة بتناديها بصلاحية مالكها (zell_inventory_definer).
--   • مفيش أي تغيير في أجسام الدوال ولا الدوال الجديدة ولا أي grant تاني (البصمة قبل وبعد في الـ postflight).
--   • أكواد الـ preflight والـ postflight: ZELL_0020S3_* (رسايل قصيرة).
--
-- الرجوع: 0020s_pr3_rollback.sql (بتأكيد). الترتيب بعد PR-3 (العقد §٨): الملف ده الأول ← revert كود PR-2 ← rollback PR-1 لو مطلوب.
-- الاختبار قبل التطبيق: 0020s_pr3_ptest.sql · بعده: 0020s_inv_session_verify.sql (المرحلة pr3) و 0020_inventory_purchasing_verify.sql.
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد backup.

begin;
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

commit;
