-- 0020-S PR-3 — الرجوع: رجوع EXECUTE لـ service_role على الـ 23 دالة القديمة بس
--
-- • ده الخطوة الأولى في أي رجوع بعد PR-3 (العقد §٨): الملف ده ← revert كود PR-2 ← rollback PR-1 لو مطلوب.
-- • بيرجّع الـ ACL زي 0020 بالظبط (المالك + service_role). مابيلمسش أي حاجة تانية.
-- • تأكيد صريح إجباري، سطر واحد بعد begin; في نص التشغيل (مش في الملف):
--     set local zell.rollback_attest = 'restore-service-role-execute';
--   من غيره: ZELL_0020S3_ROLLBACK_ATTEST. ولو PR-3 مش متطبّق: ZELL_0020S3_ROLLBACK_NOT_APPLIED، ولو جزئي: ZELL_0020S3_ROLLBACK_PARTIAL.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس (بيفتح نداء القديمة بـ service_role تاني).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '50s';

create temporary table zell_0020s3rb_old (old_sig text primary key) on commit drop;
insert into pg_temp.zell_0020s3rb_old (old_sig) values
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

do $zs3_rb_pre$
declare
  v_n integer;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020S3_WRONG_CALLER';
  end if;
  if coalesce(pg_catalog.current_setting('zell.rollback_attest', true), '') <> 'restore-service-role-execute' then
    raise exception 'ZELL_0020S3_ROLLBACK_ATTEST';
  end if;
  if exists (select 1 from pg_temp.zell_0020s3rb_old o where pg_catalog.to_regprocedure(o.old_sig) is null) then
    raise exception 'ZELL_0020S3_OLD_MISSING';
  end if;
  select count(*) into v_n from pg_temp.zell_0020s3rb_old o
   where pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE');
  if v_n = 23 then
    raise exception 'ZELL_0020S3_ROLLBACK_NOT_APPLIED';
  end if;
  if v_n <> 0 then
    raise exception 'ZELL_0020S3_ROLLBACK_PARTIAL';
  end if;
end
$zs3_rb_pre$;

set local role zell_inventory_definer;
grant execute on function public.zell_inv_create_location(uuid, uuid, text, text) to service_role;
grant execute on function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) to service_role;
grant execute on function public.zell_inv_create_supplier(uuid, uuid, text, text, text) to service_role;
grant execute on function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) to service_role;
grant execute on function public.zell_inv_create_purchase(uuid, uuid, jsonb) to service_role;
grant execute on function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) to service_role;
grant execute on function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) to service_role;
grant execute on function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_create_opening(uuid, uuid, jsonb) to service_role;
grant execute on function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) to service_role;
grant execute on function public.zell_inv_post_opening(uuid, uuid, bigint, integer) to service_role;
grant execute on function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_list_locations(uuid, boolean, integer, bigint) to service_role;
grant execute on function public.zell_inv_list_suppliers(uuid, boolean, integer, text) to service_role;
grant execute on function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) to service_role;
grant execute on function public.zell_inv_get_purchase(uuid, bigint) to service_role;
grant execute on function public.zell_inv_preview_purchase(uuid, jsonb) to service_role;
grant execute on function public.zell_inv_list_openings(uuid, text, integer, bigint) to service_role;
grant execute on function public.zell_inv_get_opening(uuid, bigint) to service_role;
grant execute on function public.zell_inv_preview_opening(uuid, jsonb) to service_role;
grant execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) to service_role;
reset role;

do $zs3_rb_post$
begin
  if exists (
    select 1 from pg_temp.zell_0020s3rb_old o
     where (select array_agg(distinct a.grantee order by a.grantee)
              from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
             where p.oid = pg_catalog.to_regprocedure(o.old_sig))
           is distinct from (select array_agg(g order by g)
                               from unnest(array['zell_inventory_definer'::regrole::oid, 'service_role'::regrole::oid]) g)
        or not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(o.old_sig), 'EXECUTE')) then
    raise exception 'ZELL_0020S3_ROLLBACK_POST';
  end if;
end
$zs3_rb_post$;

notify pgrst, 'reload schema';

commit;
