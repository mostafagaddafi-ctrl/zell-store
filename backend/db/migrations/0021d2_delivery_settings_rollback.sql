-- 0021-D2 W1 — الرجوع لـ 0021d2_delivery_settings.sql: بيشيل الدوال التلاتة والجدولين ودالة الـ trigger في معاملة واحدة.
-- الترتيب الإجباري (العقد §٤): revert كود W2 الأول، وبعدين الملف ده.
-- بيرفض لو فيه أي سطر في zell_delivery_settings_log (ZELL_0021D2_RB_HAS_CONFIG_DATA): بعد أول حفظ من المالك مفيش رجوع،
-- والتصحيح للأمام بس.
-- ⚠ بيتشغّل على Production بموافقة صريحة بس.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $d2rb$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021D2_RB_WRONG_CALLER';
  end if;
  if pg_catalog.to_regclass('public.zell_delivery_settings') is null
     or pg_catalog.to_regclass('public.zell_delivery_settings_log') is null then
    raise exception 'ZELL_0021D2_RB_NOT_APPLIED';
  end if;
end
$d2rb$;

lock table public.zell_delivery_settings, public.zell_delivery_settings_log in access exclusive mode;

do $d2rbdata$
begin
  if exists (select 1 from public.zell_delivery_settings_log) then
    raise exception 'ZELL_0021D2_RB_HAS_CONFIG_DATA';
  end if;
end
$d2rbdata$;

set local role zell_order_definer;
drop function public.zell_checkout_delivery_settings();
drop function public.zell_delivery_settings_save(timestamptz, boolean, boolean, text);
drop function public.zell_delivery_settings_get();
reset role;

drop table public.zell_delivery_settings_log;
drop table public.zell_delivery_settings;
drop function public.zell_delivery_settings_trg_append_only();

do $d2rbpost$
begin
  if pg_catalog.to_regclass('public.zell_delivery_settings') is not null
     or pg_catalog.to_regclass('public.zell_delivery_settings_log') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('zell_delivery_settings_get', 'zell_delivery_settings_save',
                                     'zell_checkout_delivery_settings', 'zell_delivery_settings_trg_append_only')) then
    raise exception 'ZELL_0021D2_RB_POST_LEFTOVERS';
  end if;
end
$d2rbpost$;

commit;
