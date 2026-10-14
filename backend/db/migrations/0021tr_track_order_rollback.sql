-- 0021-TR W1 — الرجوع لـ 0021tr_track_order.sql: بيشيل الدالة، وصلاحية القراية على order_items والـ policy بتاعتها.
-- مفيش بيانات، فالرجوع مسموح دايمًا.
-- الترتيب: revert كود W2 الأول لو اتنشر، وبعدين الداتابيز. ولازم قبل أي rollback لـ A1 (اللي بيشيل الدور zell_order_definer).
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $trrb$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021TR_RB_WRONG_CALLER';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)') is null then
    raise exception 'ZELL_0021TR_RB_NOT_APPLIED';
  end if;
end
$trrb$;

set local role zell_order_definer;
drop function public.zell_checkout_track_order(text);
reset role;

drop policy zell_order_definer_select on public.order_items;
revoke select (id, order_id, product_name_ar, length_cm, width_cm, quantity, sale_unit, line_total_piastres)
  on table public.order_items from zell_order_definer;

do $trrbpost$
begin
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order')
     or exists (select 1 from pg_catalog.pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select')
     or pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'ZELL_0021TR_RB_POST_LEFTOVERS';
  end if;
end
$trrbpost$;

commit;
