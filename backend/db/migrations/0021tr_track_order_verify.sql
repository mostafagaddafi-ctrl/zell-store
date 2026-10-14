-- 0021-TR W1 — التحقق بعد التطبيق (قراءة بس) لـ 0021tr_track_order.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • النداءات بدور service_role زي المتجر (set local role جوه المعاملة).
-- • V04 و V05 بيقروا آخر طلب (لو فيه طلبات) ويقارنوا رد الدالة بيه. التفاصيل من غير أي بيانات عميل: أسماء وأعداد بس.
--   من غير طلبات: V04 و V05 بيكتبوا «skip: no orders».
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (7 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';
set local role service_role;

with fn as (
  select p.oid, p.prosecdef, p.proconfig, p.provolatile, p.prorettype, pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)')
), cols(n) as (
  values ('id'), ('order_id'), ('product_name_ar'), ('length_cm'), ('width_cm'), ('quantity'), ('sale_unit'), ('line_total_piastres')
), sample as (
  select o.id, o.order_number, o.status, o.total_piastres, o.customer_phone, o.address
    from public.orders o order by o.id desc limit 1
), res as (
  select s.id, s.order_number, s.status, s.total_piastres, s.customer_phone, s.address,
         public.zell_checkout_track_order(s.order_number) as r
    from sample s
), missing as (
  select c.code from (values ('FLM-ZZZZZZ'), ('FLM-YYYYYY'), ('FLM-XXXXXX'), ('FLM-WWWWWW')) c(code)
   where not exists (select 1 from public.orders o where o.order_number = c.code)
   limit 1
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
  select 'V04', 'latest order: exactly the 6 keys · items with the 6 receipt keys · delivery null or {date, kind, period} · values = the order',
         case when not exists (select 1 from res) then true
              else coalesce((
                select (select pg_catalog.array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(res.r) k)
                         = array['created_at', 'delivery', 'items', 'order_number', 'status', 'total_piastres']
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
                  from res), false) end,
         case when not exists (select 1 from res) then 'skip: no orders' else 'checked: latest order' end
  union all
  select 'V05', 'no customer data in the response for the latest order (no phone / address value; the keys are checked in V04)',
         case when not exists (select 1 from res) then true
              else coalesce((
                select (res.customer_phone is null or pg_catalog.char_length(res.customer_phone) < 6
                        or pg_catalog.strpos(res.r::text, res.customer_phone) = 0)
                       and (res.address is null or pg_catalog.char_length(res.address) < 6
                            or pg_catalog.strpos(res.r::text, res.address) = 0)
                  from res), false) end,
         case when not exists (select 1 from res) then 'skip: no orders' else null end
  union all
  select 'V06', 'wrong shape or not found -> null (empty · NULL · lower case · no FLM- · no dash · leading space · bad letter · length · valid shape not found)',
         public.zell_checkout_track_order('') is null
         and public.zell_checkout_track_order(null) is null
         and public.zell_checkout_track_order('flm-abcdef') is null
         and public.zell_checkout_track_order('ABCDEF') is null
         and public.zell_checkout_track_order('FLM-ABCDE0') is null
         and public.zell_checkout_track_order('FLM-ABCDEFG') is null
         and coalesce((select public.zell_checkout_track_order(m.code) is null from missing m), false)
         and coalesce((select public.zell_checkout_track_order(pg_catalog.lower(res.order_number)) is null
                              and public.zell_checkout_track_order(pg_catalog.substr(res.order_number, 5)) is null
                              and public.zell_checkout_track_order(' ' || res.order_number) is null
                              and public.zell_checkout_track_order(pg_catalog.replace(res.order_number, '-', '')) is null
                         from res), true),
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
