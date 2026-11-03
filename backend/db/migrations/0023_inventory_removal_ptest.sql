-- 0023 INVENTORY-REMOVAL — اختبار قبل التطبيق (smoke) لـ 0023_inventory_removal.sql
--
-- • قبل التطبيق بس (الدور لازم يكون موجود)، وإلا ZELL_0023_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • التشغيل: بعد begin; سطر الأعداد بالحرف زي التطبيق (من غيره الجسم بيرفض ZELL_0023_DATA_CHANGED):
--     set local zell.inv_expected = '<سطر الأعداد من قراية Production قبل الخطوة>';
--   سطر الموافقة جوه الملف ده (ptest-0023) لأن المعاملة بترجع.
-- • الأثر على Production: كله جوه المعاملة وبيترجع. الأقفال: drop table/trigger بياخد قفل حصري على جداول المخزون و products
--   لحد الـ rollback، فالتشغيل في وقت هادي.
-- • المتوقع: PASS (5 نجاح، 0 فشل).

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0023';

do $zguard$
begin
  if pg_catalog.to_regrole('zell_inventory_definer') is null then
    raise exception 'ZELL_0023_PTEST_PRE_APPLY_ONLY';
  end if;
end
$zguard$;

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

do $zpre$
begin
  perform pg_catalog.set_config('zt.impact10', (select pg_catalog.count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('paid_piastres','confirmation_fee_piastres'))
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%')
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('order_payments','zell_payment_methods','zell_payment_settings','zell_payment_config_log','zell_payment_commands'))
   || '|' || (select coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order')
   || '|' || (select coalesce(pg_catalog.string_agg(pg_catalog.pg_get_userbyid(p.proowner), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order')
   || '|' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_apply_transition(public.orders, text, uuid, text)')), '')
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%')
   || '|' || (select pg_catalog.count(*) from public.erp_capabilities)
   || '|' || (select pg_catalog.count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today')
   || '|' || (select pg_catalog.count(*) from public.erp_user_grants), true);
end
$zpre$;

-- >>> 0023 BODY
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- (0) preflight: المتصل · الموافقة · مش متطبّق · دالتين الحذف = الحي · مفيش مخزون حقيقي · الأعداد = المتوقع · الشكل · لقطة قبل.
do $p23$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_exp text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.inv_expected', true), ''));
  v_role oid := pg_catalog.to_regrole('zell_inventory_definer');
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)');
  v_pre oid := pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)');
  v_now text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0023_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0023_APPROVAL_MISSING';
  end if;
  if v_role is null or pg_catalog.to_regclass('public.stock_lots') is null then
    raise exception 'ZELL_0023_ALREADY_APPLIED';
  end if;
  if v_del is null or v_pre is null
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_del) <> '4aa0deeeb83feb653b9e363c2d418330'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = v_pre) <> '1396940b24ae2b4e5fa8c96a2ef00ea7'
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_del) <> 'zell_catalog_definer'
     or (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = v_pre) <> 'zell_catalog_definer' then
    raise exception 'ZELL_0023_PRODUCT_DELETE_DRIFT';
  end if;
  if exists (select 1 from public.purchase_docs d where d.status in ('posted', 'voided'))
     or exists (select 1 from public.opening_stock_docs d where d.status in ('posted', 'voided'))
     or exists (select 1 from public.stock_lots) or exists (select 1 from public.purchase_doc_lines)
     or exists (select 1 from public.purchase_doc_charges) or exists (select 1 from public.opening_stock_lines) then
    raise exception 'ZELL_0023_REAL_STOCK_DATA';
  end if;
  v_now := 'locations=' || (select pg_catalog.count(*) from public.inventory_locations)
          || ' suppliers=' || (select pg_catalog.count(*) from public.suppliers)
          || ' purchase_docs=' || (select pg_catalog.count(*) from public.purchase_docs)
          || ' purchase_doc_lines=' || (select pg_catalog.count(*) from public.purchase_doc_lines)
          || ' purchase_doc_charges=' || (select pg_catalog.count(*) from public.purchase_doc_charges)
          || ' opening_docs=' || (select pg_catalog.count(*) from public.opening_stock_docs)
          || ' opening_lines=' || (select pg_catalog.count(*) from public.opening_stock_lines)
          || ' stock_lots=' || (select pg_catalog.count(*) from public.stock_lots)
          || ' commands=' || (select pg_catalog.count(*) from public.inventory_commands)
          || ' audit=' || (select pg_catalog.count(*) from public.inventory_audit_log);
  if v_exp = '' or v_exp <> v_now then
    raise exception 'ZELL_0023_DATA_CHANGED' using detail = v_now;
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 68
     or (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.proowner = v_role) <> 56
     or (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')) <> 10
     or (select pg_catalog.count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log') and not t.tgisinternal) <> 34
     or (select pg_catalog.count(*) from pg_catalog.pg_trigger t where t.tgrelid = 'public.products'::regclass and t.tgname = 'zinv_products_sale_unit') <> 1
     or exists (select 1 from pg_catalog.pg_class c where c.relowner = v_role and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
                 and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
     or exists (select 1 from pg_catalog.pg_proc p where p.proowner = v_role and p.proname not like 'zell\_inv\_%')
     or exists (select 1 from pg_catalog.pg_constraint co join pg_catalog.pg_class cl on cl.oid = co.conrelid
                 where co.contype = 'f' and co.confrelid in (select c.oid from pg_catalog.pg_class c
                                                              where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'))
                   and cl.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'))
     or exists (select 1 from pg_catalog.pg_auth_members m where m.member = v_role)
     or exists (select 1 from pg_catalog.pg_auth_members m where m.roleid = v_role and pg_catalog.pg_get_userbyid(m.member) <> 'postgres')
     or exists (select 1 from pg_catalog.pg_default_acl d where d.defaclrole = v_role)
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_inv\_%'
                 and p.prosrc ~ '\m(inventory_locations|suppliers|purchase_docs|purchase_doc_lines|purchase_doc_charges|opening_stock_docs|opening_stock_lines|stock_lots|inventory_commands|inventory_audit_log)\M') then
    raise exception 'ZELL_0023_SHAPE';
  end if;
  perform pg_catalog.set_config('zell.t23_fp', pg_catalog.md5(pg_catalog.concat_ws('|',
      (select pg_catalog.string_agg(c.relname || '=' || coalesce(c.relacl::text, '-') || '/' || pg_catalog.pg_get_userbyid(c.relowner) || '/' || c.relkind::text, ',' order by c.relname)
         from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq')
          and not exists (select 1 from pg_catalog.pg_depend d join pg_catalog.pg_class t on t.oid = d.refobjid
                           where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
                             and t.relnamespace = 'public'::regnamespace and t.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'))),
      (select pg_catalog.string_agg(c.relname || '.' || a.attname || '=' || a.attacl::text, ',' order by c.relname, a.attname)
         from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace and a.attacl is not null and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1)
         from pg_catalog.aclexplode((select n.nspacl from pg_catalog.pg_namespace n where n.nspname = 'public')) x
        where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '-') || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner)
                                    || '=' || p.prosecdef::text || '=' || coalesce(p.proconfig::text, '-'), ',' order by p.oid::regprocedure::text)
         from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_inv\_%'
          and p.proname not in ('zell_product_delete', 'zell_product_delete_preview')),
      (select pg_catalog.string_agg(c.relname || '/' || po.polname || '/' || po.polcmd::text || '/' || pg_catalog.array_to_string(po.polroles, '+') || '/'
                                    || coalesce(pg_catalog.pg_get_expr(po.polqual, po.polrelid), '-') || '/' || coalesce(pg_catalog.pg_get_expr(po.polwithcheck, po.polrelid), '-'), ',' order by c.relname, po.polname)
         from pg_catalog.pg_policy po join pg_catalog.pg_class c on c.oid = po.polrelid where c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(co.conrelid::regclass::text || '/' || co.conname || '/' || pg_catalog.pg_get_constraintdef(co.oid), ',' order by co.conrelid::regclass::text, co.conname)
         from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid = co.conrelid
        where co.connamespace = 'public'::regnamespace and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(t.tgrelid::regclass::text || '/' || t.tgname || '/' || t.tgenabled::text || '/' || t.tgfoid::regprocedure::text, ',' order by t.tgrelid::regclass::text, t.tgname)
         from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log') and t.tgname <> 'zinv_products_sale_unit'),
      (select pg_catalog.string_agg(r.rolname, ',' order by r.rolname) from pg_catalog.pg_roles r where r.rolname <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(pg_catalog.pg_get_userbyid(m.roleid) || '>' || pg_catalog.pg_get_userbyid(m.member) || '/' || m.set_option::text || m.inherit_option::text || m.admin_option::text, ',' order by 1)
         from pg_catalog.pg_auth_members m
        where pg_catalog.pg_get_userbyid(m.roleid) <> 'zell_inventory_definer' and pg_catalog.pg_get_userbyid(m.member) <> 'zell_inventory_definer'))), true);
  perform pg_catalog.set_config('zell.t23_rows', (select pg_catalog.count(*) from public.products) || ',' || (select pg_catalog.count(*) from public.product_images) || ',' || (select pg_catalog.count(*) from public.product_widths)
      || ',' || (select pg_catalog.count(*) from public.product_addons) || ',' || (select pg_catalog.count(*) from public.product_collections) || ',' || (select pg_catalog.count(*) from public.collections)
      || ',' || (select pg_catalog.count(*) from public.orders) || ',' || (select pg_catalog.count(*) from public.order_items) || ',' || (select pg_catalog.count(*) from public.order_events)
      || ',' || (select pg_catalog.count(*) from public.order_payments) || ',' || (select pg_catalog.count(*) from public.storage_orphans)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.key || '=' || s.value::text, ',' order by s.key), '')) from public.settings s)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, ',' order by a.user_id), '')) from public.admin_users a), true);
  perform pg_catalog.set_config('zell.t23_del', (select pg_catalog.pg_get_userbyid(p.proowner) || '/' || p.prosecdef::text || '/' || p.provolatile::text || '/' || coalesce(p.proconfig::text, '-') || '/' || coalesce(p.proacl::text, '-')
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)')), true);
  perform pg_catalog.set_config('zell.t23_pre', (select pg_catalog.pg_get_userbyid(p.proowner) || '/' || p.prosecdef::text || '/' || p.provolatile::text || '/' || coalesce(p.proconfig::text, '-') || '/' || coalesce(p.proacl::text, '-')
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)')), true);
end
$p23$;

-- (1) دالتين حذف المنتج (مالكهم zell_catalog_definer): نفس التعريف بالحرف ناقص فحص المخزون.
grant create on schema public to zell_catalog_definer;
set local role zell_catalog_definer;

create or replace function public.zell_product_delete(p_product_id integer, p_expected_updated_at timestamptz)
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

create or replace function public.zell_product_delete_preview(p_product_id integer)
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
  v_has_stock := false; -- 0023 INVENTORY-REMOVAL: مفيش مخزون بعد الإزالة؛ الرد بنفس المفاتيح والشكل.
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

reset role;
revoke create on schema public from zell_catalog_definer;

-- (2) trigger وحدة البيع على المنتجات (45217) ودالته (مالكها postgres).
drop trigger zinv_products_sale_unit on public.products;
drop function public.zell_inv_trg_products_sale_unit();

-- (3) جداول المخزون العشرة في جملة drop واحدة (Postgres بيحل المفاتيح بينهم، من غير cascade)، بدور مالكهم الواحد، وبعدها الـ sequences.
do $t23$
declare
  r record;
  v_owners text[];
  v_owner text;
begin
  select pg_catalog.array_agg(distinct pg_catalog.pg_get_userbyid(c.relowner)) into v_owners from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log');
  if pg_catalog.cardinality(v_owners) is distinct from 1 then
    raise exception 'ZELL_0023_SHAPE' using detail = 'inventory table owners ' || coalesce(v_owners::text, '-');
  end if;
  v_owner := v_owners[1];
  if v_owner <> 'postgres' then
    execute pg_catalog.format('set local role %I', v_owner);
  end if;
  drop table public.stock_lots, public.purchase_doc_charges, public.purchase_doc_lines, public.opening_stock_lines,
             public.purchase_docs, public.opening_stock_docs, public.suppliers, public.inventory_locations,
             public.inventory_audit_log, public.inventory_commands;
  if v_owner <> 'postgres' then
    execute 'reset role';
  end if;
  for r in select c.relname as s, pg_catalog.pg_get_userbyid(c.relowner) as o from pg_catalog.pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname in ('purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq') loop
    if r.o <> 'postgres' then
      execute pg_catalog.format('set local role %I', r.o);
    end if;
    execute pg_catalog.format('drop sequence public.%I', r.s);
    if r.o <> 'postgres' then
      execute 'reset role';
    end if;
  end loop;
end
$t23$;

-- (4) كل دوال zell_inv_* (القديمة · الجلسة · المساعدة · دوال الـ triggers · فحص المخزون بتاع 0022)، كل واحدة بدور مالكها.
do $f23$
declare
  r record;
begin
  for r in select p.oid::regprocedure::text as sig, pg_catalog.pg_get_userbyid(p.proowner) as o from pg_catalog.pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%' order by 1 loop
    if r.o <> 'postgres' then
      execute pg_catalog.format('set local role %I', r.o);
    end if;
    execute 'drop function ' || r.sig;
    if r.o <> 'postgres' then
      execute 'reset role';
    end if;
  end loop;
end
$f23$;

-- (5) الدور: مالوش أي كائن دلوقتي. أي صلاحية فاضلة على الـ schema بتتشال بالاسم، وبعدين الدور.
revoke all on schema public from zell_inventory_definer;
drop role zell_inventory_definer;

-- (6) postflight
do $q23$
begin
  if pg_catalog.to_regrole('zell_inventory_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
     or exists (select 1 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.products'::regclass and t.tgname = 'zinv_products_sale_unit')
     or exists (select 1 from pg_catalog.pg_policies p where p.schemaname = 'public' and p.policyname like 'zinv\_%')
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\m(inventory_locations|suppliers|purchase_docs|purchase_doc_lines|purchase_doc_charges|opening_stock_docs|opening_stock_lines|stock_lots|inventory_commands|inventory_audit_log)\M')
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)')) is distinct from '84b80a92c3c413433a71d80300bd5418'
     or (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)')) is distinct from '39cf41edb6e8a5fcee5ea9e35081a0b5'
     or (select pg_catalog.pg_get_userbyid(p.proowner) || '/' || p.prosecdef::text || '/' || p.provolatile::text || '/' || coalesce(p.proconfig::text, '-') || '/' || coalesce(p.proacl::text, '-')
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)')) is distinct from pg_catalog.current_setting('zell.t23_del')
     or (select pg_catalog.pg_get_userbyid(p.proowner) || '/' || p.prosecdef::text || '/' || p.provolatile::text || '/' || coalesce(p.proconfig::text, '-') || '/' || coalesce(p.proacl::text, '-')
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)')) is distinct from pg_catalog.current_setting('zell.t23_pre')
     or pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE') then
    raise exception 'ZELL_0023_POST_SHAPE';
  end if;
  if pg_catalog.md5(pg_catalog.concat_ws('|',
      (select pg_catalog.string_agg(c.relname || '=' || coalesce(c.relacl::text, '-') || '/' || pg_catalog.pg_get_userbyid(c.relowner) || '/' || c.relkind::text, ',' order by c.relname)
         from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq')
          and not exists (select 1 from pg_catalog.pg_depend d join pg_catalog.pg_class t on t.oid = d.refobjid
                           where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
                             and t.relnamespace = 'public'::regnamespace and t.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'))),
      (select pg_catalog.string_agg(c.relname || '.' || a.attname || '=' || a.attacl::text, ',' order by c.relname, a.attname)
         from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace and a.attacl is not null and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1)
         from pg_catalog.aclexplode((select n.nspacl from pg_catalog.pg_namespace n where n.nspname = 'public')) x
        where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '-') || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner)
                                    || '=' || p.prosecdef::text || '=' || coalesce(p.proconfig::text, '-'), ',' order by p.oid::regprocedure::text)
         from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_inv\_%'
          and p.proname not in ('zell_product_delete', 'zell_product_delete_preview')),
      (select pg_catalog.string_agg(c.relname || '/' || po.polname || '/' || po.polcmd::text || '/' || pg_catalog.array_to_string(po.polroles, '+') || '/'
                                    || coalesce(pg_catalog.pg_get_expr(po.polqual, po.polrelid), '-') || '/' || coalesce(pg_catalog.pg_get_expr(po.polwithcheck, po.polrelid), '-'), ',' order by c.relname, po.polname)
         from pg_catalog.pg_policy po join pg_catalog.pg_class c on c.oid = po.polrelid where c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(co.conrelid::regclass::text || '/' || co.conname || '/' || pg_catalog.pg_get_constraintdef(co.oid), ',' order by co.conrelid::regclass::text, co.conname)
         from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid = co.conrelid
        where co.connamespace = 'public'::regnamespace and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(t.tgrelid::regclass::text || '/' || t.tgname || '/' || t.tgenabled::text || '/' || t.tgfoid::regprocedure::text, ',' order by t.tgrelid::regclass::text, t.tgname)
         from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log') and t.tgname <> 'zinv_products_sale_unit'),
      (select pg_catalog.string_agg(r.rolname, ',' order by r.rolname) from pg_catalog.pg_roles r where r.rolname <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(pg_catalog.pg_get_userbyid(m.roleid) || '>' || pg_catalog.pg_get_userbyid(m.member) || '/' || m.set_option::text || m.inherit_option::text || m.admin_option::text, ',' order by 1)
         from pg_catalog.pg_auth_members m
        where pg_catalog.pg_get_userbyid(m.roleid) <> 'zell_inventory_definer' and pg_catalog.pg_get_userbyid(m.member) <> 'zell_inventory_definer'))) is distinct from pg_catalog.current_setting('zell.t23_fp') then
    raise exception 'ZELL_0023_POST_OUTSIDE_CHANGED';
  end if;
  if (select pg_catalog.count(*) from public.products) || ',' || (select pg_catalog.count(*) from public.product_images) || ',' || (select pg_catalog.count(*) from public.product_widths)
      || ',' || (select pg_catalog.count(*) from public.product_addons) || ',' || (select pg_catalog.count(*) from public.product_collections) || ',' || (select pg_catalog.count(*) from public.collections)
      || ',' || (select pg_catalog.count(*) from public.orders) || ',' || (select pg_catalog.count(*) from public.order_items) || ',' || (select pg_catalog.count(*) from public.order_events)
      || ',' || (select pg_catalog.count(*) from public.order_payments) || ',' || (select pg_catalog.count(*) from public.storage_orphans)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.key || '=' || s.value::text, ',' order by s.key), '')) from public.settings s)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, ',' order by a.user_id), '')) from public.admin_users a) is distinct from pg_catalog.current_setting('zell.t23_rows') then
    raise exception 'ZELL_0023_POST_ROWS_CHANGED';
  end if;
end
$q23$;
-- <<< 0023 BODY

do $zT$
begin
  perform pg_temp.zt('T01 inventory gone: role · 10 tables · 4 sequences · zell_inv_* · zinv policies · products trigger', pg_catalog.to_regrole('zell_inventory_definer') is null
      and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
      and not exists (select 1 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
      and not exists (select 1 from pg_catalog.pg_policies p where p.schemaname = 'public' and p.policyname like 'zinv\_%')
      and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.products'::regclass and t.tgname like 'zinv%'), null);
  perform pg_temp.zt('T02 product delete functions: new md5 (84b80a92 · 39cf41ed), owner · security definer · volatility · config · EXECUTE unchanged', (select pg_catalog.md5(p.prosrc) = '84b80a92c3c413433a71d80300bd5418' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef and p.provolatile = 'v'
              and pg_catalog.cardinality(p.proconfig) = 2 and 'search_path=""' = any(p.proconfig) and 'lock_timeout=3s' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)'))
      and (select pg_catalog.md5(p.prosrc) = '39cf41edb6e8a5fcee5ea9e35081a0b5' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef and p.provolatile = 's'
              and pg_catalog.cardinality(p.proconfig) = 1 and 'search_path=""' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete_preview(integer)'))
      and pg_catalog.has_function_privilege('authenticated', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', 'public.zell_product_delete_preview(integer)', 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE') and not pg_catalog.has_function_privilege('anon', 'public.zell_product_delete_preview(integer)', 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', 'public.zell_product_delete(integer, timestamp with time zone)', 'EXECUTE') and not pg_catalog.has_function_privilege('service_role', 'public.zell_product_delete_preview(integer)', 'EXECUTE'), null);
  perform pg_temp.zt('T03 outside inventory unchanged: catalog fingerprint and rows = before', pg_catalog.md5(pg_catalog.concat_ws('|',
      (select pg_catalog.string_agg(c.relname || '=' || coalesce(c.relacl::text, '-') || '/' || pg_catalog.pg_get_userbyid(c.relowner) || '/' || c.relkind::text, ',' order by c.relname)
         from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq')
          and not exists (select 1 from pg_catalog.pg_depend d join pg_catalog.pg_class t on t.oid = d.refobjid
                           where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
                             and t.relnamespace = 'public'::regnamespace and t.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'))),
      (select pg_catalog.string_agg(c.relname || '.' || a.attname || '=' || a.attacl::text, ',' order by c.relname, a.attname)
         from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace and a.attacl is not null and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1)
         from pg_catalog.aclexplode((select n.nspacl from pg_catalog.pg_namespace n where n.nspname = 'public')) x
        where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '-') || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner)
                                    || '=' || p.prosecdef::text || '=' || coalesce(p.proconfig::text, '-'), ',' order by p.oid::regprocedure::text)
         from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_inv\_%'
          and p.proname not in ('zell_product_delete', 'zell_product_delete_preview')),
      (select pg_catalog.string_agg(c.relname || '/' || po.polname || '/' || po.polcmd::text || '/' || pg_catalog.array_to_string(po.polroles, '+') || '/'
                                    || coalesce(pg_catalog.pg_get_expr(po.polqual, po.polrelid), '-') || '/' || coalesce(pg_catalog.pg_get_expr(po.polwithcheck, po.polrelid), '-'), ',' order by c.relname, po.polname)
         from pg_catalog.pg_policy po join pg_catalog.pg_class c on c.oid = po.polrelid where c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(co.conrelid::regclass::text || '/' || co.conname || '/' || pg_catalog.pg_get_constraintdef(co.oid), ',' order by co.conrelid::regclass::text, co.conname)
         from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid = co.conrelid
        where co.connamespace = 'public'::regnamespace and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')),
      (select pg_catalog.string_agg(t.tgrelid::regclass::text || '/' || t.tgname || '/' || t.tgenabled::text || '/' || t.tgfoid::regprocedure::text, ',' order by t.tgrelid::regclass::text, t.tgname)
         from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relname not in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log') and t.tgname <> 'zinv_products_sale_unit'),
      (select pg_catalog.string_agg(r.rolname, ',' order by r.rolname) from pg_catalog.pg_roles r where r.rolname <> 'zell_inventory_definer'),
      (select pg_catalog.string_agg(pg_catalog.pg_get_userbyid(m.roleid) || '>' || pg_catalog.pg_get_userbyid(m.member) || '/' || m.set_option::text || m.inherit_option::text || m.admin_option::text, ',' order by 1)
         from pg_catalog.pg_auth_members m
        where pg_catalog.pg_get_userbyid(m.roleid) <> 'zell_inventory_definer' and pg_catalog.pg_get_userbyid(m.member) <> 'zell_inventory_definer'))) = pg_catalog.current_setting('zell.t23_fp')
      and (select pg_catalog.count(*) from public.products) || ',' || (select pg_catalog.count(*) from public.product_images) || ',' || (select pg_catalog.count(*) from public.product_widths)
      || ',' || (select pg_catalog.count(*) from public.product_addons) || ',' || (select pg_catalog.count(*) from public.product_collections) || ',' || (select pg_catalog.count(*) from public.collections)
      || ',' || (select pg_catalog.count(*) from public.orders) || ',' || (select pg_catalog.count(*) from public.order_items) || ',' || (select pg_catalog.count(*) from public.order_events)
      || ',' || (select pg_catalog.count(*) from public.order_payments) || ',' || (select pg_catalog.count(*) from public.storage_orphans)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.key || '=' || s.value::text, ',' order by s.key), '')) from public.settings s)
      || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, ',' order by a.user_id), '')) from public.admin_users a) = pg_catalog.current_setting('zell.t23_rows'), null);
  perform pg_temp.zt('T04 impact fields 1-10 unchanged', ((select pg_catalog.count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('paid_piastres','confirmation_fee_piastres'))
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%')
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('order_payments','zell_payment_methods','zell_payment_settings','zell_payment_config_log','zell_payment_commands'))
   || '|' || (select coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order')
   || '|' || (select coalesce(pg_catalog.string_agg(pg_catalog.pg_get_userbyid(p.proowner), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order')
   || '|' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_apply_transition(public.orders, text, uuid, text)')), '')
   || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%')
   || '|' || (select pg_catalog.count(*) from public.erp_capabilities)
   || '|' || (select pg_catalog.count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today')
   || '|' || (select pg_catalog.count(*) from public.erp_user_grants)) = pg_catalog.current_setting('zt.impact10'), pg_catalog.current_setting('zt.impact10'));
  perform pg_temp.zt('T05 no function in public references an inventory table', not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\m(inventory_locations|suppliers|purchase_docs|purchase_doc_lines|purchase_doc_charges|opening_stock_docs|opening_stock_lines|stock_lots|inventory_commands|inventory_audit_log)\M'), null);
end
$zT$;

select 0 as ord, 'summary'::text as kind, null::text as id, null::text as name, null::text as outcome, null::text as detail,
       case when (select pg_catalog.count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select pg_catalog.count(*) from pg_temp.zt_results) = 5 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null from pg_temp.zt_results r
order by 1;

rollback;
