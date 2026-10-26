-- 0022 PRODUCT-DELETE — سيناريوهات الحذف بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0022_sql_ci.sh بعد تطبيق 0022_product_delete.sql على داتابيز مبنية من الصفر
--   (backend/db/ci/build_from_scratch.list).
-- • الهويات: مالك ...a1 (fixture before_0020_owner) · أدمن شغّال ...a2 · أدمن موقوف ...a3 · مستخدم auth مش أدمن ...a4
--   (التلاتة الأخيرين من سكربت الـ CI).
-- • منتجين من سكربت الـ CI (committed): ci-0022-orders (عليه order_items) و ci-0022-stock (عليه سطر رصيد افتتاحي).
-- • «مفيش تغيير» = بصمة محتوى كل صفوف الجداول (pg_temp.fp): المنتجات وتوابعها والأقسام والطلبات وأصنافها والإعدادات
--   وstorage_orphans والمخزون وadmin_users. النجاح = نفس البصمة من غير صفوف المنتج المحذوف وصف home_products والصور الجديدة.
-- • آخر بلوك (G) بيشيل فحص الطلبات أو المخزون بشكل مصطنع (policy restrictive) وبيسحب منحة الـ helper، جوه نفس المعاملة.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 25 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '60s';
set local statement_timeout = '120s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary table zp (tag text primary key, id integer not null) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

-- النداء بدور وclaims (نص JSON كما هو، أو '' من غير جلسة). النتيجة نص، أو 'ERR <sqlstate> <detail>'.
create function pg_temp.call_raw(p_role text, p_claims text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
  v_detail text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    execute 'set local role ' || pg_catalog.quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    return 'ERR ' || v_state || ' ' || coalesce(v_detail, '');
  end;
  return coalesce(r, 'null');
end
$f$;

-- النداء بجلسة authenticated (sub) أو من غير جلسة (NULL).
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language sql as $f$
  select pg_temp.call_raw(p_role,
    case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, p_sql);
$f$;

create function pg_temp.js(p text) returns jsonb language sql as $f$
  select case when p is null or p like 'ERR%' or p = 'null' then null else p::jsonb end;
$f$;

create function pg_temp.pid(p_tag text) returns integer language sql as $f$
  select z.id from pg_temp.zp z where z.tag = p_tag;
$f$;

-- منتج تجريبي: صف + صور (products/<id>/ci-<n>.jpg) + مقاس واحد.
create function pg_temp.mk(p_tag text, p_active boolean, p_images integer)
returns integer language plpgsql as $f$
declare
  v_id integer;
  i integer;
begin
  insert into public.products (name_ar, price_per_meter_piastres, is_active)
  values ('ci-0022-' || p_tag, 1000, p_active) returning id into v_id;
  for i in 1 .. p_images loop
    insert into public.product_images (product_id, object_path, sort_order)
    values (v_id, 'products/' || v_id || '/ci-' || i || '.jpg', i - 1);
  end loop;
  insert into public.product_widths (product_id, width_cm, price_per_meter_piastres) values (v_id, 60, 1200);
  insert into pg_temp.zp (tag, id) values (p_tag, v_id);
  return v_id;
end
$f$;

create function pg_temp.ver(p integer) returns text language sql as $f$
  select p2.updated_at::text from public.products p2 where p2.id = p;
$f$;

create function pg_temp.del_sql(p integer, v text) returns text language sql as $f$
  select pg_catalog.format('select public.zell_product_delete(%s, %L::timestamptz)::text', coalesce(p::text, 'null'), v);
$f$;

create function pg_temp.pre_sql(p integer) returns text language sql as $f$
  select pg_catalog.format('select public.zell_product_delete_preview(%s)::text', p);
$f$;

create function pg_temp.home() returns jsonb language sql as $f$
  select s.value from public.settings s where s.key = 'home_products';
$f$;

-- بصمة محتوى كل الصفوف. p_ids = منتجات مستثناة بصفوف توابعها (وصف home_products لو فيه استثناء)،
-- p_om = آخر id في storage_orphans محسوب (الأحدث مستثنى). fp('{}', null) = الداتابيز كلها.
create function pg_temp.fp(p_ids integer[], p_om bigint) returns text language sql as $f$
  select pg_catalog.md5(pg_catalog.concat_ws('|',
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.products t where not (t.id = any (p_ids))),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_images t where not (t.product_id = any (p_ids))),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_widths t where not (t.product_id = any (p_ids))),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_addons t where not (t.product_id = any (p_ids)) and not (t.addon_id = any (p_ids))),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.product_collections t where not (t.product_id = any (p_ids))),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.collections t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.orders t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.order_items t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.settings t where (pg_catalog.cardinality(p_ids) = 0 or t.key <> 'home_products')),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.storage_orphans t where (p_om is null or t.id <= p_om)),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.opening_stock_docs t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.opening_stock_lines t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.stock_lots t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.purchase_doc_lines t where true),
    (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t::text, E'\n' order by t::text), '')) from public.admin_users t where true)));
$f$;

create function pg_temp.fp0() returns text language sql as $f$ select pg_temp.fp('{}'::integer[], null) $f$;
create function pg_temp.om() returns bigint language sql as $f$ select coalesce(max(o.id), 0) from public.storage_orphans o $f$;

-- الإعداد (postgres): منتجات · مجموعة · روابط · صور على منتجات الـ fixtures · قايمة الرئيسية.
do $zS$
declare
  v_col bigint;
begin
  perform pg_temp.mk('P', false, 2);
  perform pg_temp.mk('V', true, 1);
  perform pg_temp.mk('C', false, 1);
  perform pg_temp.mk('Q', false, 2);
  perform pg_temp.mk('R', false, 0);
  perform pg_temp.mk('H', false, 1);
  perform pg_temp.mk('K', false, 1);
  perform pg_temp.mk('E', false, 1);
  perform pg_temp.mk('G', false, 1);
  perform pg_temp.mk('A', true, 0);
  perform pg_temp.mk('B', true, 0);
  perform pg_temp.mk('X', true, 0);
  perform pg_temp.mk('Y', true, 0);
  perform pg_temp.mk('D', false, 1);
  insert into pg_temp.zp (tag, id) select 'O', p.id from public.products p where p.name_ar = 'ci-0022-orders';
  insert into pg_temp.zp (tag, id) select 'S', p.id from public.products p where p.name_ar = 'ci-0022-stock';
  insert into public.product_images (product_id, object_path)
  select z.id, 'products/' || z.id || '/fx.jpg' from pg_temp.zp z where z.tag in ('O', 'S');
  insert into public.collections (slug, title_ar) values ('ci-0022-col', 'CI 0022') returning id into v_col;
  insert into public.product_collections (collection_id, product_id) values (v_col, pg_temp.pid('P')), (v_col, pg_temp.pid('X'));
  insert into public.product_addons (product_id, addon_id) values (pg_temp.pid('P'), pg_temp.pid('A')), (pg_temp.pid('B'), pg_temp.pid('P'));
  insert into public.storage_orphans (object_path, reason, cleaned_at)
  select i.object_path, 'replaced', pg_catalog.now() from public.product_images i where i.product_id = pg_temp.pid('C');
  insert into public.storage_orphans (object_path, reason)
  select i.object_path, 'replaced' from public.product_images i where i.product_id = pg_temp.pid('Q') and i.sort_order = 0;
  delete from public.settings s where s.key = 'home_products';
  insert into public.settings (key, value)
  values ('home_products', pg_catalog.jsonb_build_object(
            'mode', 'selected', 'allLabel', 'keep',
            'ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), pg_temp.pid('P'), pg_temp.pid('Y'), pg_temp.pid('O'), pg_temp.pid('S'))));
end
$zS$;

-- A) الهوية (كل حالة: بصمة الداتابيز كلها زي ما هي)
do $zA$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  v_admin text := '00000000-0000-4000-8000-0000000000a2';
  v_off text := '00000000-0000-4000-8000-0000000000a3';
  v_user text := '00000000-0000-4000-8000-0000000000a4';
  p integer := pg_temp.pid('P');
  v_fp text := pg_temp.fp0();
  v_d text;
begin
  v_d := pg_temp.del_sql(p, pg_temp.ver(p));
  perform pg_temp.zt('F01 no session: delete / preview -> 45400, database unchanged',
    pg_temp.call_as('authenticated', null, v_d) like 'ERR 45400%'
    and pg_temp.call_as('authenticated', null, pg_temp.pre_sql(p)) like 'ERR 45400%'
    and pg_temp.fp0() = v_fp, null);
  perform pg_temp.zt('F02 active admin (not owner): delete / preview -> 45402, database unchanged',
    pg_temp.call_as('authenticated', v_admin, v_d) like 'ERR 45402%'
    and pg_temp.call_as('authenticated', v_admin, pg_temp.pre_sql(p)) like 'ERR 45402%'
    and pg_temp.fp0() = v_fp, null);
  perform pg_temp.zt('F03 forged / invalid actor: inactive admin and non-admin user -> 45401; claims role anon, sub not a uuid, broken JSON -> 45400; unchanged',
    pg_temp.call_as('authenticated', v_off, v_d) like 'ERR 45401%'
    and pg_temp.call_as('authenticated', v_user, v_d) like 'ERR 45401%'
    and pg_temp.call_raw('authenticated', pg_catalog.jsonb_build_object('sub', v_owner, 'role', 'anon')::text, v_d) like 'ERR 45400%'
    and pg_temp.call_raw('authenticated', pg_catalog.jsonb_build_object('sub', 'owner', 'role', 'authenticated')::text, v_d) like 'ERR 45400%'
    and pg_temp.call_raw('authenticated', '{"sub": "' || v_owner || '", "role": ', v_d) like 'ERR 45400%'
    and pg_temp.fp0() = v_fp, null);
  perform pg_temp.zt('F04 anon / service_role: no EXECUTE (42501), unchanged',
    pg_temp.call_as('anon', null, v_d) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, v_d) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, pg_temp.pre_sql(p)) like 'ERR 42501%'
    and pg_temp.fp0() = v_fp, null);
exception when others then
  perform pg_temp.zt('ABORT_A block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zA$;

-- B) الرفض: كل كود، وبصمة الداتابيز كلها زي ما هي
do $zB$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  p integer := pg_temp.pid('P');
  k integer := pg_temp.pid('K');
  v integer := pg_temp.pid('V');
  o integer := pg_temp.pid('O');
  s integer := pg_temp.pid('S');
  c integer := pg_temp.pid('C');
  v_fp text := pg_temp.fp0();
  v_pre jsonb;
  v_r text;
  v_r2 text;
begin
  perform pg_temp.zt('F05 45501: missing id and null id, unchanged',
    pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(-5, pg_catalog.now()::text)) like 'ERR 45501%'
    and pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(null, pg_catalog.now()::text)) like 'ERR 45501%'
    and pg_temp.fp0() = v_fp, null);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(p, (pg_temp.ver(p)::timestamptz + interval '1 second')::text));
  v_r2 := pg_temp.call_as('authenticated', v_owner, 'select public.zell_product_delete(' || p || ', null)::text');
  perform pg_temp.zt('F06 45502: other version and null version, unchanged',
    v_r like 'ERR 45502%' and v_r2 like 'ERR 45502%' and pg_temp.fp0() = v_fp, v_r || ' / ' || v_r2);
  -- المعاينة ← تعديل صف المنتج نفسه ← الحذف بنسخة المعاينة.
  v_pre := pg_temp.js(pg_temp.call_as('authenticated', v_owner, pg_temp.pre_sql(k)));
  update public.products set name_ar = 'ci-0022-K-edited', updated_at = pg_catalog.now() + interval '1 second' where id = k;
  v_fp := pg_temp.fp0();
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(k, v_pre ->> 'updated_at'));
  perform pg_temp.zt('F07 45502: product row edited between preview and delete, unchanged',
    v_pre ->> 'can_delete' = 'true' and v_r like 'ERR 45502%' and pg_temp.fp0() = v_fp, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(v, pg_temp.ver(v)));
  perform pg_temp.zt('F08 45503: visible product, unchanged', v_r like 'ERR 45503%' and pg_temp.fp0() = v_fp, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(o, pg_temp.ver(o)));
  perform pg_temp.zt('F09 45504: product in order_items (in home list, with an image), unchanged',
    o is not null and v_r = 'ERR 45504 ' and pg_temp.fp0() = v_fp, coalesce(v_r, 'no fixture'));
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(s, pg_temp.ver(s)));
  v_r2 := pg_temp.call_as('zell_catalog_definer', null, 'select public.zell_inv_product_stock_ref_exists(' || s || ')::text');
  perform pg_temp.zt('F10 45505: opening stock line, caught by the inventory chain with the real roles (true / false), unchanged',
    s is not null and v_r = 'ERR 45505 ' and v_r2 = 'true'
    and pg_temp.call_as('zell_catalog_definer', null, 'select public.zell_inv_product_stock_ref_exists(' || p || ')::text') = 'false'
    and pg_temp.fp0() = v_fp, coalesce(v_r, 'no fixture') || ' / ' || coalesce(v_r2, ''));
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(c, pg_temp.ver(c)));
  perform pg_temp.zt('F11 45506: image already marked cleaned in storage_orphans, unchanged',
    v_r like 'ERR 45506%' and pg_temp.fp0() = v_fp, v_r);
exception when others then
  perform pg_temp.zt('ABORT_B block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zB$;

-- C) النجاح
do $zC$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  p integer := pg_temp.pid('P');
  q integer := pg_temp.pid('Q');
  r integer := pg_temp.pid('R');
  v_paths text[];
  v_q1 text;
  v_q2 text;
  v_res jsonb;
  v_om bigint;
  v_rest text;
  v_home jsonb;
  v_new integer;
begin
  select pg_catalog.array_agg(i.object_path order by i.id) into v_paths from public.product_images i where i.product_id = p;
  v_om := pg_temp.om();
  v_rest := pg_temp.fp(array[p], v_om);
  v_home := pg_temp.home();
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner,
             pg_temp.del_sql(p, pg_catalog.date_trunc('milliseconds', pg_temp.ver(p)::timestamptz)::text)));
  perform pg_temp.zt('F12 success: result (2 images registered, removed from home, 2 addon links, 1 collection link), version at ms precision',
    v_res = pg_catalog.jsonb_build_object('deleted', true, 'product_id', p, 'images_registered', 2, 'images_already_pending', 0,
                                          'removed_from_home', true, 'addon_links', 2, 'collection_links', 1),
    coalesce(v_res::text, 'null'));
  perform pg_temp.zt('F13 success: product + 5 kinds of dependent rows gone; every other row of every table identical (content fingerprint)',
    not exists (select 1 from public.products x where x.id = p)
    and not exists (select 1 from public.product_images x where x.product_id = p)
    and not exists (select 1 from public.product_widths x where x.product_id = p)
    and not exists (select 1 from public.product_addons x where x.product_id = p or x.addon_id = p)
    and not exists (select 1 from public.product_collections x where x.product_id = p)
    and pg_temp.fp(array[p], v_om) = v_rest, null);
  perform pg_temp.zt('F14 success: 2 new storage_orphans rows (product_deleted, pending) for exactly those paths; home = same value without the id, order kept',
    (select count(*) from public.storage_orphans o where o.id > v_om) = 2
    and (select count(*) from public.storage_orphans o
          where o.id > v_om and o.object_path = any (v_paths) and o.reason = 'product_deleted' and o.cleaned_at is null
            and o.bucket = 'product-images') = 2
    and pg_temp.home() = pg_catalog.jsonb_set(v_home, '{ids}',
          pg_catalog.jsonb_build_array(pg_temp.pid('X'), pg_temp.pid('Y'), pg_temp.pid('O'), pg_temp.pid('S'))), pg_temp.home()::text);
  select i.object_path into v_q1 from public.product_images i where i.product_id = q and i.sort_order = 0;
  select i.object_path into v_q2 from public.product_images i where i.product_id = q and i.sort_order = 1;
  v_om := pg_temp.om();
  v_rest := pg_temp.fp(array[q], v_om);
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(q, pg_temp.ver(q))));
  perform pg_temp.zt('F15 pending orphan: no new row for it (reason replaced kept), the other image registered; rest identical',
    v_res ->> 'images_registered' = '1' and v_res ->> 'images_already_pending' = '1' and v_res ->> 'removed_from_home' = 'false'
    and (select o.reason from public.storage_orphans o where o.object_path = v_q1) = 'replaced'
    and (select count(*) from public.storage_orphans o where o.id > v_om) = 1
    and (select o.reason from public.storage_orphans o where o.object_path = v_q2) = 'product_deleted'
    and pg_temp.fp(array[q], v_om) = v_rest and pg_temp.home() is not null, coalesce(v_res::text, 'null'));
  v_home := pg_temp.home();
  delete from public.settings s where s.key = 'home_products';
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(r, pg_temp.ver(r))));
  perform pg_temp.zt('F16 no home_products row: delete works, row not created',
    v_res ->> 'deleted' = 'true' and v_res ->> 'removed_from_home' = 'false' and v_res ->> 'images_registered' = '0'
    and pg_temp.home() is null, coalesce(v_res::text, 'null'));
  insert into public.settings (key, value) values ('home_products', v_home);
  insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-new', 1000, false) returning id into v_new;
  perform pg_temp.zt('F17 a product created after the deletes gets a new id (not a deleted one)',
    v_new > greatest(p, q, r), v_new::text);
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

-- D) المعاينة
do $zD$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  v_fp text := pg_temp.fp0();
  h jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('H'))));
  vv jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('V'))));
  o jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('O'))));
  s jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('S'))));
  c jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('C'))));
  x jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('X'))));
begin
  perform pg_temp.zt('F18 preview: can_delete only for a hidden clean product; flags visible / orders / stock / orphan conflict / in_home; counts; 45501; read only',
    (h ->> 'can_delete') = 'true' and (h ->> 'images') = '1' and (h ->> 'widths') = '1' and (h ->> 'in_home') = 'false'
    and (h ->> 'updated_at') is not null
    and (vv ->> 'can_delete') = 'false' and (vv ->> 'is_active') = 'true'
    and (o ->> 'can_delete') = 'false' and (o ->> 'has_orders') = 'true' and (o ->> 'in_home') = 'true'
    and (s ->> 'can_delete') = 'false' and (s ->> 'has_stock') = 'true'
    and (c ->> 'can_delete') = 'false' and (c ->> 'orphan_conflict') = 'true'
    and (x ->> 'in_home') = 'true' and (x ->> 'collections') = '1'
    and pg_temp.call_as('authenticated', v_owner, pg_temp.pre_sql(-5)) like 'ERR 45501%'
    and pg_temp.fp0() = v_fp,
    coalesce(h::text, 'h null') || ' ' || coalesce(o::text, 'o null'));
exception when others then
  perform pg_temp.zt('ABORT_D block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zD$;

-- E) أقل صلاحيات: الدور نفسه (SET ROLE مباشر) مايقدرش يعمل غير اللي في العقد.
do $zE$
declare
  d integer := pg_temp.pid('D');
  v_fp text := pg_temp.fp0();
  v_bad text := '';
  v_sql text;
  v_r text;
begin
  foreach v_sql in array array[
    'select count(name_ar)::text from public.products',
    'update public.products set is_active = true where id = ' || d || ' returning ''x''',
    'update public.products set updated_at = now() where id = ' || d || ' returning ''x''',
    'insert into public.products (name_ar, price_per_meter_piastres) values (''x'', 1) returning ''x''',
    'update public.product_images set product_id = product_id where product_id = ' || d || ' returning ''x''',
    'update public.product_widths set product_id = product_id where product_id = ' || d || ' returning ''x''',
    'delete from public.product_images where product_id = ' || d || ' returning ''x''',
    'delete from public.order_items returning ''x''',
    'select count(*)::text from public.orders',
    'select count(*)::text from public.collections',
    'update public.settings set key = ''x'' where key = ''home_products'' returning ''x''',
    'insert into public.settings (key, value) values (''x'', ''{}'') returning ''x''',
    'insert into public.storage_orphans (object_path, reason) values (''ci/x'', ''replaced'') returning ''x''',
    'update public.storage_orphans set cleaned_at = now() returning ''x''',
    'delete from public.storage_orphans returning ''x''',
    'select public.zell_inv_product_has_stock_refs(1)::text',
    'create function public.zz_ci_0022() returns integer language sql as ''select 1''']
  loop
    v_r := pg_temp.call_as('zell_catalog_definer', null, v_sql);
    if v_r not like 'ERR 42501%' then
      v_bad := v_bad || ' [' || v_sql || ' => ' || v_r || ']';
    end if;
  end loop;
  perform pg_temp.zt('F19 zell_catalog_definer itself: 17 out-of-contract statements refused (42501), database unchanged',
    v_bad = '' and pg_temp.fp0() = v_fp, v_bad);
  v_r := pg_temp.call_as('zell_catalog_definer', null, 'select coalesce(string_agg(key, '',''), '''') from public.settings');
  perform pg_temp.zt('F20 settings visible to the role = home_products only; wrapper / guard / helper not callable by authenticated',
    v_r = 'home_products'
    and pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
          'select public.zell_inv_product_stock_ref_exists(1)::text') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
          'select public.zell_inv_product_has_stock_refs(1)::text') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
          'select public.zell_catalog_trg_home_products_guard()::text') like 'ERR 42501%', v_r);
exception when others then
  perform pg_temp.zt('ABORT_E block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zE$;

-- F) حارس قايمة الرئيسية (45507): الـ id الجديد بس لازم يكون منتج موجود. ومسار الحفظ الحالي (service_role REST).
alter table public.settings disable trigger zell_catalog_home_products_guard;
update public.settings s set value = pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), 999999))
 where s.key = 'home_products';
alter table public.settings enable trigger zell_catalog_home_products_guard;

do $zF$
declare
  x integer := pg_temp.pid('X');
  y integer := pg_temp.pid('Y');
  v_upd text := 'update public.settings set value = %L::jsonb where key = ''home_products'' returning ''ok''';
  v_ins text := 'insert into public.settings (key, value) values (''home_products'', %L::jsonb) returning ''ok''';
  v_save text := 'update public.settings set value = %L::jsonb, updated_at = now() where key = ''home_products'' returning ''ok''';
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text;
  s1 text; s2 text; s3 text; s4 text;
  v_val jsonb;
begin
  r1 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, '{"ids": [999999]}'));
  r2 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(999999, y))::text));
  r3 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(999999, y, 999998))::text));
  r4 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array('abc', y), 'x', 1)::text));
  r5 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, '{"title": "no ids"}'));
  delete from public.settings s where s.key = 'home_products';
  r6 := pg_temp.call_as('postgres', null, pg_catalog.format(v_ins, '{"ids": [999999]}'));
  r7 := pg_temp.call_as('postgres', null, pg_catalog.format(v_ins, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(x, y))::text));
  perform pg_temp.zt('F21 guard: old stale id kept / removed freely, new missing id -> 45507 (update and insert), non-numbers ignored',
    r1 = 'ok' and r2 = 'ok' and r3 like 'ERR 45507%' and r4 = 'ok' and r5 = 'ok' and r6 like 'ERR 45507%' and r7 = 'ok'
    and pg_temp.home() = pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(x, y)),
    concat_ws(' / ', r1, r2, r3, r4, r5, r6, r7));
  -- مسار saveHomeProducts النهارده: PATCH بـ service_role، ولو مفيش صف INSERT.
  v_val := pg_catalog.jsonb_build_object('mode', 'selected', 'ids', pg_catalog.jsonb_build_array(y, x), 'allLabel', 'CI');
  s1 := pg_temp.call_as('service_role', null, pg_catalog.format(v_save, v_val::text));
  delete from public.settings s where s.key = 'home_products';
  s2 := pg_temp.call_as('service_role', null, pg_catalog.format(v_ins, v_val::text));
  s3 := pg_temp.call_as('service_role', null, pg_catalog.format(v_save,
          pg_catalog.jsonb_build_object('mode', 'selected', 'ids', pg_catalog.jsonb_build_array(y, x, 999997), 'allLabel', 'CI')::text));
  s4 := pg_temp.call_as('service_role', null,
          'update public.settings set value = value, updated_at = now() where key = ''hero'' returning ''ok''');
  perform pg_temp.zt('F22 current save path (service_role): update and first insert work; a missing id -> 45507 and nothing saved; other keys untouched by the guard',
    s1 = 'ok' and s2 = 'ok' and s3 like 'ERR 45507%' and s4 = 'ok' and pg_temp.home() = v_val,
    concat_ws(' / ', s1, s2, s3, s4));
exception when others then
  perform pg_temp.zt('ABORT_F block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zF$;

-- G) الـ FK كحارس أخير، وسحب منحة الـ helper (تغييرات مصطنعة جوه المعاملة، وبترجع معاها).
do $zG$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  o integer := pg_temp.pid('O');
  s integer := pg_temp.pid('S');
  e integer := pg_temp.pid('E');
  g integer := pg_temp.pid('G');
  v_fp text;
  v_r text;
  v_r2 text;
  v_same boolean;
  v_after text;
begin
  update public.settings set value = pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), o, s, e, g))
   where key = 'home_products';
  v_fp := pg_temp.fp0();
  -- فحص الطلبات اتشال: policy restrictive بتخفي order_items عن الدور.
  create policy ci_0022_hide on public.order_items as restrictive for select to zell_catalog_definer using (false);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(o, pg_temp.ver(o)));
  drop policy ci_0022_hide on public.order_items;
  perform pg_temp.zt('F23 orders check removed artificially -> the FK refuses (45504, detail order_items_product_id_fkey); image registration + home removal rolled back',
    v_r = 'ERR 45504 order_items_product_id_fkey' and pg_temp.fp0() = v_fp, v_r);
  -- فحص المخزون اتشال: policy restrictive بتخفي سطور الرصيد عن دور المخزون.
  create policy ci_0022_hide on public.opening_stock_lines as restrictive for select to zell_inventory_definer using (false);
  v_r := pg_temp.call_as('zell_catalog_definer', null, 'select public.zell_inv_product_stock_ref_exists(' || s || ')::text');
  v_r2 := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(s, pg_temp.ver(s)));
  drop policy ci_0022_hide on public.opening_stock_lines;
  perform pg_temp.zt('F24 stock check removed artificially (wrapper -> false) -> the FK refuses (45505, detail opening_stock_lines_product_fk); everything rolled back',
    v_r = 'false' and v_r2 = 'ERR 45505 opening_stock_lines_product_fk' and pg_temp.fp0() = v_fp, v_r || ' / ' || v_r2);
  -- منحة الـ helper اتسحبت بعد التطبيق: خطأ صلاحية، ومفيش حذف (حتى لمنتج نضيف).
  revoke execute on function public.zell_inv_product_has_stock_refs(integer) from zell_inventory_definer;
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(e, pg_temp.ver(e)));
  v_r2 := pg_temp.call_as('authenticated', v_owner, pg_temp.pre_sql(g));
  grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_inventory_definer;
  v_same := pg_temp.fp0() = v_fp;
  v_after := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(e, pg_temp.ver(e)));
  perform pg_temp.zt('F25 helper grant revoked after apply -> delete and preview fail with 42501, nothing deleted; works again after re-grant',
    v_r like 'ERR 42501%' and v_r2 like 'ERR 42501%' and v_same and pg_temp.js(v_after) ->> 'deleted' = 'true',
    v_r || ' / ' || v_r2 || ' / ' || v_after);
exception when others then
  perform pg_temp.zt('ABORT_G block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zG$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 25 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
