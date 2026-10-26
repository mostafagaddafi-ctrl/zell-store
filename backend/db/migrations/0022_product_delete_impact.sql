-- 0022 PRODUCT-DELETE — استعلام الأثر (قراءة بس) قبل التطبيق على Production وبعده على طول، بنفس النص بالحرف.
--
-- • معاملة read only بترجع: أول جملة begin وآخر جملة rollback، وصف واحد في SELECT واحد. مفيش أي كتابة ولا DDL.
-- • الوقت UTC (timezone = UTC جوه المعاملة، فنص التواريخ في البصمات ثابت مهما كانت إعدادات الجلسة)، ومهلة للجملة
--   وللمعاملة الخاملة 15s.
-- • البيانات: أعداد + بصمات محتوى الصفوف كاملة (md5 لنص كل صف مرتّب) للمنتجات والصور والعروض والإضافات والأقسام
--   والإعدادات وstorage_orphans، علشان أي تغيير بنفس العدد يبان. من غير أي بيانات عملاء في الناتج.
-- • المعاملات والأقفال: قاعدة البيانات الحالية بس (current_database()).
--     idle_tx    = جلسات «idle in transaction» في نفس القاعدة غيرنا ← وقف لو > 0.
--     stop_locks = أقفال جلسات تانية على جداول 0022 الثمانية من النوع اللي بيعطّل التطبيق: مستني (not granted)، أو أقوى من
--                  RowExclusive (ShareUpdateExclusive · Share · ShareRowExclusive · Exclusive · AccessExclusive)، أو
--                  ماسكها جلسة idle in transaction ← وقف لو > 0.
--     all_locks  = كل أقفال الجلسات التانية على الجداول دي (قراية وكتابة عادية من المتجر واللوحة) ← معلومة بس.
-- • المقارنة: الأعمدة 2–9 (كائنات 0022) بتتغيّر بالأرقام اللي في CI، والأعمدة 10–31 لازم تفضل زي الـ baseline بالظبط.
--   CI: backend/db/ci/0022_sql_ci.sh (IMP0–IMP5) بيشغّل الملف ده نفسه قبل التطبيق وبعده وبعد الرجوع.
-- • أعمدة psql -tA بالترتيب (34): 1 observed_at_utc · 2 catalog_role · 3 new_fns · 4 new_policies · 5 new_trigger ·
--   6 inv_helper_grant · 7 orphan_reason_check · 8 code_users · 9 inv_fns · 10 order_fns · 11 identity_stock_md5 · 12 products ·
--   13 hidden_products · 14 price_sum · 15 products_fp · 16 images · 17 images_fp · 18 widths · 19 widths_fp · 20 addon_links ·
--   21 addons_fp · 22 collection_links · 23 collections_fp · 24 settings_fp · 25 home_md5 · 26 home_stale_ids ·
--   27 orphans_by_reason · 28 orphans_pending · 29 orphans_fp · 30 orders · 31 order_items · 32 idle_tx · 33 stop_locks · 34 all_locks

begin;
set transaction read only;
set local timezone = 'UTC';
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';

with tgt as (
  select c.oid from pg_catalog.pg_class c
   where c.oid in ('public.products'::regclass, 'public.product_images'::regclass, 'public.product_widths'::regclass, 'public.product_addons'::regclass, 'public.product_collections'::regclass, 'public.order_items'::regclass, 'public.settings'::regclass, 'public.storage_orphans'::regclass)
), lk as (
  select l.mode, l.granted, a.state
    from pg_catalog.pg_locks l
    left join pg_catalog.pg_stat_activity a on a.pid = l.pid
   where l.database = (select d.oid from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
     and l.relation in (select oid from tgt)
     and l.pid <> pg_catalog.pg_backend_pid()
)
select
 pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as observed_at_utc,
 (select count(*) from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer') as catalog_role,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('zell_product_delete', 'zell_product_delete_preview', 'zell_catalog_trg_home_products_guard', 'zell_inv_product_stock_ref_exists')) as new_fns,
 (select count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%') as new_policies,
 (select count(*) from pg_catalog.pg_trigger t where t.tgname = 'zell_catalog_home_products_guard') as new_trigger,
 pg_catalog.has_function_privilege('zell_inventory_definer', 'public.zell_inv_product_has_stock_refs(integer)', 'EXECUTE') as inv_helper_grant,
 (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
   where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check') as orphan_reason_check,
 (select count(*) from pg_catalog.pg_proc p where p.prosrc ~ '4550[1-8]') as code_users,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') as inv_fns,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') as order_fns,
 (select coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.proname), '') from pg_catalog.pg_proc p
   where p.oid in (pg_catalog.to_regprocedure('public.zell_order_actor(boolean)'), pg_catalog.to_regprocedure('public.zell_order_claims_actor()'),
                   pg_catalog.to_regprocedure('public.zell_order_admin_role(uuid)'), pg_catalog.to_regprocedure('public.zell_inv_product_has_stock_refs(integer)'))) as identity_stock_md5,
 (select count(*) from public.products) as products,
 (select count(*) from public.products p where not p.is_active) as hidden_products,
 (select coalesce(sum(p.price_per_meter_piastres), 0) from public.products p) as price_sum,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.products t) as products_fp,
 (select count(*) from public.product_images) as images,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_images t) as images_fp,
 (select count(*) from public.product_widths) as widths,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_widths t) as widths_fp,
 (select count(*) from public.product_addons) as addon_links,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_addons t) as addons_fp,
 (select count(*) from public.product_collections) as collection_links,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_collections t) as collections_fp,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.settings t) as settings_fp,
 coalesce((select pg_catalog.md5(s.value::text) from public.settings s where s.key = 'home_products'), '-') as home_md5,
 (select count(*) from public.settings s
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(s.value -> 'ids') = 'array' then s.value -> 'ids' else '[]'::jsonb end) as x(e)
   where s.key = 'home_products' and pg_catalog.jsonb_typeof(x.e) = 'number'
     and not exists (select 1 from public.products p where pg_catalog.to_jsonb(p.id) = x.e)) as home_stale_ids,
 (select coalesce(pg_catalog.string_agg(s.reason || '=' || s.n, ',' order by s.reason), '')
    from (select o.reason, count(*) as n from public.storage_orphans o group by o.reason) s) as orphans_by_reason,
 (select count(*) from public.storage_orphans o where o.cleaned_at is null) as orphans_pending,
 (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.storage_orphans t) as orphans_fp,
 (select count(*) from public.orders) as orders,
 (select count(*) from public.order_items) as order_items,
 (select count(*) from pg_catalog.pg_stat_activity a
   where a.datname = pg_catalog.current_database() and a.state like 'idle in transaction%' and a.pid <> pg_catalog.pg_backend_pid()) as idle_tx,
 (select count(*) from lk
   where not lk.granted
      or lk.mode not in ('AccessShareLock', 'RowShareLock', 'RowExclusiveLock')
      or coalesce(lk.state, '') like 'idle in transaction%') as stop_locks,
 (select count(*) from lk) as all_locks;

rollback;
