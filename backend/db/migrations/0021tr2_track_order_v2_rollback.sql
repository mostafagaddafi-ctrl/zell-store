-- TRACK-ORDER v2 W1 — الرجوع لـ 0021tr2_track_order_v2.sql في معاملة واحدة (العقد §١٣).
-- الترتيب الإجباري: revert كود W2 الأول، وبعدين الملف ده. ولازم قبل أي rollback لـ TR أو EXPRESS-SHIPPING أو A1 (الاتنين
-- بيرفضوا طول ما v2 متطبّق).
-- • بيرجّع zell_checkout_track_order بجسم TR W1 بالحرف = قراءة T1 (md5(prosrc) edd7a26279a345963c68d69425f0ea1a ·
--   md5(pg_get_functiondef) 6d2d323e0801fa43053984f2504ba3c4 · sha256
--   e7fec5a9f85d67e922c6b9a1a7439e16510d8c0c41d0e918388427c773e069bc — CI بيثبت التلاتة)، بنفس المالك والصلاحيات
--   بالظبط (CREATE OR REPLACE مابيلمسش الصلاحيات)، ويشيل الدوال الـ 11 والجداول الأربعة.
-- • بيرفض (forward-fix بس): أي صف في أي جدول من الأربعة — شحنة أو رسالة أو سطر سجل (ZELL_0021TR2_RB_HAS_DATA) · دالة التتبّع
--   مش جسم v2 بالحرف أو صلاحياتها اتغيّرت (ZELL_0021TR2_RB_TRACK_DRIFT).
-- التشغيل: سطر الموافقة بعد begin;:  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0021tr2-track-order-v2-rollback';
-- ⚠ بيتشغّل على Production بموافقة صريحة بس. بياخد قفل ACCESS EXCLUSIVE على الجداول الأربعة لحد commit.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $tr2rb$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_tr oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021TR2_RB_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021TR2_RB_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regclass('public.zell_order_shipments') is null
     or pg_catalog.to_regclass('public.zell_order_shipments_log') is null
     or pg_catalog.to_regclass('public.zell_order_customer_updates') is null
     or pg_catalog.to_regclass('public.zell_order_customer_updates_log') is null
     or v_tr is null then
    raise exception 'ZELL_0021TR2_RB_NOT_APPLIED';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') <> 1
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_tr
                   and (pg_catalog.md5(p.prosrc) <> '14dad4721c48b73ee5e040bf7436bfc5'
                        or pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.proconfig is distinct from array['search_path=""']
                        or coalesce(p.proacl::text, '') <> '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}')) then
    raise exception 'ZELL_0021TR2_RB_TRACK_DRIFT';
  end if;
end
$tr2rb$;

lock table public.zell_order_shipments, public.zell_order_shipments_log,
  public.zell_order_customer_updates, public.zell_order_customer_updates_log in access exclusive mode;

do $tr2rbdata$
begin
  if exists (select 1 from public.zell_order_shipments) or exists (select 1 from public.zell_order_shipments_log)
     or exists (select 1 from public.zell_order_customer_updates) or exists (select 1 from public.zell_order_customer_updates_log) then
    raise exception 'ZELL_0021TR2_RB_HAS_DATA';
  end if;
end
$tr2rbdata$;

-- دالة التتبّع بجسم TR W1 بالحرف أولًا (قبل ما الجداول تتشال)، وبعدين الدوال، كـ zell_order_definer (المالك).
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create or replace function public.zell_checkout_track_order(p_order_number text)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select pg_catalog.jsonb_build_object(
           'order_number',   o.order_number,
           'status',         o.status,
           'created_at',     o.created_at,
           'total_piastres', o.total_piastres,
           'items', (
             select coalesce(
                      pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                          'product_name_ar',     i.product_name_ar,
                          'length_cm',           i.length_cm,
                          'width_cm',            i.width_cm,
                          'quantity',            i.quantity,
                          'sale_unit',           i.sale_unit,
                          'line_total_piastres', i.line_total_piastres)
                        order by i.id),
                      '[]'::jsonb)
               from public.order_items i
              where i.order_id = o.id),
           'delivery', case
             when o.delivery_confirmed_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'confirmed'::text,
               'date',   pg_catalog.to_char(o.delivery_confirmed_date, 'YYYY-MM-DD'),
               'period', o.delivery_confirmed_period)
             when o.preferred_delivery_date is not null then pg_catalog.jsonb_build_object(
               'kind',   'preferred'::text,
               'date',   pg_catalog.to_char(o.preferred_delivery_date, 'YYYY-MM-DD'),
               'period', o.preferred_delivery_period)
           end)
    from public.orders o
   where p_order_number ~ '^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
     and o.order_number = p_order_number
$fn$;

drop function public.zell_customer_update_set_hidden(text, bigint, timestamptz, boolean);
drop function public.zell_customer_update_edit(text, bigint, timestamptz, text);
drop function public.zell_customer_update_add(text, text);
drop function public.zell_customer_update_list(text);
drop function public.zell_customer_update_text(text);
drop function public.zell_customer_update_result(integer);
drop function public.zell_shipment_save(text, timestamptz, text, text, text, date, date);
drop function public.zell_shipment_get(text);
drop function public.zell_shipment_result(integer);

reset role;
revoke create on schema public from zell_order_definer;

drop table public.zell_order_customer_updates_log;
drop table public.zell_order_customer_updates;
drop table public.zell_order_shipments_log;
drop table public.zell_order_shipments;
drop function public.zell_customer_update_trg_append_only();
drop function public.zell_shipment_trg_append_only();

do $tr2rbpost$
declare
  v_tr oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
begin
  if v_tr is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') <> 1
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_tr
                   and (pg_catalog.md5(p.prosrc) <> 'edd7a26279a345963c68d69425f0ea1a'
                        or pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) <> '6d2d323e0801fa43053984f2504ba3c4'
                        or pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
                        or p.proconfig is distinct from array['search_path=""']
                        or coalesce(p.proacl::text, '') <> '{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}')) then
    raise exception 'ZELL_0021TR2_RB_POST_TRACK';
  end if;
  if exists (select 1 from pg_catalog.pg_class c
              where c.relname in ('zell_order_shipments', 'zell_order_shipments_log',
                                  'zell_order_customer_updates', 'zell_order_customer_updates_log'))
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%')
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE')
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4 then
    raise exception 'ZELL_0021TR2_RB_POST_LEFTOVERS';
  end if;
end
$tr2rbpost$;

commit;
