-- 0021-TR W1 — «تتبّع طلبك»: دالة قراية للمتجر بكود الطلب (SQL بس)
--
-- العقد: docs/contracts/TRACK-ORDER.md (§٢ الدالة · §٥ المخاطر · §٦ الترتيب والموافقات).
--   • دالة واحدة zell_checkout_track_order(p_order_number text) returns jsonb: stable · security definer · search_path فاضي ·
--     مالكها zell_order_definer · EXECUTE لـ service_role بس (المتجر بيناديها من السيرفر).
--   • المدخل ^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$ بس. أي شكل تاني أو طلب مش موجود = null بالظبط (نفس النتيجة،
--     علشان الدالة ماتفرّقش بين «شكل غلط» و«مش موجود»). تظبيط اللي العميل كتبه في المتجر (W2)، مش هنا.
--   • الإسقاط بس: order_number · status · created_at · total_piastres · items (زي الإيصال: product_name_ar · length_cm ·
--     width_cm · quantity · sale_unit · line_total_piastres، بترتيب السطور) · delivery ({kind: confirmed, date, period} لو فيه
--     موعد مؤكد، وإلا {kind: preferred, date, period} لو فيه مفضّل، وإلا null؛ التاريخ YYYY-MM-DD).
--     ممنوع: الاسم والتليفون والعنوان والمحافظة والمنطقة والملاحظات (العميل والداخلية والموعد) والكوبون والمبالغ التفصيلية
--     ومعاد المتابعة والـ hashes ومفتاح الـ idempotency والدفعات.
--   • قرار تنفيذ (للمراجع): zell_order_definer مالوش أي صلاحية على order_items قبل كده (A1 أداله orders بس)، فالدالة محتاجة
--     SELECT على الأعمدة التمانية اللي بتقراها بس (id · order_id · product_name_ar · length_cm · width_cm · quantity · sale_unit ·
--     line_total_piastres) + policy قراية واحدة zell_order_definer_select على order_items. مفيش أي تعديل في عمود ولا قيد ولا
--     trigger ولا دالة موجودة، ولا في صلاحيات anon و authenticated و service_role على أي جدول.
--   • الاسم zell_checkout_*، فعدّادات zell_order_* (24) و zell_payment_* (24) مابتتغيّرش، و zell_checkout_* بتبقى 4.
--   • مفيش أكواد أخطاء جديدة، ومفيش أي خانة في استعلام الأثر (IMPACT_SQL بتاع P1) بتتغيّر.
-- بعد A1 و D و P1 و P2 و D2 (الـ preflight بيتأكد). الرجوع: 0021tr_track_order_rollback.sql (مفيش بيانات، فمسموح دايمًا).
-- التحقق: 0021tr_track_order_verify.sql · الاختبار قبل التطبيق: 0021tr_track_order_ptest.sql · CI: backend/db/ci/0021tr_sql_ci.sh
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0021tr-track-order';
--   (التاريخ = يوم التطبيق الفعلي؛ من غيره ZELL_0021TR_APPROVAL_MISSING)
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، وقبل W2 (المتجر).

begin;
-- >>> 0021TR BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · مش متطبّق قبل كده · المتطلبات (A1 · D · P1 · P2 · D2).
do $trpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021TR_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0021TR_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null then
    raise exception 'ZELL_0021TR_PREREQ_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order')
     or exists (select 1 from pg_catalog.pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select')
     or pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'SELECT,INSERT,UPDATE,REFERENCES')
     or pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'ZELL_0021TR_ALREADY_APPLIED';
  end if;
  if pg_catalog.to_regprocedure('public.zell_checkout_delivery_periods()') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_confirmation_fee()') is null
     or pg_catalog.to_regprocedure('public.zell_checkout_delivery_settings()') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 3
     or not pg_catalog.has_table_privilege('zell_order_definer', 'public.orders', 'SELECT')
     or (select count(*) from pg_catalog.pg_attribute a
          where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
            and a.attname in ('delivery_confirmed_date', 'delivery_confirmed_period',
                              'preferred_delivery_date', 'preferred_delivery_period')) <> 4 then
    raise exception 'ZELL_0021TR_PREREQ_MISSING';
  end if;
end
$trpre$;

-- (1) قراية order_items للدالة: الأعمدة التمانية اللي في الإسقاط بس + policy قراية لـ zell_order_definer.
--     RLS على order_items وصلاحيات باقي الأدوار زي ما هي.
grant select (id, order_id, product_name_ar, length_cm, width_cm, quantity, sale_unit, line_total_piastres)
  on table public.order_items to zell_order_definer;
create policy zell_order_definer_select on public.order_items for select to zell_order_definer using (true);

-- (2) الدالة: مالكها zell_order_definer، EXECUTE لـ service_role بس — زي zell_checkout_delivery_periods و
--     zell_checkout_confirmation_fee و zell_checkout_delivery_settings.
grant create on schema public to zell_order_definer;
set local role zell_order_definer;

create function public.zell_checkout_track_order(p_order_number text)
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

revoke all on function public.zell_checkout_track_order(text) from public, anon, authenticated, service_role;
grant execute on function public.zell_checkout_track_order(text) to service_role;

reset role;
revoke create on schema public from zell_order_definer;

-- (3) postflight
do $trpost$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.zell_checkout_track_order(text)');
begin
  if v_oid is null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = v_oid
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_order_definer' or not p.prosecdef
                        or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
                        or p.proconfig is distinct from array['search_path=""']))
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 where p.oid = v_oid and a.grantee = 0)
     or exists (select 1
                  from (values ('id'), ('order_id'), ('product_name_ar'), ('length_cm'), ('width_cm'),
                               ('quantity'), ('sale_unit'), ('line_total_piastres')) c(n)
                 where not pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', c.n, 'SELECT'))
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped
                   and a.attname::text not in ('id', 'order_id', 'product_name_ar', 'length_cm', 'width_cm',
                                               'quantity', 'sale_unit', 'line_total_piastres')
                   and pg_catalog.has_column_privilege('zell_order_definer', 'public.order_items', a.attname::text, 'SELECT'))
     or pg_catalog.has_table_privilege('zell_order_definer', 'public.order_items',
                                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or pg_catalog.has_any_column_privilege('zell_order_definer', 'public.order_items', 'INSERT,UPDATE,REFERENCES')
     or (select count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select'
            and p.cmd = 'SELECT' and p.roles = array['zell_order_definer']::name[]) <> 1
     or pg_catalog.has_schema_privilege('zell_order_definer', 'public', 'CREATE')
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') <> 24
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_checkout\_%') <> 4 then
    raise exception 'ZELL_0021TR_POST_SHAPE';
  end if;
end
$trpost$;
-- <<< 0021TR BODY
commit;
