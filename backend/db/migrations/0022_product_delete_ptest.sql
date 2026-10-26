-- 0022 PRODUCT-DELETE — اختبار قبل التطبيق (smoke على Production) لـ 0022_product_delete.sql
--
-- • قبل التطبيق بس، وإلا ZELL_0022_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. مفيش حذف منتج ولا كتابة بيانات (السيناريوهات الكبيرة في CI:
--   backend/db/ci/0022_flows.sql + backend/db/ci/0022_sql_ci.sh).
-- • الأقفال: الجسم بياخد أقفال DDL قصيرة على products وجداول الصور والإعدادات وstorage_orphans (lock_timeout 5s).
-- • المتوقع: PASS بـ 6 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0022';

do $zguard$
begin
  if pg_catalog.to_regrole('zell_catalog_definer') is not null
     or pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamptz)') is not null then
    raise exception 'ZELL_0022_PTEST_PRE_APPLY_ONLY';
  end if;
  perform pg_catalog.set_config('zell.ptest_fn_md5',
    coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.oid) from pg_catalog.pg_proc p
               where p.oid in (pg_catalog.to_regprocedure('public.zell_order_actor(boolean)'),
                               pg_catalog.to_regprocedure('public.zell_order_claims_actor()'),
                               pg_catalog.to_regprocedure('public.zell_order_admin_role(uuid)'),
                               pg_catalog.to_regprocedure('public.zell_inv_product_has_stock_refs(integer)'))), ''), true);
  perform pg_catalog.set_config('zell.ptest_data',
    (select pg_catalog.count(*) from public.products)::text || '|'
    || (select pg_catalog.count(*) from public.product_images)::text || '|'
    || (select pg_catalog.count(*) from public.storage_orphans)::text || '|'
    || coalesce((select pg_catalog.md5(s.value::text) from public.settings s where s.key = 'home_products'), '-'), true);
  perform pg_catalog.set_config('zell.ptest_fn_count',
    (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace)::text, true);
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

create function pg_temp.call_as(p_role text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    execute 'set local role ' || pg_catalog.quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return 'ERR ' || v_state;
  end;
  return coalesce(r, 'null');
end
$f$;

-- >>> 0022 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · المتطلبات · مش متطبّق قبل كده · الأكواد 45501..45508 مش مستخدمة · منحة helper المخزون مش موجودة.
do $pdpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_con text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0022_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0022_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null
     or pg_catalog.to_regrole('zell_inventory_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_order_claims_actor()') is null
     or pg_catalog.to_regprocedure('public.zell_order_admin_role(uuid)') is null
     or pg_catalog.to_regprocedure('public.zell_inv_product_has_stock_refs(integer)') is null
     or pg_catalog.to_regclass('public.storage_orphans') is null
     or pg_catalog.to_regclass('public.product_addons') is null
     or pg_catalog.to_regclass('public.product_widths') is null
     or pg_catalog.to_regclass('public.product_collections') is null
     or pg_catalog.to_regclass('public.stock_lots') is null then
    raise exception 'ZELL_0022_PREREQ_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_catalog_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('zell_product_delete', 'zell_product_delete_preview',
                                     'zell_inv_product_stock_ref_exists', 'zell_catalog_trg_home_products_guard'))
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.settings'::regclass and t.tgname = 'zell_catalog_home_products_guard') then
    raise exception 'ZELL_0022_ALREADY_APPLIED';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.prosrc ~ '455(0[1-8])') then
    raise exception 'ZELL_0022_CODE_TAKEN';
  end if;
  if pg_catalog.has_function_privilege('zell_inventory_definer',
       'public.zell_inv_product_has_stock_refs(integer)', 'EXECUTE') then
    raise exception 'ZELL_0022_PRE_INV_GRANT_EXISTS';
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid) into v_con
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check';
  if v_con is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text])))' then
    raise exception 'ZELL_0022_ORPHAN_REASON_SHAPE' using detail = coalesce(v_con, '(missing)');
  end if;
end
$pdpre$;

-- (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: SET بس (زي zell_order_definer و zell_inventory_definer).
create role zell_catalog_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;
grant zell_catalog_definer to postgres with inherit false, set true;
grant usage on schema public to zell_catalog_definer;

-- (2) أقل صلاحيات (العقد §٤-ج): منح أعمدة + policies باسم zell_catalog_definer_*. القفل (for update) محتاج منحة UPDATE
--     على عمود وpolicy UPDATE بـ using؛ with check (false) بيمنع أي تعديل فعلي.
grant select (id, is_active, updated_at), update (updated_at), delete on table public.products to zell_catalog_definer;
grant select (id, product_id, bucket, object_path), update (product_id) on table public.product_images to zell_catalog_definer;
grant select (product_id), update (product_id) on table public.product_widths to zell_catalog_definer;
grant select (product_id, addon_id), update (product_id) on table public.product_addons to zell_catalog_definer;
grant select (product_id), update (product_id) on table public.product_collections to zell_catalog_definer;
grant select (product_id) on table public.order_items to zell_catalog_definer;
grant select (key, value, updated_at), update (value, updated_at) on table public.settings to zell_catalog_definer;
grant select (id, bucket, object_path, cleaned_at), update (cleaned_at), insert (bucket, object_path, reason)
  on table public.storage_orphans to zell_catalog_definer;
grant usage on sequence public.storage_orphans_id_seq to zell_catalog_definer;

create policy zell_catalog_definer_select on public.products for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.products for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_delete on public.products for delete to zell_catalog_definer using (true);
create policy zell_catalog_definer_select on public.product_images for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.product_images for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_select on public.product_widths for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.product_widths for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_select on public.product_addons for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.product_addons for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_select on public.product_collections for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.product_collections for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_select on public.order_items for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_select on public.settings for select to zell_catalog_definer using (key = 'home_products');
create policy zell_catalog_definer_update on public.settings for update to zell_catalog_definer
  using (key = 'home_products') with check (key = 'home_products');
create policy zell_catalog_definer_select on public.storage_orphans for select to zell_catalog_definer using (true);
create policy zell_catalog_definer_lock on public.storage_orphans for update to zell_catalog_definer using (true) with check (false);
create policy zell_catalog_definer_insert on public.storage_orphans for insert to zell_catalog_definer
  with check (reason = 'product_deleted' and cleaned_at is null);

-- (3) سبب product_deleted: نفس اسم القيد، والقيم القديمة زي ما هي (العقد §٢-أ).
alter table public.storage_orphans drop constraint storage_orphans_reason_check;
alter table public.storage_orphans add constraint storage_orphans_reason_check
  check (reason = any (array['insert_failed', 'delete_failed', 'replaced', 'removed', 'product_deleted']));

-- (4) سلسلة الهوية: الأولتين مالكهم zell_order_definer (invoker)، والتالتة definer مالكها postgres.
set local role zell_order_definer;
grant execute on function public.zell_order_actor(boolean), public.zell_order_claims_actor() to zell_catalog_definer;
reset role;
grant execute on function public.zell_order_admin_role(uuid) to zell_catalog_definer;

-- (5) سلسلة المخزون (العقد §٤-ب): منحة واحدة على الـ helper (مالكه postgres) لدور المخزون، وغلاف definer مالكه دور المخزون.
grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_inventory_definer;
grant create on schema public to zell_inventory_definer;
set local role zell_inventory_definer;
create function public.zell_inv_product_stock_ref_exists(p_product_id integer)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.zell_inv_product_has_stock_refs(p_product_id)
$fn$;
revoke all on function public.zell_inv_product_stock_ref_exists(integer) from public, anon, authenticated, service_role;
grant execute on function public.zell_inv_product_stock_ref_exists(integer) to zell_catalog_definer;
reset role;
revoke create on schema public from zell_inventory_definer;

-- (6) الدوال: CREATE كـ zell_catalog_definer (SET LOCAL ROLE).
grant create on schema public to zell_catalog_definer;
set local role zell_catalog_definer;

-- الحذف: المالك بس. ترتيب الأقفال (العقد §٥-ب): M ← صف المنتج (بيستنوا لحد lock_timeout) ← الباقي nowait (45508).
create function public.zell_product_delete(p_product_id integer, p_expected_updated_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '3s' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_id integer;
  v_active boolean;
  v_updated timestamptz;
  v_home_value jsonb;
  v_home_found boolean := false;
  v_ids jsonb;
  v_new_ids jsonb;
  v_removed boolean := false;
  v_registered integer := 0;
  v_pending integer := 0;
  v_addon_links integer := 0;
  v_collection_links integer := 0;
  v_constraint text;
begin
  if p_product_id is null then
    raise exception 'ZELL_PRODUCT_NOT_FOUND' using errcode = '45501';
  end if;

  -- (1) M: القفل المشترك للقايمة (بيغطي غياب صف الإعداد).
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_catalog:home_products', 0));
  exception when lock_not_available then
    raise exception 'ZELL_PRODUCT_BUSY' using errcode = '45508', detail = 'home_products_lock';
  end;

  -- (2) صف المنتج.
  begin
    select p.id, p.is_active, p.updated_at into v_id, v_active, v_updated
      from public.products p where p.id = p_product_id for update;
  exception when lock_not_available then
    raise exception 'ZELL_PRODUCT_BUSY' using errcode = '45508', detail = 'product';
  end;
  if v_id is null then
    raise exception 'ZELL_PRODUCT_NOT_FOUND' using errcode = '45501';
  end if;
  if p_expected_updated_at is null
     or pg_catalog.date_trunc('milliseconds', v_updated) <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'ZELL_PRODUCT_CONFLICT' using errcode = '45502';
  end if;
  if v_active then
    raise exception 'ZELL_PRODUCT_VISIBLE' using errcode = '45503';
  end if;
  if exists (select 1 from public.order_items i where i.product_id = p_product_id) then
    raise exception 'ZELL_PRODUCT_HAS_ORDERS' using errcode = '45504';
  end if;
  if public.zell_inv_product_stock_ref_exists(p_product_id) then
    raise exception 'ZELL_PRODUCT_HAS_STOCK' using errcode = '45505';
  end if;

  -- (3)–(5) باقي الأقفال nowait: مفيش انتظار وإحنا ماسكين صف المنتج.
  begin
    select s.value into v_home_value from public.settings s where s.key = 'home_products' for update nowait;
    v_home_found := found;
    perform 1 from public.product_images i where i.product_id = p_product_id for update nowait;
    perform 1 from public.product_widths w where w.product_id = p_product_id for update nowait;
    perform 1 from public.product_collections c where c.product_id = p_product_id for update nowait;
    perform 1 from public.product_addons a where a.product_id = p_product_id or a.addon_id = p_product_id for update nowait;
    perform 1 from public.storage_orphans o
     where exists (select 1 from public.product_images i
                    where i.product_id = p_product_id and i.bucket = o.bucket and i.object_path = o.object_path)
       for update nowait;
  exception when lock_not_available then
    raise exception 'ZELL_PRODUCT_BUSY' using errcode = '45508', detail = 'related_rows';
  end;

  -- تسجيل الصور (العقد §٢-أ): متعلّم cleaned_at = تعارض · مستني = مفيش تغيير · مفيش = insert.
  if exists (select 1 from public.storage_orphans o
              join public.product_images i on i.bucket = o.bucket and i.object_path = o.object_path
             where i.product_id = p_product_id and o.cleaned_at is not null) then
    raise exception 'ZELL_PRODUCT_ORPHAN_CONFLICT' using errcode = '45506';
  end if;
  select pg_catalog.count(*) into v_pending
    from public.storage_orphans o
    join public.product_images i on i.bucket = o.bucket and i.object_path = o.object_path
   where i.product_id = p_product_id and o.cleaned_at is null;
  insert into public.storage_orphans (bucket, object_path, reason)
  select i.bucket, i.object_path, 'product_deleted'
    from public.product_images i
   where i.product_id = p_product_id
     and not exists (select 1 from public.storage_orphans o where o.bucket = i.bucket and o.object_path = i.object_path)
   order by i.id;
  get diagnostics v_registered = row_count;

  select pg_catalog.count(*) into v_addon_links
    from public.product_addons a where a.product_id = p_product_id or a.addon_id = p_product_id;
  select pg_catalog.count(*) into v_collection_links
    from public.product_collections c where c.product_id = p_product_id;

  -- شيل id من قايمة الرئيسية (الترتيب وباقي الاختيارات زي ما هي).
  if v_home_found and pg_catalog.jsonb_typeof(v_home_value) = 'object' then
    v_ids := v_home_value -> 'ids';
    if pg_catalog.jsonb_typeof(v_ids) = 'array' and v_ids @> pg_catalog.jsonb_build_array(p_product_id) then
      select coalesce(pg_catalog.jsonb_agg(x.e order by x.ord), '[]'::jsonb) into v_new_ids
        from pg_catalog.jsonb_array_elements(v_ids) with ordinality as x(e, ord)
       where x.e <> pg_catalog.to_jsonb(p_product_id);
      update public.settings s
         set value = pg_catalog.jsonb_set(s.value, '{ids}', v_new_ids), updated_at = pg_catalog.now()
       where s.key = 'home_products';
      v_removed := true;
    end if;
  end if;

  -- المسح: التوابع بالـ cascade. الـ FK حارس أخير.
  begin
    delete from public.products p where p.id = p_product_id;
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'order_items_product_id_fkey' then
      raise exception 'ZELL_PRODUCT_HAS_ORDERS' using errcode = '45504', detail = v_constraint;
    end if;
    raise exception 'ZELL_PRODUCT_HAS_STOCK' using errcode = '45505', detail = coalesce(v_constraint, '');
  end;

  return pg_catalog.jsonb_build_object(
           'deleted', true,
           'product_id', p_product_id,
           'images_registered', v_registered,
           'images_already_pending', v_pending,
           'removed_from_home', v_removed,
           'addon_links', v_addon_links,
           'collection_links', v_collection_links);
end
$fn$;

-- المعاينة: قراية بس، المالك بس. معلومة لحظة القراية؛ الحذف بيعيد الفحص.
create function public.zell_product_delete_preview(p_product_id integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_active boolean;
  v_updated timestamptz;
  v_has_orders boolean;
  v_has_stock boolean;
  v_conflict boolean;
  v_in_home boolean;
begin
  select p.is_active, p.updated_at into v_active, v_updated from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'ZELL_PRODUCT_NOT_FOUND' using errcode = '45501';
  end if;
  v_has_orders := exists (select 1 from public.order_items i where i.product_id = p_product_id);
  v_has_stock := public.zell_inv_product_stock_ref_exists(p_product_id);
  v_conflict := exists (select 1 from public.storage_orphans o
                          join public.product_images i on i.bucket = o.bucket and i.object_path = o.object_path
                         where i.product_id = p_product_id and o.cleaned_at is not null);
  v_in_home := coalesce((select pg_catalog.jsonb_typeof(s.value -> 'ids') = 'array'
                                and (s.value -> 'ids') @> pg_catalog.jsonb_build_array(p_product_id)
                           from public.settings s where s.key = 'home_products'), false);
  return pg_catalog.jsonb_build_object(
           'product_id', p_product_id,
           'is_active', v_active,
           'updated_at', v_updated,
           'has_orders', v_has_orders,
           'has_stock', v_has_stock,
           'orphan_conflict', v_conflict,
           'images', (select pg_catalog.count(*) from public.product_images i where i.product_id = p_product_id),
           'widths', (select pg_catalog.count(*) from public.product_widths w where w.product_id = p_product_id),
           'addons', (select pg_catalog.count(*) from public.product_addons a where a.product_id = p_product_id),
           'used_as_addon_in', (select pg_catalog.count(*) from public.product_addons a where a.addon_id = p_product_id),
           'collections', (select pg_catalog.count(*) from public.product_collections c where c.product_id = p_product_id),
           'in_home', v_in_home,
           'can_delete', not v_active and not v_has_orders and not v_has_stock and not v_conflict);
end
$fn$;

-- حارس قايمة الرئيسية (العقد §٥-أ): M أولًا، وبعدين أي id **جديد** في القايمة لازم يكون منتج موجود (قراية عادية، من غير
-- قفل منتجات). الـ ids اللي كانت موجودة قبل كده مابتتفحصش، علشان حذف id من القايمة مايتمنعش بقيمة قديمة.
create function public.zell_catalog_trg_home_products_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_new jsonb;
  v_old jsonb := '[]'::jsonb;
  v_missing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_catalog:home_products', 0));
  v_new := case when pg_catalog.jsonb_typeof(new.value -> 'ids') = 'array' then new.value -> 'ids' else '[]'::jsonb end;
  if tg_op = 'UPDATE' and pg_catalog.jsonb_typeof(old.value -> 'ids') = 'array' then
    v_old := old.value -> 'ids';
  end if;
  select pg_catalog.count(*) into v_missing
    from pg_catalog.jsonb_array_elements(v_new) as x(e)
   where pg_catalog.jsonb_typeof(x.e) = 'number'
     and not (v_old @> pg_catalog.jsonb_build_array(x.e))
     and not exists (select 1 from public.products p where pg_catalog.to_jsonb(p.id) = x.e);
  if v_missing > 0 then
    raise exception 'ZELL_HOME_PRODUCTS_MISSING' using errcode = '45507';
  end if;
  return new;
end
$fn$;

reset role;

-- الـ trigger قبل سحب EXECUTE من PUBLIC: CREATE TRIGGER بيطلب EXECUTE على الدالة للي بينشئه (postgres مش superuser
-- ومش وارث الدور). وقت التشغيل الـ trigger مابيفحصش EXECUTE.
create trigger zell_catalog_home_products_guard
  before insert or update of value on public.settings
  for each row when (new.key = 'home_products')
  execute function public.zell_catalog_trg_home_products_guard();

set local role zell_catalog_definer;
revoke all on function public.zell_product_delete(integer, timestamptz),
  public.zell_product_delete_preview(integer),
  public.zell_catalog_trg_home_products_guard()
  from public, anon, authenticated, service_role;
grant execute on function public.zell_product_delete(integer, timestamptz),
  public.zell_product_delete_preview(integer) to authenticated;
reset role;
revoke create on schema public from zell_catalog_definer;

-- (7) postflight
do $pdpost$
declare
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamptz)');
  v_pre oid := pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)');
  v_trg oid := pg_catalog.to_regprocedure('public.zell_catalog_trg_home_products_guard()');
  v_inv oid := pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)');
begin
  if v_del is null or v_pre is null or v_trg is null or v_inv is null
     or exists (select 1 from pg_catalog.pg_proc p where p.oid in (v_del, v_pre, v_trg)
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_catalog_definer' or not p.prosecdef))
     or (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_del) is distinct from array['search_path=""', 'lock_timeout=3s']
     or exists (select 1 from pg_catalog.pg_proc p where p.oid in (v_pre, v_trg, v_inv)
                   and p.proconfig is distinct from array['search_path=""'])
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_inv) <> 'zell_inventory_definer'
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_inv)
     or not pg_catalog.has_function_privilege('authenticated', v_del, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_pre, 'EXECUTE')
     or exists (select 1 from (values ('anon'), ('service_role')) r(n), (values (v_del), (v_pre), (v_inv)) f(o)
                 where pg_catalog.has_function_privilege(r.n, f.o, 'EXECUTE'))
     or pg_catalog.has_function_privilege('authenticated', v_inv, 'EXECUTE')
     or not pg_catalog.has_function_privilege('zell_catalog_definer', v_inv, 'EXECUTE')
     or not pg_catalog.has_function_privilege('zell_inventory_definer', 'public.zell_inv_product_has_stock_refs(integer)', 'EXECUTE')
     or pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE')
     or pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE')
     or exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer'
                   and (r.rolcanlogin or r.rolbypassrls or r.rolinherit or r.rolsuper or r.rolcreaterole or r.rolcreatedb))
     or (select pg_catalog.count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%') <> 17
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.settings'::regclass and t.tgname = 'zell_catalog_home_products_guard'
                       and t.tgenabled = 'O' and t.tgfoid = v_trg)
     or (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')
        is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))' then
    raise exception 'ZELL_0022_POST_SHAPE';
  end if;
end
$pdpost$;
-- <<< 0022 BODY

do $zT$
declare
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamptz)');
  v_pre oid := pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)');
  v_trg oid := pg_catalog.to_regprocedure('public.zell_catalog_trg_home_products_guard()');
  v_inv oid := pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)');
  v_ref oid := pg_catalog.to_regprocedure('public.zell_inv_product_has_stock_refs(integer)');
begin
  perform pg_temp.zt('T01 objects: 3 functions (zell_catalog_definer, definer, empty search_path; delete volatile + lock_timeout 3s), stock wrapper (zell_inventory_definer), guard trigger on settings',
    (select count(*) from pg_catalog.pg_proc p
      where p.oid in (v_del, v_pre, v_trg) and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef) = 3
    and (select p.provolatile = 'v' and p.proconfig = array['search_path=""', 'lock_timeout=3s'] from pg_catalog.pg_proc p where p.oid = v_del)
    and (select p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = v_pre)
    and (select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_inventory_definer' and p.prosecdef and p.proconfig = array['search_path=""']
           from pg_catalog.pg_proc p where p.oid = v_inv)
    and exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.settings'::regclass and t.tgname = 'zell_catalog_home_products_guard'
                   and t.tgfoid = v_trg and t.tgenabled = 'O' and not t.tgisinternal), null);
  perform pg_temp.zt('T02 role: NOLOGIN NOINHERIT NOBYPASSRLS; postgres membership SET only; no CREATE on public for the two definers',
    exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer'
               and not r.rolcanlogin and not r.rolinherit and not r.rolbypassrls and not r.rolsuper
               and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication)
    and exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_catalog_definer'::regrole and m.member = 'postgres'::regrole and m.set_option)
    and not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_catalog_definer'::regrole and m.inherit_option)
    and not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_catalog_definer'::regrole and m.member <> 'postgres'::regrole)
    and not exists (select 1 from pg_catalog.pg_auth_members m where m.member = 'zell_catalog_definer'::regrole)
    and not pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE')
    and not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE'), null);
  perform pg_temp.zt('T03 EXECUTE: delete/preview authenticated only · wrapper zell_catalog_definer only · helper + zell_inventory_definer · anon/service_role nothing',
    pg_catalog.has_function_privilege('authenticated', v_del, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', v_pre, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_trg, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_inv, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_ref, 'EXECUTE')
    and pg_catalog.has_function_privilege('zell_catalog_definer', v_inv, 'EXECUTE')
    and not pg_catalog.has_function_privilege('zell_catalog_definer', v_ref, 'EXECUTE')
    and pg_catalog.has_function_privilege('zell_inventory_definer', v_ref, 'EXECUTE')
    and not exists (select 1 from (values ('anon'), ('service_role')) r(n), (values (v_del), (v_pre), (v_trg), (v_inv), (v_ref)) f(o)
                     where pg_catalog.has_function_privilege(r.n, f.o, 'EXECUTE'))
    and pg_temp.call_as('anon', 'select public.zell_product_delete_preview(1)::text') = 'ERR 42501'
    and pg_temp.call_as('service_role', 'select public.zell_product_delete(1, now())::text') = 'ERR 42501', null);
  perform pg_temp.zt('T04 policies: 17 zell_catalog_definer_* for that role only; storage_orphans reason accepts product_deleted',
    (select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.policyname like 'zell\_catalog\_definer\_%'
        and p.roles = array['zell_catalog_definer']::name[]) = 17
    and not exists (select 1 from pg_catalog.pg_policies p
                     where p.policyname like 'zell\_catalog\_definer\_%' and p.roles <> array['zell_catalog_definer']::name[])
    and (select pg_catalog.pg_get_constraintdef(c.oid) like '%''product_deleted''::text%' from pg_catalog.pg_constraint c
          where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check'), null);
  perform pg_temp.zt('T05 identity live: delete / preview without a session -> 45400',
    pg_temp.call_as('authenticated', 'select public.zell_product_delete(1, now())::text') = 'ERR 45400'
    and pg_temp.call_as('authenticated', 'select public.zell_product_delete_preview(1)::text') = 'ERR 45400', null);
  perform pg_temp.zt('T06 nothing else touched: identity + stock helper bodies, products / images / orphans counts, home list, public functions +4',
    coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ',' order by p.oid) from pg_catalog.pg_proc p
               where p.oid in (pg_catalog.to_regprocedure('public.zell_order_actor(boolean)'),
                               pg_catalog.to_regprocedure('public.zell_order_claims_actor()'),
                               pg_catalog.to_regprocedure('public.zell_order_admin_role(uuid)'), v_ref)), '')
      = pg_catalog.current_setting('zell.ptest_fn_md5')
    and (select pg_catalog.count(*) from public.products)::text || '|'
        || (select pg_catalog.count(*) from public.product_images)::text || '|'
        || (select pg_catalog.count(*) from public.storage_orphans)::text || '|'
        || coalesce((select pg_catalog.md5(s.value::text) from public.settings s where s.key = 'home_products'), '-')
      = pg_catalog.current_setting('zell.ptest_data')
    and (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace)
      = pg_catalog.current_setting('zell.ptest_fn_count')::bigint + 4, null);
exception when others then
  perform pg_temp.zt('ABORT_T block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zT$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 6 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
