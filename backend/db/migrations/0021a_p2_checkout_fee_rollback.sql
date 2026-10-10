-- 0021-A P2 — الرجوع لـ 0021a_p2_checkout_fee.sql: بيشيل الدالة بس (مفيش بيانات). قبل أي رجوع لـ P1.
-- الترتيب: الكود الأول (المتجر بيتعامل مع غياب الدالة = من غير سطر الرسوم)، وبعدين الداتابيز.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $p2rb$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A_P2_RB_WRONG_CALLER';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is null then
    raise exception 'ZELL_0021A_P2_RB_NOT_APPLIED';
  end if;
end
$p2rb$;

set local role zell_order_definer;
drop function public.zell_checkout_confirmation_fee();
reset role;

do $p2rbpost$
begin
  if pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is not null then
    raise exception 'ZELL_0021A_P2_RB_POST_LEFTOVERS';
  end if;
end
$p2rbpost$;

commit;
