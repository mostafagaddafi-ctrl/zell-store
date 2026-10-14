-- 0021-TR W1 — التحقق بعد التطبيق (قراءة بس) لـ 0021tr_track_order.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • النداءات بدور service_role زي المتجر (set local role جوه بلوك DO، والنتايج في إعدادات محلية للمعاملة)، والمقارنة بعدها.
-- • V04 و V05 بيقروا آخر طلب (لو فيه طلبات) ويقارنوا رد الدالة بيه. التفاصيل من غير أي بيانات عميل: أسماء وأعداد بس.
--   من غير طلبات: V04 و V05 بيكتبوا «skip: no orders».
-- • بحالتين بس (عقد TRACK-ORDER-v2 §١٢): قبل v2 (مفيش جدول zell_order_shipments) = الستة مفاتيح بالحرف، و V05 «مفيش هاتف ولا
--   عنوان» · بعده (الجدول موجود) = مفاتيح v1 + v2 بالحرف (13) وقيم customer و money من الطلب، و V05 «مفيش internal_notes ولا
--   notes ولا ملاحظات الموعد ولا مراجع الدفع ولا سبب ولا ممثل ولا كوبون ولا hash» (كقيمة نصية بالظبط، ومفيش مفتاح بالأسماء دي).
--   أي خليط (رد v1 والجدول موجود، أو العكس) = FAIL. V07 = 4 في الحالتين.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (7 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

do $trvcall$
declare
  v_num text;
  v_missing text;
  v_ok boolean;
begin
  set local role service_role;
  select o.order_number into v_num from public.orders o order by o.id desc limit 1;
  select c.code into v_missing
    from (values ('FLM-ZZZZZZ'), ('FLM-YYYYYY'), ('FLM-XXXXXX'), ('FLM-WWWWWW')) c(code)
   where not exists (select 1 from public.orders o where o.order_number = c.code)
   limit 1;
  v_ok := public.zell_checkout_track_order('') is null
          and public.zell_checkout_track_order(null) is null
          and public.zell_checkout_track_order('flm-abcdef') is null
          and public.zell_checkout_track_order('ABCDEF') is null
          and public.zell_checkout_track_order('FLM-ABCDE0') is null
          and public.zell_checkout_track_order('FLM-ABCDEFG') is null
          and v_missing is not null and public.zell_checkout_track_order(v_missing) is null;
  if v_num is not null then
    v_ok := v_ok
            and public.zell_checkout_track_order(pg_catalog.lower(v_num)) is null
            and public.zell_checkout_track_order(pg_catalog.substr(v_num, 5)) is null
            and public.zell_checkout_track_order(' ' || v_num) is null
            and public.zell_checkout_track_order(pg_catalog.replace(v_num, '-', '')) is null;
  end if;
  perform pg_catalog.set_config('zell.trv_num', coalesce(v_num, ''), true);
  perform pg_catalog.set_config('zell.trv_res',
    case when v_num is null then '' else coalesce(public.zell_checkout_track_order(v_num)::text, 'null') end, true);
  perform pg_catalog.set_config('zell.trv_v06', coalesce(v_ok, false)::text, true);
  reset role;
end
$trvcall$;

with fn as (
  select p.oid, p.prosecdef, p.proconfig, p.provolatile, p.prorettype, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')
), cols(n) as (
  values ('id'), ('order_id'), ('product_name_ar'), ('length_cm'), ('width_cm'), ('quantity'), ('sale_unit'), ('line_total_piastres')
), st as (
  select pg_catalog.to_regclass('public.zell_order_shipments') is not null as v2
), res as (
  select o.id, o.order_number, o.status, o.total_piastres, o.customer_phone, o.address, pg_catalog.to_jsonb(o) as oj,
         nullif(pg_catalog.current_setting('zell.trv_res'), '')::jsonb as r
    from public.orders o
   where o.order_number = nullif(pg_catalog.current_setting('zell.trv_num'), '')
), secrets(v) as (
  select x.v
    from res, lateral (values (res.oj ->> 'internal_notes'), (res.oj ->> 'notes'), (res.oj ->> 'preferred_delivery_note'),
                              (res.oj ->> 'delivery_confirmed_note')) x(v)
   where pg_catalog.char_length(x.v) >= 6
  union all
  select x.v
    from res, lateral (values (res.oj ->> 'idempotency_key'), (res.oj ->> 'request_hash'), (res.oj ->> 'checkout_session_hash'),
                              (res.oj ->> 'receipt_token_hash')) x(v)
   where x.v is not null and x.v <> ''
  union all
  select res.oj ->> 'coupon_code' from res where pg_catalog.char_length(res.oj ->> 'coupon_code') >= 4
  union all
  select x.v
    from res join public.order_payments p on p.order_id = res.id,
         lateral (values (p.reference), (p.note), (p.method_name)) x(v)
   where pg_catalog.char_length(x.v) >= 6
  union all
  select e.payload ->> 'reason' from res join public.order_events e on e.order_id = res.id
   where e.kind = 'status_changed' and pg_catalog.char_length(e.payload ->> 'reason') >= 6
  union all
  select e.actor::text from res join public.order_events e on e.order_id = res.id where e.actor is not null
  union all
  select p.actor::text from res join public.order_payments p on p.order_id = res.id where p.actor is not null
), checks(id, name, ok, detail) as (
  select 'V01', 'zell_checkout_track_order(text): one function, owner zell_order_definer, security definer, stable, returns jsonb, search_path empty',
         coalesce((select fn.owner = 'zell_order_definer' and fn.prosecdef and fn.provolatile = 's'
                          and fn.prorettype = 'jsonb'::regtype and fn.proconfig = array['search_path=""'] from fn), false)
         and (select count(*) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order') = 1,
         (select fn.owner::text from fn)
  union all
  select 'V02', 'EXECUTE: service_role only (anon / authenticated / PUBLIC no)',
         coalesce((select pg_catalog.has_function_privilege('service_role', fn.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('anon', fn.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('authenticated', fn.oid, 'EXECUTE')
                     and not exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                                      where p.oid = fn.oid and a.grantee = 0)
                     from fn), false),
         null
  union all
  select 'V03', 'order_items: zell_order_definer SELECT on the 8 projected columns only + one SELECT policy for it',
         not exists (select 1 from cols
                      where not pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', cols.n, 'SELECT'))
         and not exists (select 1 from pg_catalog.pg_attribute a
                          where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped
                            and a.attname::text not in (select cols.n from cols)
                            and pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', a.attname::text, 'SELECT'))
         and not pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and not pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'INSERT,UPDATE,REFERENCES')
         and (select count(*) from pg_catalog.pg_policies p
               where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select'
                 and p.cmd = 'SELECT' and p.roles = array['zell_order_definer']::name[]) = 1,
         null
  union all
  select 'V04', 'latest order: exactly the 6 keys before TRACK-ORDER v2 / the 13 v1 + v2 keys after · items with the 6 receipt keys · delivery null or {date, kind, period} · values = the order (after v2: customer · money · history · shipping · confirmed_delivery · shipment · updates shapes too)',
         case when not exists (select 1 from res) then true
              else coalesce((
                select (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(res.r) k)
                         = case when st.v2
                                then array['confirmed_delivery', 'created_at', 'customer', 'delivery', 'history', 'items', 'money',
                                           'order_number', 'shipment', 'shipping', 'status', 'total_piastres', 'updates']
                                else array['created_at', 'delivery', 'items', 'order_number', 'status', 'total_piastres'] end
                       and res.r ->> 'order_number' = res.order_number
                       and res.r ->> 'status' = res.status
                       and (res.r ->> 'total_piastres')::bigint = res.total_piastres
                       and pg_catalog.jsonb_typeof(res.r -> 'items') = 'array'
                       and pg_catalog.jsonb_array_length(res.r -> 'items')
                             = (select count(*) from public.order_items i where i.order_id = res.id)
                       and not exists (
                             select 1 from pg_catalog.jsonb_array_elements(res.r -> 'items') e(v)
                              where (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(e.v) k)
                                    is distinct from array['length_cm', 'line_total_piastres', 'product_name_ar',
                                                           'quantity', 'sale_unit', 'width_cm'])
                       and case when res.r -> 'delivery' = 'null'::jsonb then true
                                when pg_catalog.jsonb_typeof(res.r -> 'delivery') = 'object' then
                                  (select pg_catalog.array_agg(k order by k collate "C")
                                     from pg_catalog.jsonb_object_keys(res.r -> 'delivery') k) = array['date', 'kind', 'period']
                                  and res.r -> 'delivery' ->> 'kind' in ('confirmed', 'preferred')
                                else false end
                       and (not st.v2 or (
                             res.r -> 'customer' = pg_catalog.jsonb_build_object(
                               'name', res.oj -> 'customer_name', 'phone', res.oj -> 'customer_phone', 'address', res.oj -> 'address',
                               'governorate', res.oj -> 'governorate', 'area', res.oj -> 'shipping_area')
                             and (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(res.r -> 'money') k)
                                 = array['confirmation_fee_piastres', 'discount_piastres', 'installation_piastres', 'items_piastres',
                                         'net_paid_piastres', 'paid_piastres', 'refunded_piastres', 'remaining_piastres',
                                         'shipping_piastres', 'total_piastres', 'travel_piastres']
                             and (res.r -> 'money' ->> 'total_piastres')::bigint = res.total_piastres
                             and res.r -> 'money' -> 'net_paid_piastres' = res.oj -> 'paid_piastres'
                             and (res.r -> 'money' ->> 'paid_piastres')::bigint
                                 = coalesce((select pg_catalog.sum(p.amount_piastres) from public.order_payments p
                                              where p.order_id = res.id and p.kind = 'payment'), 0)
                             and (res.r -> 'money' ->> 'refunded_piastres')::bigint
                                 = coalesce((select pg_catalog.sum(p.amount_piastres) from public.order_payments p
                                              where p.order_id = res.id and p.kind = 'refund'), 0)
                             and (res.r -> 'money' ->> 'net_paid_piastres')::bigint
                                 = (res.r -> 'money' ->> 'paid_piastres')::bigint - (res.r -> 'money' ->> 'refunded_piastres')::bigint
                             and (res.r -> 'money' ->> 'remaining_piastres')::bigint
                                 = greatest(res.total_piastres - (res.oj ->> 'paid_piastres')::bigint, 0)
                             and pg_catalog.jsonb_typeof(res.r -> 'history') = 'array'
                             and pg_catalog.jsonb_array_length(res.r -> 'history')
                                 = (select count(*) from public.order_events e
                                     where e.order_id = res.id and e.kind in ('created', 'status_changed'))
                             and not exists (
                                   select 1 from pg_catalog.jsonb_array_elements(res.r -> 'history') e(v)
                                    where (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(e.v) k)
                                          is distinct from array['at', 'status'])
                             and res.r -> 'shipping'
                                 = case when res.oj -> 'shipping_method' = 'null'::jsonb then 'null'::jsonb
                                        else pg_catalog.jsonb_build_object('method', res.oj -> 'shipping_method',
                                                                           'days_min', res.oj -> 'shipping_days_min',
                                                                           'days_max', res.oj -> 'shipping_days_max') end
                             and (res.r -> 'confirmed_delivery' = 'null'::jsonb) = (res.oj -> 'delivery_confirmed_date' = 'null'::jsonb)
                             and (res.r -> 'confirmed_delivery' = 'null'::jsonb
                                  or (select pg_catalog.array_agg(k order by k collate "C")
                                        from pg_catalog.jsonb_object_keys(res.r -> 'confirmed_delivery') k) = array['date', 'period'])
                             and (res.r -> 'shipment' = 'null'::jsonb
                                  or (select pg_catalog.array_agg(k order by k collate "C")
                                        from pg_catalog.jsonb_object_keys(res.r -> 'shipment') k)
                                     = array['carrier', 'expected_on', 'shipped_on', 'tracking_number', 'tracking_url'])
                             and pg_catalog.jsonb_typeof(res.r -> 'updates') = 'array'
                             and not exists (
                                   select 1 from pg_catalog.jsonb_array_elements(res.r -> 'updates') e(v)
                                    where (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(e.v) k)
                                          is distinct from array['at', 'edited', 'id', 'text'])))
                  from res, st), false) end,
         case when not exists (select 1 from res) then 'skip: no orders'
              when (select st.v2 from st) then 'checked: latest order (v2 keys)' else 'checked: latest order (v1 keys)' end
  union all
  select 'V05', 'latest order, no forbidden data: before TRACK-ORDER v2 no phone / address value · after it no internal / customer / appointment notes, payment reference / note / method, reason, actor, coupon or hash (exact string values) and no key with those names',
         case when not exists (select 1 from res) then true
              when not (select st.v2 from st) then coalesce((
                select (res.customer_phone is null or pg_catalog.char_length(res.customer_phone) < 6
                        or pg_catalog.strpos(res.r::text, res.customer_phone) = 0)
                       and (res.address is null or pg_catalog.char_length(res.address) < 6
                            or pg_catalog.strpos(res.r::text, res.address) = 0)
                  from res), false)
              else coalesce((
                select not exists (select 1 from secrets s where pg_catalog.strpos(res.r::text, pg_catalog.to_jsonb(s.v)::text) > 0)
                       and res.r::text !~ '"(reason|actor|internal_notes|notes|note|reference|coupon_code|coupon_id|method_name|method_id|idempotency_key|request_hash|receipt_token_hash|checkout_session_hash|updated_by|created_by|hidden|paid_after_piastres)":'
                  from res), false) end,
         case when not exists (select 1 from res) then 'skip: no orders'
              when (select st.v2 from st) then 'values checked: ' || (select pg_catalog.count(*) from secrets) else null end
  union all
  select 'V06', 'wrong shape or not found -> null (empty · NULL · lower case · no FLM- · no dash · leading space · bad letter · length · valid shape not found)',
         pg_catalog.current_setting('zell.trv_v06') = 'true',
         null
  union all
  select 'V07', 'counters intact: 24 zell_order_* · 24 zell_payment_* · 4 zell_checkout_*',
         (select count(*) from pg_catalog.pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') = 4,
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 7 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
