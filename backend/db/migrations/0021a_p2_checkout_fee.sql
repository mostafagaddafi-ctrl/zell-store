-- 0021-A P2 — إعداد رسوم التأكيد للـ Checkout (SQL صغير جوه P2 — قراية بس)
--
-- العقد: docs/contracts/0021-A.md (§٣-٣ «العرض: Checkout»، والتفاصيل في §١٨).
--   • دالة واحدة zell_checkout_confirmation_fee() لـ service_role بس (المتجر)، بترجّع {confirmation_fee, fee_policy}
--     من zell_payment_settings — علشان سطر «مطلوب X مقدمًا» في Checkout يتحسب بنفس الإعداد اللي zell_create_order بتاخد منه
--     اللقطة (من غير نسخة تانية من الإعداد). مفيش أي جدول ولا عمود ولا كتابة.
--   • الاسم zell_checkout_* (مش zell_payment_*) علشان verify P1 (24 دالة zell_payment_*، ومفيش service_role عليها) يفضل PASS.
--   • بعد P1 بس (الـ preflight بيرفض من غيره). الرجوع: 0021a_p2_checkout_fee_rollback.sql — قبل أي رجوع لـ P1.
-- التحقق: 0021a_p2_checkout_fee_verify.sql · الاختبار قبل التطبيق: 0021a_p2_checkout_fee_ptest.sql · CI: backend/db/ci/0021p1_sql_ci.sh (S95–S99)
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، بعد P1 وقبل نشر كود P2.

begin;
-- >>> 0021A_P2 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: P1 متطبّق، و P2 لأ.
do $p2pre$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A_P2_WRONG_CALLER';
  end if;
  if pg_catalog.to_regclass('public.zell_payment_settings') is null
     or pg_catalog.to_regrole('zell_order_definer') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24 then
    raise exception 'ZELL_0021A_P2_P1_MISSING';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is not null then
    raise exception 'ZELL_0021A_P2_ALREADY_APPLIED';
  end if;
end
$p2pre$;

-- (1) إعداد رسوم التأكيد للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_role بس — زي
--     zell_checkout_delivery_periods في D. بترجّع الإعداد والسياسة بس (مش أرقام الدفع ولا قالب واتساب).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create function public.zell_checkout_confirmation_fee()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object('confirmation_fee', s.confirmation_fee, 'fee_policy', s.fee_policy)
    from public.zell_payment_settings s where s.id
$fn$;

revoke all on function public.zell_checkout_confirmation_fee() from public, anon, authenticated, service_role;
grant execute on function public.zell_checkout_confirmation_fee() to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (2) postflight
do $p2post$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()');
begin
  if v_oid is null
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_oid) <> 'zell_order_definer'
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid)
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0021A_P2_POST_SHAPE';
  end if;
end
$p2post$;
-- <<< 0021A_P2 BODY
commit;
