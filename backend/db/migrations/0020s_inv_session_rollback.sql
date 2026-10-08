-- 0020-S — الرجوع (rollback) لـ 0020s_inv_session.sql (PR-1)
--
-- • بيمسح الـ 23 zell_inv_session_* و zell_inv_claims_actor بس. مابيلمسش أي دالة قديمة ولا جدول ولا صف ولا دور.
--   الدوال دي مابتخزّنش بيانات لوحدها: أي حاجة اتكتبت بيها موجودة في جداول 0020 زي ما هي.
-- • الترتيب (العقد §٨):
--     قبل PR-2: الملف ده على طول.
--     بعد PR-2 وقبل PR-3: revert الكود الأول (اللوحة ترجع للطريق القديم)، وبعدين الملف ده.
--     بعد PR-3: rollback PR-3 (رجوع EXECUTE لـ service_role) الأول ← revert الكود ← الملف ده لو مطلوب.
-- • تأكيد صريح إجباري، سطر واحد بعد begin; في نص التشغيل (مش في الملف):
--     set local zell.rollback_attest = 'panel-not-calling-session-functions';
--   من غيره: ZELL_0020S_ROLLBACK_ATTEST. ولو PR-3 متطبّق (service_role مالوش EXECUTE على القديمة): ZELL_0020S_ROLLBACK_PR3_ACTIVE.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '50s';

do $zs_rb_pre$
declare
  v_bad text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020S_WRONG_CALLER';
  end if;
  if coalesce(pg_catalog.current_setting('zell.rollback_attest', true), '') <> 'panel-not-calling-session-functions' then
    raise exception 'ZELL_0020S_ROLLBACK_ATTEST';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') <> 23
     or pg_catalog.to_regprocedure('public.zell_inv_claims_actor()') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 67 then
    raise exception 'ZELL_0020S_ROLLBACK_NOT_APPLIED';
  end if;
  select string_agg(s, ',') into v_bad
    from unnest(array[
      'public.zell_inv_create_location(uuid, uuid, text, text)', 'public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)',
      'public.zell_inv_create_supplier(uuid, uuid, text, text, text)', 'public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)',
      'public.zell_inv_create_purchase(uuid, uuid, jsonb)', 'public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)',
      'public.zell_inv_post_purchase(uuid, uuid, bigint, integer)', 'public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)',
      'public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)', 'public.zell_inv_create_opening(uuid, uuid, jsonb)',
      'public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)', 'public.zell_inv_post_opening(uuid, uuid, bigint, integer)',
      'public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)', 'public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)',
      'public.zell_inv_list_locations(uuid, boolean, integer, bigint)', 'public.zell_inv_list_suppliers(uuid, boolean, integer, text)',
      'public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)', 'public.zell_inv_get_purchase(uuid, bigint)',
      'public.zell_inv_preview_purchase(uuid, jsonb)', 'public.zell_inv_list_openings(uuid, text, integer, bigint)',
      'public.zell_inv_get_opening(uuid, bigint)', 'public.zell_inv_preview_opening(uuid, jsonb)',
      'public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)']) s
   where pg_catalog.to_regprocedure(s) is null
      or not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(s), 'EXECUTE');
  if v_bad is not null then
    raise exception 'ZELL_0020S_ROLLBACK_PR3_ACTIVE';
  end if;
end
$zs_rb_pre$;

set local role zell_inventory_definer;
drop function public.zell_inv_session_create_location(uuid, text, text);
drop function public.zell_inv_session_update_location(uuid, bigint, integer, text, boolean);
drop function public.zell_inv_session_create_supplier(uuid, text, text, text);
drop function public.zell_inv_session_update_supplier(uuid, bigint, integer, text, text, text, boolean);
drop function public.zell_inv_session_create_purchase(uuid, jsonb);
drop function public.zell_inv_session_update_purchase(uuid, bigint, integer, jsonb);
drop function public.zell_inv_session_post_purchase(uuid, bigint, integer);
drop function public.zell_inv_session_discard_purchase(uuid, bigint, integer, text);
drop function public.zell_inv_session_void_purchase(uuid, bigint, integer, text);
drop function public.zell_inv_session_create_opening(uuid, jsonb);
drop function public.zell_inv_session_update_opening(uuid, bigint, integer, jsonb);
drop function public.zell_inv_session_post_opening(uuid, bigint, integer);
drop function public.zell_inv_session_discard_opening(uuid, bigint, integer, text);
drop function public.zell_inv_session_void_opening(uuid, bigint, integer, text);
drop function public.zell_inv_session_list_locations(boolean, integer, bigint);
drop function public.zell_inv_session_list_suppliers(boolean, integer, text);
drop function public.zell_inv_session_list_purchases(text, bigint, integer, bigint);
drop function public.zell_inv_session_get_purchase(bigint);
drop function public.zell_inv_session_preview_purchase(jsonb);
drop function public.zell_inv_session_list_openings(text, integer, bigint);
drop function public.zell_inv_session_get_opening(bigint);
drop function public.zell_inv_session_preview_opening(jsonb);
drop function public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint);
drop function public.zell_inv_claims_actor();
reset role;

do $zs_rb_post$
begin
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'zell\_inv\_session\_%' or p.proname = 'zell_inv_claims_actor'))
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 43 then
    raise exception 'ZELL_0020S_ROLLBACK_POST';
  end if;
end
$zs_rb_post$;

notify pgrst, 'reload schema';

commit;
