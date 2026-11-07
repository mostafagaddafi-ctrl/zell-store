-- 0026 IMAGE-DELETE — سيناريوهات بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0026_sql_ci.sh بعد تطبيق 0026_image_delete.sql على داتابيز مبنية من القايمة كلها.
-- • الهويات: مالك ...a1 (fixture) · أدمن شغّال ...a2 · أدمن موقوف ...a3 · مستخدم auth مش أدمن ...a4 (من سكربت الـ CI).
-- • العقد docs/contracts/IMAGE-DELETE.md §٨: الحذف والترقية والرفض والهويات والأدوار، حارس التفعيل، جملة التراجع المشروطة
--   (§٥-ج)، وسيناريو ضياع رد الإدخال (§٥-د) في جزء الداتابيز. التزامن بجلستين حقيقيتين في سكربت الـ CI (K01..K08).
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 18 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '60s';
set local statement_timeout = '120s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;
create temporary sequence zseq;

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

create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language sql as $f$
  select pg_temp.call_raw(p_role,
    case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, p_sql);
$f$;

create function pg_temp.js(p text) returns jsonb language sql as $f$
  select case when p is null or p like 'ERR%' or p = 'null' then null else p::jsonb end;
$f$;

create function pg_temp.st(p text) returns text language sql as $f$
  select case when p like 'ERR %' then split_part(p, ' ', 2) else 'OK' end;
$f$;

create function pg_temp.mkp(p_tag text) returns integer language sql as $f$
  insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0026-' || p_tag, 1000, false) returning id;
$f$;

create function pg_temp.img(p_pid integer, p_sort integer, p_primary boolean, p_kind text)
returns bigint language sql as $f$
  insert into public.product_images (product_id, object_path, kind, sort_order, is_primary, fit)
  values (p_pid, 'products/' || p_pid || '/ci26-' || pg_catalog.nextval('pg_temp.zseq') || '.jpg', p_kind, p_sort, p_primary,
          case when p_primary then 'cover' else 'contain' end)
  returning id;
$f$;

create function pg_temp.path(p_img bigint) returns text language sql as $f$
  select i.object_path from public.product_images i where i.id = p_img;
$f$;

create function pg_temp.del(p_sub text, p_pid integer, p_img bigint) returns text language sql as $f$
  select pg_temp.call_as('authenticated', p_sub,
    pg_catalog.format('select public.zell_product_image_delete(%s, %s)::text', coalesce(p_pid::text, 'null'), coalesce(p_img::text, 'null')));
$f$;

create function pg_temp.cond_del(p_img bigint) returns text language sql as $f$
  select pg_temp.call_raw('service_role', '',
    pg_catalog.format('with d as (delete from public.product_images where id = %s and is_primary = false returning 1) select pg_catalog.count(*)::text from d', p_img));
$f$;

-- تفعيل/إنشاء كـ postgres: 'OK' أو SQLSTATE.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
declare
  v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end
$f$;

do $flows$
declare
  o constant text := '00000000-0000-4000-8000-0000000000a1';
  a2 constant text := '00000000-0000-4000-8000-0000000000a2';
  a3 constant text := '00000000-0000-4000-8000-0000000000a3';
  a4 constant text := '00000000-0000-4000-8000-0000000000a4';
  p integer; q integer;
  ia bigint; ib bigint; ic bigint; id_ bigint; iq bigint;
  pa text; pb text;
  r text; r2 text; r3 text; r4 text; r5 text;
begin
  -- F01 صورة مش رئيسية
  p := pg_temp.mkp('f01'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 1, false, 'gallery');
  pb := pg_temp.path(ib);
  r := pg_temp.del(o, p, ib);
  perform pg_temp.zt('F01 owner deletes a non-primary image: row gone, file recorded removed (cleaned_at null), primary unchanged',
    (pg_temp.js(r) ->> 'orphan_recorded') = 'true' and (pg_temp.js(r) -> 'promoted_image_id') = 'null'::jsonb
      and (pg_temp.js(r) ->> 'deleted_image_id')::bigint = ib
      and not exists (select 1 from public.product_images i where i.id = ib)
      and exists (select 1 from public.storage_orphans s where s.object_path = pb and s.reason = 'removed' and s.cleaned_at is null)
      and (select i.is_primary from public.product_images i where i.id = ia), r);

  -- F02 الرئيسية: أول صورة معرض باقية حسب الترتيب (sort_order ثم id) بفجوات وتعادل
  p := pg_temp.mkp('f02'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 5, false, 'gallery');
  ic := pg_temp.img(p, 5, false, 'gallery'); id_ := pg_temp.img(p, 9, false, 'gallery');
  r := pg_temp.del(o, p, ia);
  perform pg_temp.zt('F02 owner deletes the primary: first remaining gallery image by (sort_order, id) becomes primary cover, one primary',
    (pg_temp.js(r) ->> 'promoted_image_id')::bigint = ib
      and (select i.is_primary and i.fit = 'cover' from public.product_images i where i.id = ib)
      and not (select i.is_primary from public.product_images i where i.id = ic)
      and not (select i.is_primary from public.product_images i where i.id = id_)
      and (select pg_catalog.count(*) from public.product_images i where i.product_id = p and i.is_primary) = 1, r);

  -- F03 آخر صورة في منتج مخفي
  p := pg_temp.mkp('f03'); ia := pg_temp.img(p, 0, true, 'gallery');
  r := pg_temp.del(o, p, ia);
  perform pg_temp.zt('F03 last gallery image of a hidden product: deleted, no promotion, product stays hidden without primary',
    pg_temp.st(r) = 'OK' and (pg_temp.js(r) -> 'promoted_image_id') = 'null'::jsonb
      and (select pg_catalog.count(*) from public.product_images i where i.product_id = p) = 0
      and not (select x.is_active from public.products x where x.id = p), r);

  -- F04 آخر صورة في منتج ظاهر
  p := pg_temp.mkp('f04'); ia := pg_temp.img(p, 0, true, 'gallery'); pa := pg_temp.path(ia);
  update public.products set is_active = true where id = p;
  r := pg_temp.del(o, p, ia);
  perform pg_temp.zt('F04 last gallery image of a visible product -> 45702, nothing changed',
    pg_temp.st(r) = '45702' and exists (select 1 from public.product_images i where i.id = ia and i.is_primary)
      and not exists (select 1 from public.storage_orphans s where s.object_path = pa), r);

  -- F05 صورة قبل/بعد في منتج ظاهر فيه صورة معرض واحدة
  p := pg_temp.mkp('f05'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 0, false, 'before');
  update public.products set is_active = true where id = p;
  r := pg_temp.del(o, p, ib);
  perform pg_temp.zt('F05 before/after image in a visible product: deleted, gallery primary untouched',
    pg_temp.st(r) = 'OK' and not exists (select 1 from public.product_images i where i.id = ib)
      and (select i.is_primary from public.product_images i where i.id = ia), r);

  -- F06 صورة من منتج تاني · صورة مش موجودة · قيم null
  q := pg_temp.mkp('f06'); iq := pg_temp.img(q, 0, true, 'gallery');
  r := pg_temp.del(o, p, iq); r2 := pg_temp.del(o, p, 999999999); r3 := pg_temp.del(o, null, iq); r4 := pg_temp.del(o, 999999999, iq);
  perform pg_temp.zt('F06 image of another product / missing image / null / missing product -> 45701, nothing changed',
    pg_temp.st(r) = '45701' and pg_temp.st(r2) = '45701' and pg_temp.st(r3) = '45701' and pg_temp.st(r4) = '45701'
      and exists (select 1 from public.product_images i where i.id = iq), r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);

  -- F07 مسار ليه سجل متعلّم cleaned_at
  p := pg_temp.mkp('f07'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 1, false, 'gallery'); pb := pg_temp.path(ib);
  insert into public.storage_orphans (object_path, reason, cleaned_at) values (pb, 'replaced', pg_catalog.now());
  r := pg_temp.del(o, p, ib);
  perform pg_temp.zt('F07 path with a cleaned_at record -> 45703, nothing changed',
    pg_temp.st(r) = '45703' and exists (select 1 from public.product_images i where i.id = ib), r);

  -- F08 سجل قديم مستني: مفيش سجل جديد و created_at زي ما هو
  p := pg_temp.mkp('f08'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 1, false, 'gallery'); pb := pg_temp.path(ib);
  insert into public.storage_orphans (object_path, reason, created_at) values (pb, 'insert_failed', pg_catalog.now() - interval '30 days');
  r := pg_temp.del(o, p, ib);
  perform pg_temp.zt('F08 old pending record for the path: deleted, orphan_recorded false, record reason and created_at unchanged',
    (pg_temp.js(r) ->> 'orphan_recorded') = 'false' and not exists (select 1 from public.product_images i where i.id = ib)
      and (select pg_catalog.count(*) from public.storage_orphans s where s.object_path = pb) = 1
      and exists (select 1 from public.storage_orphans s where s.object_path = pb and s.reason = 'insert_failed'
                   and s.cleaned_at is null and s.created_at < pg_catalog.now() - interval '29 days'), r);

  -- F09 الهويات
  p := pg_temp.mkp('f09'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 1, false, 'gallery'); pb := pg_temp.path(ib);
  r := pg_temp.del(a2, p, ib); r2 := pg_temp.del(a3, p, ib); r3 := pg_temp.del(a4, p, ib); r4 := pg_temp.del(null, p, ib);
  r5 := pg_temp.call_raw('authenticated', '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}',
          pg_catalog.format('select public.zell_product_image_delete(%s, %s)::text', p, ib));
  perform pg_temp.zt('F09 admin -> 45402 · inactive admin / plain user / forged sub -> 45401 · no session -> 45400, nothing changed',
    pg_temp.st(r) = '45402' and pg_temp.st(r2) = '45401' and pg_temp.st(r3) = '45401' and pg_temp.st(r4) = '45400'
      and pg_temp.st(r5) = '45401'
      and exists (select 1 from public.product_images i where i.id = ib)
      and not exists (select 1 from public.storage_orphans s where s.object_path = pb),
    r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4 || ' | ' || r5);

  -- F10 الأدوار
  r := pg_temp.call_raw('anon', '', pg_catalog.format('select public.zell_product_image_delete(%s, %s)::text', p, ib));
  r2 := pg_temp.call_raw('service_role', '', pg_catalog.format('select public.zell_product_image_delete(%s, %s)::text', p, ib));
  perform pg_temp.zt('F10 anon and service_role cannot execute the delete function (42501)',
    pg_temp.st(r) = '42501' and pg_temp.st(r2) = '42501' and exists (select 1 from public.product_images i where i.id = ib),
    r || ' | ' || r2);

  -- F11 حارس التفعيل
  p := pg_temp.mkp('f11'); ia := pg_temp.img(p, 0, false, 'gallery');
  r := pg_temp.try(pg_catalog.format('update public.products set is_active = true where id = %s', p));
  update public.product_images set is_primary = true, fit = 'cover' where id = ia;
  r2 := pg_temp.try(pg_catalog.format('update public.products set is_active = true where id = %s', p));
  perform pg_temp.zt('F11 activation without a primary gallery image -> 45705; with one -> activated',
    r = '45705' and r2 = 'OK' and (select x.is_active from public.products x where x.id = p), r || ' | ' || r2);

  -- F12 منتج ظاهر من غير رئيسية من قبل: تعديله مابيتقفلش
  update public.product_images set is_primary = false, fit = 'contain' where id = ia;
  r := pg_temp.try(pg_catalog.format('update public.products set is_active = true where id = %s', p));
  r2 := pg_temp.try(pg_catalog.format('update public.products set name_ar = name_ar || %L where id = %s', '-x', p));
  r3 := pg_temp.try(pg_catalog.format('update public.products set is_active = false where id = %s', p));
  perform pg_temp.zt('F12 already-visible product without primary: update of is_active (true->true), name and hiding are not blocked',
    r = 'OK' and r2 = 'OK' and r3 = 'OK', r || ' | ' || r2 || ' | ' || r3);

  -- F13 إنشاء منتج ظاهر
  r := pg_temp.try('insert into public.products (name_ar, price_per_meter_piastres, is_active) values (''ci-0026-f13'', 1000, true)');
  r2 := pg_temp.try('insert into public.products (name_ar, price_per_meter_piastres, is_active) values (''ci-0026-f13b'', 1000, false)');
  perform pg_temp.zt('F13 insert of a visible product -> 45705; hidden insert works', r = '45705' and r2 = 'OK', r || ' | ' || r2);

  -- F14 جملة التراجع المشروطة (service_role، زي مسار الرفع)
  p := pg_temp.mkp('f14'); ia := pg_temp.img(p, 0, true, 'gallery'); ib := pg_temp.img(p, 1, false, 'gallery');
  r := pg_temp.cond_del(ia); r2 := pg_temp.cond_del(ib);
  perform pg_temp.zt('F14 conditional rollback delete (is_primary = false) as service_role: primary -> 0 rows, non-primary -> 1 row',
    r = '0' and r2 = '1' and exists (select 1 from public.product_images i where i.id = ia)
      and not exists (select 1 from public.product_images i where i.id = ib), r || ' | ' || r2);

  -- F15 ضياع رد الإدخال (§٥-د، جزء الداتابيز): X اتدخلت (الرد ضاع) ← حذف P بيرقّي X ← تسجيل insert_failed ← التراجع المشروط صفر
  p := pg_temp.mkp('f15'); ia := pg_temp.img(p, 0, true, 'gallery');
  update public.products set is_active = true where id = p;
  ib := pg_temp.img(p, 1, false, 'gallery'); pb := pg_temp.path(ib);
  r := pg_temp.del(o, p, ia);
  r2 := pg_temp.call_raw('service_role', '',
          pg_catalog.format('insert into public.storage_orphans (bucket, object_path, reason) values (%L, %L, %L) returning 1',
                            'product-images', pb, 'insert_failed'));
  r3 := pg_temp.cond_del(ib);
  r4 := pg_temp.del(o, p, ib);
  perform pg_temp.zt('F15 lost insert reply: delete of P promotes X; insert_failed record for X allowed; conditional rollback -> 0; deleting X -> 45702',
    (pg_temp.js(r) ->> 'promoted_image_id')::bigint = ib and r2 = '1' and r3 = '0' and pg_temp.st(r4) = '45702'
      and (select i.is_primary from public.product_images i where i.id = ib)
      and (select x.is_active from public.products x where x.id = p)
      and exists (select 1 from public.storage_orphans s where s.object_path = pb and s.reason = 'insert_failed'),
    r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);

  -- F16 مفيش صلاحية حذف مباشرة لـ authenticated
  r := pg_temp.call_as('authenticated', o, 'with d as (delete from public.product_images where false returning 1) select pg_catalog.count(*)::text from d');
  perform pg_temp.zt('F16 authenticated (owner session) cannot delete product_images directly (42501)', pg_temp.st(r) = '42501', r);

  -- F17 / F18 policies دور الدالة: الترقية بس، والتسجيل بسبب removed بس
  r := pg_temp.call_raw('zell_catalog_definer', '',
         pg_catalog.format('update public.product_images set fit = %L where id = %s returning 1', 'contain', ib));
  perform pg_temp.zt('F17 zell_catalog_definer cannot set a row that is not primary cover gallery (RLS 42501)',
    pg_temp.st(r) = '42501' and (select i.fit from public.product_images i where i.id = ib) = 'cover', r);
  r := pg_temp.call_raw('zell_catalog_definer', '',
         pg_catalog.format('insert into public.storage_orphans (bucket, object_path, reason) values (%L, %L, %L) returning 1',
                           'product-images', 'products/ci26/x.jpg', 'replaced'));
  perform pg_temp.zt('F18 zell_catalog_definer cannot record a reason other than removed / product_deleted (RLS 42501)',
    pg_temp.st(r) = '42501' and not exists (select 1 from public.storage_orphans s where s.object_path = 'products/ci26/x.jpg'), r);
end
$flows$;

select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where r.outcome = 'fail') = 0 and pg_catalog.count(*) = 18 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where r.outcome = 'pass') || ' fail=' || pg_catalog.count(*) filter (where r.outcome = 'fail') as detail
          from pg_temp.zt_results r
        union all
        select r.n, r.id, r.outcome, r.name || ' :: ' || r.detail from pg_temp.zt_results r) s
 order by s.n;
rollback;
