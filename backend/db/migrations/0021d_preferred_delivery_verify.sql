-- 0021-D — التحقق بعد التطبيق (قراءة بس) لـ 0021d_preferred_delivery.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (ord = 0 ملخص).
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict · 8 orders_total · 9 statuses
--   · 10 with_preferred · 11 create_order_owner
-- • V02 بحالتين بس (عقد EXPRESS-SHIPPING §٦-١): قبل EXPRESS (مفيش جدول zell_shipping_options) = 14 معامل بالحرف ·
--   بعده (الجدول موجود) = نفس الـ 14 + p_shipping_method text. أي خليط أو نسختين = FAIL.

begin;
set transaction read only;
set local statement_timeout = '30s';

with fn as (
  select p.oid, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'
), checks(id, name, ok, detail) as (
  select 'V01', 'orders: 3 preferred columns + shape check',
         (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped
            and a.attname in ('preferred_delivery_date', 'preferred_delivery_period', 'preferred_delivery_note')) = 3
         and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass
                      and c.conname = 'orders_preferred_delivery_shape' and c.convalidated),
         null::text
  union all
  select 'V02', 'one zell_create_order: 14 args before EXPRESS-SHIPPING / 15 args (+ p_shipping_method text) after (no overload, no mixed state)',
         (select count(*) from fn) = 1
         and (select pg_catalog.pg_get_function_identity_arguments(fn.oid) from fn) = 'p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text, p_installation boolean, p_coupon_code text, p_preferred_delivery jsonb'
             || case when pg_catalog.to_regclass('public.zell_shipping_options') is null then '' else ', p_shipping_method text' end,
         (select count(*) from fn)::text
           || case when pg_catalog.to_regclass('public.zell_shipping_options') is null then ' before EXPRESS-SHIPPING' else ' after EXPRESS-SHIPPING' end
  union all
  select 'V03', 'security definer + search_path empty + new body (preferred validation)',
         (select fn.prosecdef and fn.proconfig = array['search_path=""'] from fn)
         and (select p.prosrc like '%ZELL_PREFERRED_DELIVERY_INVALID%' from pg_catalog.pg_proc p join fn on fn.oid = p.oid),
         (select fn.owner from fn)
  union all
  select 'V04', 'EXECUTE: service_role yes, anon / authenticated no',
         (select pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE')
             and not pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')
             and not pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE') from fn),
         null
  union all
  select 'V05', 'receipt returns preferred_delivery, anon / authenticated no EXECUTE',
         (select p.prosrc like '%preferred_delivery%' from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)'))
         and not pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)'), 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)'), 'EXECUTE'),
         null
  union all
  select 'V06', 'zell_checkout_delivery_periods: owner zell_order_definer, service_role only',
         coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_order_definer'
                     and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()')), false),
         null
  union all
  select 'V07', 'owner can write the new columns',
         (select pg_catalog.has_column_privilege(fn.owner, 'public.orders', 'preferred_delivery_date', 'INSERT')
             and pg_catalog.has_column_privilege(fn.owner, 'public.orders', 'preferred_delivery_note', 'INSERT') from fn),
         null
  union all
  select 'V08', 'A1 intact: 24 zell_order_* functions, gate row present',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from public.zell_order_gate) = 1,
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok,
       null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from public.orders) as orders_total,
       (select string_agg(s.status || '=' || s.n, ',' order by s.status) from (select o.status, count(*) as n from public.orders o group by o.status) s) as statuses,
       (select count(*) from public.orders o where o.preferred_delivery_date is not null) as with_preferred,
       (select fn.owner from fn) as create_order_owner
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null, null, null, null, null
  from checks c
order by 1;

rollback;
