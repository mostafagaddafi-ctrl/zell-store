-- 0022 PRODUCT-DELETE — سيناريوهات الحذف بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0022_sql_ci.sh بعد تطبيق 0022_product_delete.sql على داتابيز مبنية من الصفر
--   (backend/db/ci/build_from_scratch.list).
-- • الهويات: مالك ...a1 (fixture before_0020_owner) · أدمن شغّال ...a2 (بيتضاف في سكربت الـ CI).
-- • منتجين من سكربت الـ CI (committed): ci-0022-orders (عليه order_items) و ci-0022-stock (عليه سطر رصيد افتتاحي).
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 18 نجاح و 0 فشل.

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

-- النداء بدور وجلسة (sub بدور authenticated، أو من غير جلسة لو NULL). النتيجة نص، أو 'ERR <sqlstate> <detail>'.
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
  v_detail text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims',
      case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
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

-- لقطة للأثر: المنتج وتوابعه، وكل storage_orphans، وقايمة الرئيسية.
create function pg_temp.snap(p integer) returns text language sql as $f$
  select (select count(*) from public.products x where x.id = p)::text
      || '|' || (select count(*) from public.product_images x where x.product_id = p)::text
      || '|' || (select count(*) from public.product_widths x where x.product_id = p)::text
      || '|' || (select count(*) from public.product_addons x where x.product_id = p or x.addon_id = p)::text
      || '|' || (select count(*) from public.product_collections x where x.product_id = p)::text
      || '|' || coalesce((select pg_catalog.md5(pg_catalog.string_agg(o.id || o.reason || coalesce(o.cleaned_at::text, '-'), ',' order by o.id))
                            from public.storage_orphans o), '-')
      || '|' || coalesce((select pg_catalog.md5(s.value::text) from public.settings s where s.key = 'home_products'), '-');
$f$;

-- الإعداد (postgres): منتجات · مجموعة · روابط · قايمة الرئيسية.
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
  perform pg_temp.mk('A', true, 0);
  perform pg_temp.mk('B', true, 0);
  perform pg_temp.mk('X', true, 0);
  perform pg_temp.mk('Y', true, 0);
  perform pg_temp.mk('D', false, 1);
  insert into pg_temp.zp (tag, id) select 'O', p.id from public.products p where p.name_ar = 'ci-0022-orders';
  insert into pg_temp.zp (tag, id) select 'S', p.id from public.products p where p.name_ar = 'ci-0022-stock';
  insert into public.collections (slug, title_ar) values ('ci-0022-col', 'CI 0022') returning id into v_col;
  insert into public.product_collections (collection_id, product_id) values (v_col, pg_temp.pid('P')), (v_col, pg_temp.pid('X'));
  insert into public.product_addons (product_id, addon_id) values (pg_temp.pid('P'), pg_temp.pid('A')), (pg_temp.pid('B'), pg_temp.pid('P'));
  insert into public.storage_orphans (object_path, reason, cleaned_at)
  select i.object_path, 'replaced', pg_catalog.now() from public.product_images i where i.product_id = pg_temp.pid('C');
  insert into public.storage_orphans (object_path, reason)
  select i.object_path, 'replaced' from public.product_images i where i.product_id = pg_temp.pid('Q') and i.sort_order = 0;
  delete from public.settings s where s.key = 'home_products';
  insert into public.settings (key, value)
  values ('home_products', pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), pg_temp.pid('P'), pg_temp.pid('Y')),
                                                         'title', 'keep'));
end
$zS$;

-- A) الهوية
do $zA$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  v_admin text := '00000000-0000-4000-8000-0000000000a2';
  p integer := pg_temp.pid('P');
  v_snap text := pg_temp.snap(pg_temp.pid('P'));
begin
  perform pg_temp.zt('F01 no session: delete / preview -> 45400, nothing changed',
    pg_temp.call_as('authenticated', null, pg_temp.del_sql(p, pg_temp.ver(p))) like 'ERR 45400%'
    and pg_temp.call_as('authenticated', null, pg_temp.pre_sql(p)) like 'ERR 45400%'
    and pg_temp.snap(p) = v_snap, null);
  perform pg_temp.zt('F02 active admin (not owner): delete / preview -> 45402, nothing changed',
    pg_temp.call_as('authenticated', v_admin, pg_temp.del_sql(p, pg_temp.ver(p))) like 'ERR 45402%'
    and pg_temp.call_as('authenticated', v_admin, pg_temp.pre_sql(p)) like 'ERR 45402%'
    and pg_temp.snap(p) = v_snap, null);
  perform pg_temp.zt('F03 anon / service_role: no EXECUTE (42501)',
    pg_temp.call_as('anon', null, pg_temp.del_sql(p, pg_temp.ver(p))) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, pg_temp.del_sql(p, pg_temp.ver(p))) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, pg_temp.pre_sql(p)) like 'ERR 42501%'
    and pg_temp.snap(p) = v_snap, null);
exception when others then
  perform pg_temp.zt('ABORT_A block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zA$;

-- B) الرفض: كل كود ومفيش أي تغيير
do $zB$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  p integer := pg_temp.pid('P');
  v integer := pg_temp.pid('V');
  o integer := pg_temp.pid('O');
  s integer := pg_temp.pid('S');
  c integer := pg_temp.pid('C');
  v_r text;
  v_r2 text;
  v_snap text;
begin
  v_snap := pg_temp.snap(p);
  perform pg_temp.zt('F04 45501: missing id and null id',
    pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(-5, pg_catalog.now()::text)) like 'ERR 45501%'
    and pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(null, pg_catalog.now()::text)) like 'ERR 45501%'
    and pg_temp.snap(p) = v_snap, null);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(p, (pg_temp.ver(p)::timestamptz + interval '1 second')::text));
  v_r2 := pg_temp.call_as('authenticated', v_owner, 'select public.zell_product_delete(' || p || ', null)::text');
  perform pg_temp.zt('F05 45502: other version and null version, nothing changed',
    v_r like 'ERR 45502%' and v_r2 like 'ERR 45502%' and pg_temp.snap(p) = v_snap, v_r || ' / ' || v_r2);
  v_snap := pg_temp.snap(v);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(v, pg_temp.ver(v)));
  perform pg_temp.zt('F06 45503: visible product, nothing changed', v_r like 'ERR 45503%' and pg_temp.snap(v) = v_snap, v_r);
  v_snap := pg_temp.snap(o);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(o, pg_temp.ver(o)));
  perform pg_temp.zt('F07 45504: product in order_items, nothing changed',
    o is not null and v_r like 'ERR 45504%' and pg_temp.snap(o) = v_snap, coalesce(v_r, 'no fixture'));
  v_snap := pg_temp.snap(s);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(s, pg_temp.ver(s)));
  v_r2 := pg_temp.call_as('zell_catalog_definer', null, 'select public.zell_inv_product_stock_ref_exists(' || s || ')::text');
  perform pg_temp.zt('F08 45505: opening stock line, caught by the inventory wrapper (empty detail = not the FK), nothing changed',
    s is not null and v_r = 'ERR 45505 ' and v_r2 = 'true'
    and pg_temp.call_as('zell_catalog_definer', null, 'select public.zell_inv_product_stock_ref_exists(' || p || ')::text') = 'false'
    and pg_temp.snap(s) = v_snap, coalesce(v_r, 'no fixture') || ' / ' || coalesce(v_r2, ''));
  v_snap := pg_temp.snap(c);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(c, pg_temp.ver(c)));
  perform pg_temp.zt('F09 45506: image already marked cleaned in storage_orphans, nothing changed',
    v_r like 'ERR 45506%' and pg_temp.snap(c) = v_snap, v_r);
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
  v_orph integer;
begin
  select pg_catalog.array_agg(i.object_path order by i.id) into v_paths from public.product_images i where i.product_id = p;
  select pg_catalog.count(*) into v_orph from public.storage_orphans;
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner,
             pg_temp.del_sql(p, pg_catalog.date_trunc('milliseconds', pg_temp.ver(p)::timestamptz)::text)));
  perform pg_temp.zt('F10 success: result (2 images registered, removed from home, 2 addon links, 1 collection link), version at ms precision',
    v_res = pg_catalog.jsonb_build_object('deleted', true, 'product_id', p, 'images_registered', 2, 'images_already_pending', 0,
                                          'removed_from_home', true, 'addon_links', 2, 'collection_links', 1),
    coalesce(v_res::text, 'null'));
  perform pg_temp.zt('F11 success: cascade (product, images, widths, addon links both ways, collection link) gone; others intact',
    pg_temp.snap(p) like '0|0|0|0|0|%'
    and (select count(*) from public.products x where x.id in (pg_temp.pid('A'), pg_temp.pid('B'), pg_temp.pid('X'), pg_temp.pid('Y'))) = 4
    and (select count(*) from public.product_collections x where x.product_id = pg_temp.pid('X')) = 1, pg_temp.snap(p));
  perform pg_temp.zt('F12 success: 2 storage_orphans rows (product_deleted, pending) for exactly those paths; home ids [X, Y] + other keys kept',
    (select count(*) from public.storage_orphans o
      where o.object_path = any (v_paths) and o.reason = 'product_deleted' and o.cleaned_at is null and o.bucket = 'product-images') = 2
    and (select count(*) from public.storage_orphans) = v_orph + 2
    and (select s.value from public.settings s where s.key = 'home_products')
        = pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), pg_temp.pid('Y')), 'title', 'keep'), null);
  select i.object_path into v_q1 from public.product_images i where i.product_id = q and i.sort_order = 0;
  select i.object_path into v_q2 from public.product_images i where i.product_id = q and i.sort_order = 1;
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(q, pg_temp.ver(q))));
  perform pg_temp.zt('F13 pending orphan: left as is (reason replaced), the other image registered; not in home',
    v_res ->> 'images_registered' = '1' and v_res ->> 'images_already_pending' = '1' and v_res ->> 'removed_from_home' = 'false'
    and (select o.reason from public.storage_orphans o where o.object_path = v_q1) = 'replaced'
    and (select o.reason from public.storage_orphans o where o.object_path = v_q2) = 'product_deleted'
    and not exists (select 1 from public.products x where x.id = q), coalesce(v_res::text, 'null'));
  delete from public.settings s where s.key = 'home_products';
  v_res := pg_temp.js(pg_temp.call_as('authenticated', v_owner, pg_temp.del_sql(r, pg_temp.ver(r))));
  perform pg_temp.zt('F14 no home_products row: delete works, row not created',
    v_res ->> 'deleted' = 'true' and v_res ->> 'removed_from_home' = 'false' and v_res ->> 'images_registered' = '0'
    and not exists (select 1 from public.settings s where s.key = 'home_products'), coalesce(v_res::text, 'null'));
  insert into public.settings (key, value)
  values ('home_products', pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(pg_temp.pid('X'), pg_temp.pid('Y')), 'title', 'keep'));
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

-- D) المعاينة
do $zD$
declare
  v_owner text := '00000000-0000-4000-8000-0000000000a1';
  h jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('H'))));
  vv jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('V'))));
  o jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('O'))));
  s jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('S'))));
  c jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('C'))));
  x jsonb := pg_temp.js(pg_temp.call_as('authenticated', '00000000-0000-4000-8000-0000000000a1', pg_temp.pre_sql(pg_temp.pid('X'))));
begin
  perform pg_temp.zt('F15 preview: can_delete only for a hidden clean product; flags visible / orders / stock / orphan conflict / in_home; counts; 45501',
    (h ->> 'can_delete') = 'true' and (h ->> 'images') = '1' and (h ->> 'widths') = '1' and (h ->> 'in_home') = 'false'
    and (h ->> 'updated_at') is not null
    and (vv ->> 'can_delete') = 'false' and (vv ->> 'is_active') = 'true'
    and (o ->> 'can_delete') = 'false' and (o ->> 'has_orders') = 'true'
    and (s ->> 'can_delete') = 'false' and (s ->> 'has_stock') = 'true'
    and (c ->> 'can_delete') = 'false' and (c ->> 'orphan_conflict') = 'true'
    and (x ->> 'in_home') = 'true' and (x ->> 'collections') = '1'
    and pg_temp.call_as('authenticated', v_owner, pg_temp.pre_sql(-5)) like 'ERR 45501%',
    coalesce(h::text, 'h null') || ' ' || coalesce(o::text, 'o null'));
exception when others then
  perform pg_temp.zt('ABORT_D block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zD$;

-- E) أقل صلاحيات: الدور نفسه (SET ROLE مباشر) مايقدرش يعمل غير اللي في العقد.
do $zE$
declare
  d integer := pg_temp.pid('D');
  v_snap text := pg_temp.snap(pg_temp.pid('D'));
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
  perform pg_temp.zt('F16 zell_catalog_definer itself: 17 out-of-contract statements refused (42501)',
    v_bad = '' and pg_temp.snap(d) = v_snap, v_bad);
  v_r := pg_temp.call_as('zell_catalog_definer', null, 'select coalesce(string_agg(key, '',''), '''') from public.settings');
  perform pg_temp.zt('F17 settings visible to the role = home_products only; wrapper / guard / helper not callable by authenticated',
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

-- F) حارس قايمة الرئيسية (45507): الـ id الجديد بس لازم يكون منتج موجود.
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
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text;
begin
  r1 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, '{"ids": [999999]}'));
  r2 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(999999, y))::text));
  r3 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(999999, y, 999998))::text));
  r4 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array('abc', y), 'x', 1)::text));
  r5 := pg_temp.call_as('postgres', null, pg_catalog.format(v_upd, '{"title": "no ids"}'));
  delete from public.settings s where s.key = 'home_products';
  r6 := pg_temp.call_as('postgres', null, pg_catalog.format(v_ins, '{"ids": [999999]}'));
  r7 := pg_temp.call_as('postgres', null, pg_catalog.format(v_ins, pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(x, y))::text));
  perform pg_temp.zt('F18 guard: old stale id kept / removed freely, new missing id -> 45507 (update and insert), non-numbers ignored',
    r1 = 'ok' and r2 = 'ok' and r3 like 'ERR 45507%' and r4 = 'ok' and r5 = 'ok' and r6 like 'ERR 45507%' and r7 = 'ok'
    and (select s.value from public.settings s where s.key = 'home_products') = pg_catalog.jsonb_build_object('ids', pg_catalog.jsonb_build_array(x, y)),
    concat_ws(' / ', r1, r2, r3, r4, r5, r6, r7));
exception when others then
  perform pg_temp.zt('ABORT_F block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zF$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 18 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
