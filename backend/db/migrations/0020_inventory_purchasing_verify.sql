-- 0020 — التحقق بعد التطبيق (post-apply verification) لـ 0020_inventory_purchasing.sql
--
-- • من غير أي DDL، ومن غير إعادة الـmigration.
-- • الجزء A (افتراضي، المقترح لـProduction): قراءة catalog بس — الصلاحيات المباشرة والفعلية، الدوال، الدور وشكل العضوية،
--   الـtriggers، الـFKs، اعتمادية قفل العروض (§2.6)، و MAIN. والبصمة الحالية بتطلع في رسالة النتيجة.
-- • الجزء B (اختياري، محتاج موافقة لوحده): سيناريو قصير جوه معاملة بترجع، كـ service_role. الـsequences الحقيقية
--   بتتقدم (فجوات في PUR- / B-)، وفيه WAL قليل. بيتشغّل بس لو zell.verify_part_b = 'on'.
-- • النتيجة بترجع في رسالة ZELL_0020_VERIFY_RESULT، والمعاملة بترجع دايمًا.
-- • 0020-S (0020s_inv_session.sql): صالح قبله وبعده. العدد بيتحسب للـ 43 الأصلية لوحدها، وإضافات 0020-S لازم 0 أو 24 بالظبط،
--   ولو متطبّق الرسالة بتخلص بـ « 0020s=applied». من غيره السلوك والرسالة زي النسخة القديمة بالحرف (CI 0020-S S17).
-- • 0020-S PR-3 (0020s_pr3_revoke_service_role.sql): لو متطبّق (0020-S موجود ومفيش ولا دالة قديمة لـ service_role)، الـ 23 RPC
--   بتتوقع ACL = المالك بس، والرسالة بتخلص بـ « pr3=applied»، والجزء B بيرفض (ZELL_0020_VERIFY_B_PR3) لأنه بيستخدم service_role.
-- • 0022 PRODUCT-DELETE (0022_product_delete.sql): متطبّق = الغلاف zell_inv_product_stock_ref_exists(integer) موجود. ساعتها الغلاف
--   لازم يكون بشكله بالظبط (مالكه الدور · definer · stable · search_path فاضي · EXECUTE للدور و zell_catalog_definer بس)،
--   و zell_inv_product_has_stock_refs بـ ACL = postgres + الدور بالظبط، والرسالة بتخلص بـ « 0022=applied». من غيره المنحة دي
--   ممنوعة والسلوك والرسالة زي القديم بالحرف. أي خليط (منحة من غير غلاف أو العكس) = FAIL.
-- • في كل الحالات: أي دالة مالكها zell_inventory_definer باسم برّه zell_inv_* = ZELL_0020_FUNCTION_FOREIGN.

begin;
select pg_catalog.set_config('zell.verify_part_b', 'off', true);   -- 'off' | 'on'
set local statement_timeout = '50s';

do $zverify_a$
declare
  v_bad text;
  v_definer oid := 'zell_inventory_definer'::regrole;
  v_postgres oid := 'postgres'::regrole;
  v_service oid := 'service_role'::regrole;
  -- 0020-S PR-3: بيتحسب بس لو 0020-S متطبّق، ومن غيره false فالسلوك زي القديم بالحرف.
  v_pr3 boolean := exists (select 1 from pg_catalog.pg_proc p
                            where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%')
                   and not exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                                    where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                                      and p.proname not like 'zell\_inv\_session\_%' and a.grantee = 'service_role'::regrole);
  -- 0022: الغلاف موجود = متطبّق (أي خليط بيفشل في (g) و (g2)).
  v_0022 boolean := pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)') is not null;
  v_tables text[] := array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'];
  v_table_oids oid[];
  v_seqs text[];
  v_t text;
  v_priv text;
  v_role text;
  v_src text;
  v_lock integer;
  v_write integer;
  r record;
begin
  v_table_oids := array(select ('public.' || t)::regclass::oid from unnest(v_tables) t);
  

  -- (b) RLS + policy واحدة لكل جدول
  select string_agg(t, ',') into v_bad
    from unnest(v_tables) t
   where not exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || t)::regclass and c.relrowsecurity)
      or (select count(*) from pg_catalog.pg_policy p where p.polrelid = ('public.' || t)::regclass) <> 1
      or not exists (select 1 from pg_catalog.pg_policy p
                      where p.polrelid = ('public.' || t)::regclass and p.polname = 'zinv_definer_' || t
                        and p.polroles = array[v_definer] and p.polcmd = '*'
                        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
                        and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true');
  if v_bad is not null then
    raise exception 'ZELL_0020_RLS_POLICIES %', v_bad;
  end if;

  -- (c) الـACL المباشر للجداول (مستوى الجدول)
  with exp as (
    select t as tbl, p as priv from unnest(v_tables) t cross join (values ('SELECT'), ('INSERT')) v(p)
  ), act as (
    select c.relname::text as tbl, a.privilege_type::text as priv, a.grantee, c.relowner
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.oid = any (v_table_oids)
  )
  select string_agg(x, ',') into v_bad from (
    select tbl || ':' || priv || ':foreign' as x from act where grantee <> relowner and grantee <> v_definer
    union all
    select tbl || ':' || priv || ':missing' from (select tbl, priv from exp
                                                  except select tbl, priv from act where grantee = v_definer) m
    union all
    select tbl || ':' || priv || ':extra' from (select tbl, priv from act where grantee = v_definer
                                                except select tbl, priv from exp) e
  ) z;
  if v_bad is not null then
    raise exception 'ZELL_0020_TABLE_ACL %', v_bad;
  end if;
  if exists (select 1 from pg_catalog.pg_class c where c.oid = any (v_table_oids) and c.relacl is null) then
    raise exception 'ZELL_0020_TABLE_ACL_DEFAULT';
  end if;

  -- (d) الـACL المباشر للأعمدة (UPDATE للدور بس)
  with exp(tbl, col) as (values ('inventory_locations', 'name'), ('inventory_locations', 'is_active'), ('inventory_locations', 'version'), ('inventory_locations', 'updated_at'), ('inventory_locations', 'updated_by'), ('suppliers', 'name'), ('suppliers', 'name_key'), ('suppliers', 'phone'), ('suppliers', 'note'), ('suppliers', 'is_active'), ('suppliers', 'version'), ('suppliers', 'updated_at'), ('suppliers', 'updated_by'), ('purchase_docs', 'status'), ('purchase_docs', 'supplier_id'), ('purchase_docs', 'supplier_ref'), ('purchase_docs', 'location_id'), ('purchase_docs', 'doc_date'), ('purchase_docs', 'note'), ('purchase_docs', 'draft_payload'), ('purchase_docs', 'supplier_discount_piastres'), ('purchase_docs', 'items_subtotal_piastres'), ('purchase_docs', 'extras_total_piastres'), ('purchase_docs', 'total_cost_piastres'), ('purchase_docs', 'line_count'), ('purchase_docs', 'charge_count'), ('purchase_docs', 'lot_count'), ('purchase_docs', 'supplier_name_snapshot'), ('purchase_docs', 'location_name_snapshot'), ('purchase_docs', 'posted_at'), ('purchase_docs', 'posted_by'), ('purchase_docs', 'voided_at'), ('purchase_docs', 'voided_by'), ('purchase_docs', 'void_reason'), ('purchase_docs', 'discarded_at'), ('purchase_docs', 'discarded_by'), ('purchase_docs', 'discard_reason'), ('purchase_docs', 'version'), ('purchase_docs', 'updated_at'), ('purchase_docs', 'updated_by'), ('opening_stock_docs', 'status'), ('opening_stock_docs', 'location_id'), ('opening_stock_docs', 'as_of_date'), ('opening_stock_docs', 'note'), ('opening_stock_docs', 'draft_payload'), ('opening_stock_docs', 'items_total_piastres'), ('opening_stock_docs', 'estimated_total_piastres'), ('opening_stock_docs', 'line_count'), ('opening_stock_docs', 'lot_count'), ('opening_stock_docs', 'location_name_snapshot'), ('opening_stock_docs', 'posted_at'), ('opening_stock_docs', 'posted_by'), ('opening_stock_docs', 'voided_at'), ('opening_stock_docs', 'voided_by'), ('opening_stock_docs', 'void_reason'), ('opening_stock_docs', 'discarded_at'), ('opening_stock_docs', 'discarded_by'), ('opening_stock_docs', 'discard_reason'), ('opening_stock_docs', 'version'), ('opening_stock_docs', 'updated_at'), ('opening_stock_docs', 'updated_by'), ('stock_lots', 'status'), ('stock_lots', 'voided_at'), ('stock_lots', 'voided_by')),
  act as (
    select c.relname::text as tbl, a.attname::text as col, x.privilege_type::text as priv, x.grantee
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      cross join lateral pg_catalog.aclexplode(a.attacl) x
     where c.oid = any (v_table_oids) and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  )
  select string_agg(x, ',') into v_bad from (
    select tbl || '.' || col || ':' || priv || ':foreign' as x from act where not (grantee = v_definer and priv = 'UPDATE')
    union all
    select tbl || '.' || col || ':missing' from (select tbl, col from exp
                                                 except select tbl, col from act where grantee = v_definer and priv = 'UPDATE') m
    union all
    select tbl || '.' || col || ':extra' from (select tbl, col from act where grantee = v_definer and priv = 'UPDATE'
                                               except select tbl, col from exp) e
  ) z;
  if v_bad is not null then
    raise exception 'ZELL_0020_COLUMN_ACL %', v_bad;
  end if;

  -- (e) الصلاحيات الفعلية على الجداول
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_t in array v_tables loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if pg_catalog.has_table_privilege(v_role, 'public.' || v_t, v_priv) then
          raise exception 'ZELL_0020_EFFECTIVE_TABLE % % %', v_role, v_t, v_priv;
        end if;
      end loop;
      if pg_catalog.has_any_column_privilege(v_role, 'public.' || v_t, 'SELECT, INSERT, UPDATE, REFERENCES') then
        raise exception 'ZELL_0020_EFFECTIVE_COLUMNS % %', v_role, v_t;
      end if;
    end loop;
  end loop;
  foreach v_t in array v_tables loop
    if not pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'SELECT')
       or not pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'INSERT')
       or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'DELETE')
       or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'TRUNCATE') then
      raise exception 'ZELL_0020_EFFECTIVE_DEFINER %', v_t;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('zell_inventory_definer', 'public.products', 'SELECT')
     or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.admin_users', 'SELECT') then
    raise exception 'ZELL_0020_DEFINER_READS_LIVE_TABLES';
  end if;

  -- (f) الـsequences: مباشر + فعلي
  v_seqs := array['public.purchase_doc_no_seq', 'public.opening_doc_no_seq', 'public.roll_lot_seq', 'public.batch_lot_seq']
            || array(select pg_catalog.pg_get_serial_sequence('public.' || t, 'id')
                       from unnest(array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_audit_log']) t);
  if array_position(v_seqs, null) is not null then
    raise exception 'ZELL_0020_SEQUENCE_MISSING';
  end if;
  foreach v_t in array v_seqs loop
    select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',') into v_bad
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.oid = v_t::regclass and a.grantee <> c.relowner
       and not (a.grantee = v_definer and a.privilege_type = 'USAGE');
    if v_bad is not null or (select c.relacl from pg_catalog.pg_class c where c.oid = v_t::regclass) is null
       or not pg_catalog.has_sequence_privilege('zell_inventory_definer', v_t, 'USAGE') then
      raise exception 'ZELL_0020_SEQUENCE_ACL % %', v_t, coalesce(v_bad, '');
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_sequence_privilege(v_role, v_t, 'USAGE')
         or pg_catalog.has_sequence_privilege(v_role, v_t, 'SELECT')
         or pg_catalog.has_sequence_privilege(v_role, v_t, 'UPDATE') then
        raise exception 'ZELL_0020_EFFECTIVE_SEQUENCE % %', v_role, v_t;
      end if;
    end loop;
  end loop;

  -- (g) الدوال: العدد، المالك، الأمان، التقلب، search_path، والـACL المباشر والفعلي
  -- 0020-S بيضيف 23 zell_inv_session_* + zell_inv_claims_actor: الـ 43 الأصلية لازم تفضل 43، والإضافات 0 أو 24 بالظبط.
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
         and p.proname not like 'zell\_inv\_session\_%' and p.proname <> 'zell_inv_claims_actor'
         and p.proname <> 'zell_inv_product_stock_ref_exists') <> 43
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_inv_product_stock_ref_exists')
        <> (case when v_0022 then 1 else 0 end)
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and (p.proname like 'zell\_inv\_session\_%' or p.proname = 'zell_inv_claims_actor')) not in (0, 24) then
    raise exception 'ZELL_0020_FUNCTION_COUNT';
  end if;
  for r in
    select e.sig, e.owner, e.secdef, e.vol, e.cat, pg_catalog.to_regprocedure(e.sig) as oid
      from (values
      ('public.zell_inv_create_location(uuid, uuid, text, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_supplier(uuid, uuid, text, text, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_purchase(uuid, uuid, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_post_purchase(uuid, uuid, bigint, integer)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_opening(uuid, uuid, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_post_opening(uuid, uuid, bigint, integer)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_list_locations(uuid, boolean, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_suppliers(uuid, boolean, integer, text)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_get_purchase(uuid, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_preview_purchase(uuid, jsonb)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_openings(uuid, text, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_get_opening(uuid, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_preview_opening(uuid, jsonb)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_assert_owner(uuid)', 'postgres', true, 's', 'pg_helper'),
      ('public.zell_inv_lock_products(integer[])', 'postgres', true, 'v', 'pg_helper'),
      ('public.zell_inv_read_products(integer[])', 'postgres', true, 's', 'pg_helper'),
      ('public.zell_inv_product_has_stock_refs(integer)', 'postgres', false, 's', 'pg_private'),
      ('public.zell_inv_width_allowed(integer, integer[], integer)', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_allocate_lr(bigint, bigint[])', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_normalize_purchase(jsonb)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_normalize_opening(jsonb)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_command_check(uuid, uuid, text, text)', 'definer', false, 'v', 'def_helper'),
      ('public.zell_inv_doc_void_blockers(text, bigint)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_unknown_lot_references()', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_void_contract_version()', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_trg_no_delete()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_no_truncate()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_doc_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_child_insert_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_append_only()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_lot_update_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_master_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_products_sale_unit()', 'postgres', true, 'v', 'trigger')
      ) as e(sig, owner, secdef, vol, cat)
  loop
    if r.oid is null then
      raise exception 'ZELL_0020_FUNCTION_MISSING %', r.sig;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
       where p.oid = r.oid
         and p.proowner = case r.owner when 'definer' then v_definer else v_postgres end
         and p.prosecdef = r.secdef
         and p.provolatile = r.vol::"char"
         and 'search_path=""' = any (coalesce(p.proconfig, '{}'::text[]))
         and p.proacl is not null) then
      raise exception 'ZELL_0020_FUNCTION_SHAPE %', r.sig;
    end if;
    if (select array_agg(distinct a.grantee order by a.grantee)
          from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
         where p.oid = r.oid)
       is distinct from
       (select array_agg(g order by g) from unnest(case r.cat
          when 'rpc' then case when v_pr3 then array[v_definer] else array[v_definer, v_service] end
          when 'pg_helper' then array[v_postgres, v_definer]
          when 'def_helper' then array[v_definer]
          when 'pg_private' then case when v_0022 then array[v_postgres, v_definer] else array[v_postgres] end
          else array[v_postgres] end) g) then
      raise exception 'ZELL_0020_FUNCTION_ACL %', r.sig;
    end if;
    if exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                where p.oid = r.oid and a.privilege_type <> 'EXECUTE') then
      raise exception 'ZELL_0020_FUNCTION_ACL_PRIV %', r.sig;
    end if;
    if pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE') <> (r.cat = 'rpc' and not v_pr3) then
      raise exception 'ZELL_0020_FUNCTION_EFFECTIVE %', r.sig;
    end if;
  end loop;

  -- (g2) 0022: شكل الغلاف بالظبط. وفي كل الحالات مفيش دالة للدور باسم برّه zell_inv_*.
  if v_0022 and not exists (
       select 1 from pg_catalog.pg_proc p
        where p.oid = pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)')
          and pg_catalog.to_regrole('zell_catalog_definer') is not null
          and p.proowner = v_definer and p.prosecdef and p.provolatile = 's'
          and p.proconfig = array['search_path=""']
          and (select array_agg(distinct a.grantee order by a.grantee) from pg_catalog.aclexplode(p.proacl) a)
              = (select array_agg(g order by g) from unnest(array[v_definer, pg_catalog.to_regrole('zell_catalog_definer')::oid]) g)
          and not exists (select 1 from pg_catalog.aclexplode(p.proacl) a where a.privilege_type <> 'EXECUTE' or a.is_grantable)
          and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception 'ZELL_0020_0022_WRAPPER_SHAPE';
  end if;
  select string_agg(p.oid::regprocedure::text, ',') into v_bad
    from pg_catalog.pg_proc p where p.proowner = v_definer and p.proname not like 'zell\_inv\_%';
  if v_bad is not null then
    raise exception 'ZELL_0020_FUNCTION_FOREIGN %', v_bad;
  end if;

  -- (h) الـschema: الدور معاه USAGE، والـCREATE **الفعلي** false
  if pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE')
     or not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'USAGE') then
    raise exception 'ZELL_0020_SCHEMA_PRIVILEGES';
  end if;

  -- (i) الدور وشكل العضوية
  if not exists (select 1 from pg_catalog.pg_roles r2
                  where r2.oid = v_definer and not r2.rolcanlogin and not r2.rolbypassrls and not r2.rolinherit
                    and not r2.rolsuper and not r2.rolcreaterole and not r2.rolcreatedb and not r2.rolreplication)
     or exists (select 1 from pg_catalog.pg_auth_members m where m.member = v_definer)
     or exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = v_definer and m.member = v_postgres and m.inherit_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = v_definer and m.member = v_postgres and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = v_definer and m.member = v_postgres and m.set_option)
     or exists (select 1 from pg_catalog.pg_auth_members m where m.roleid = v_definer and m.member <> v_postgres) then
    raise exception 'ZELL_0020_ROLE_SHAPE';
  end if;

  -- (j) الـtriggers (34 على الجداول الجديدة + واحد على products)
  with exp(tbl, tg, fn, typ) as (values ('inventory_locations', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('suppliers', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_docs', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_doc_lines', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_doc_charges', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('opening_stock_docs', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('opening_stock_lines', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('stock_lots', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_commands', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_audit_log', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_locations', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('suppliers', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_docs', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_doc_lines', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_doc_charges', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('opening_stock_docs', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('opening_stock_lines', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('stock_lots', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('inventory_commands', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('inventory_audit_log', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_docs', 'zinv_doc_guard', 'zell_inv_trg_doc_guard', 19), ('opening_stock_docs', 'zinv_doc_guard', 'zell_inv_trg_doc_guard', 19), ('purchase_doc_lines', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('purchase_doc_charges', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('opening_stock_lines', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('stock_lots', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('purchase_doc_lines', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('purchase_doc_charges', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('opening_stock_lines', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('inventory_commands', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('inventory_audit_log', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('stock_lots', 'zinv_lot_update_guard', 'zell_inv_trg_lot_update_guard', 19), ('inventory_locations', 'zinv_master_guard', 'zell_inv_trg_master_guard', 19), ('suppliers', 'zinv_master_guard', 'zell_inv_trg_master_guard', 19))
  select string_agg(e.tbl || '.' || e.tg, ',') into v_bad
    from exp e
   where not exists (select 1 from pg_catalog.pg_trigger g join pg_catalog.pg_proc f on f.oid = g.tgfoid
                      where g.tgrelid = ('public.' || e.tbl)::regclass and g.tgname = e.tg
                        and f.proname = e.fn and f.pronamespace = 'public'::regnamespace
                        and g.tgtype = e.typ and g.tgenabled = 'O');
  if v_bad is not null then
    raise exception 'ZELL_0020_TRIGGERS %', v_bad;
  end if;
  if (select count(*) from pg_catalog.pg_trigger g where g.tgrelid = any (v_table_oids) and not g.tgisinternal) <> 34 then
    raise exception 'ZELL_0020_TRIGGER_COUNT';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger g join pg_catalog.pg_proc f on f.oid = g.tgfoid
                  where g.tgrelid = 'public.products'::regclass and g.tgname = 'zinv_products_sale_unit'
                    and f.proname = 'zell_inv_trg_products_sale_unit' and g.tgtype = 19 and g.tgenabled = 'O'
                    and g.tgqual is not null
                    and (select array_agg(u.k) from unnest(g.tgattr::int2[]) as u(k)) = array[(select a.attnum from pg_catalog.pg_attribute a
                                                   where a.attrelid = 'public.products'::regclass
                                                     and a.attname = 'sale_unit')]::int2[]) then
    raise exception 'ZELL_0020_PRODUCTS_TRIGGER';
  end if;

  -- (k) FKs على products
  if (select count(*) from pg_catalog.pg_constraint c
       where c.contype = 'f' and c.confrelid = 'public.products'::regclass
         and c.conname in ('purchase_doc_lines_product_fk', 'opening_stock_lines_product_fk', 'stock_lots_product_fk')
         and c.confdeltype = 'r') <> 3 then
    raise exception 'ZELL_0020_PRODUCT_FKS';
  end if;

  -- (l) اعتمادية قفل العروض (§2.6)
  select pg_catalog.lower(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g')) into v_src
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_set_product_widths(integer,jsonb)');
  if v_src is null then
    raise exception 'ZELL_0020_WIDTHS_FUNCTION_MISSING';
  end if;
  v_lock := pg_catalog.regexp_instr(v_src, 'from public\.products\M[^;]*for update');
  v_write := pg_catalog.regexp_instr(v_src, '(delete from|update|insert into) public\.product_widths');
  if v_lock = 0 or v_write = 0 or v_lock > v_write then
    raise exception 'ZELL_0020_WIDTHS_LOCK_CONTRACT_MISSING';
  end if;
  
  -- (m) MAIN موجود وافتراضي وشغّال
  if not exists (select 1 from public.inventory_locations l where l.code = 'MAIN' and l.is_default and l.is_active) then
    raise exception 'ZELL_0020_MAIN_MISSING';
  end if;
end
$zverify_a$;

do $zverify_b$
declare
  v_owner uuid;
  v_pc integer;
  v_main bigint;
  v_r jsonb;
  v_id bigint;
begin
  if pg_catalog.current_setting('zell.verify_part_b') <> 'on' then
    return;
  end if;
  -- 0020-S PR-3: الجزء B بيستخدم service_role، والـ 23 بقت داخلية. التحقق بعد PR-3 من 0020s_inv_session_verify.sql.
  if exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%')
     and not pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.zell_inv_create_purchase(uuid, uuid, jsonb)'), 'EXECUTE') then
    raise exception 'ZELL_0020_VERIFY_B_PR3';
  end if;
  select u.user_id into v_owner from public.admin_users u where u.role = 'owner' and u.is_active order by u.created_at limit 1;
  select p.id into v_pc from public.products p where p.sale_unit = 'piece' order by p.id limit 1;
  select l.id into v_main from public.inventory_locations l where l.code = 'MAIN';
  if v_owner is null or v_pc is null or v_main is null then
    raise exception 'ZELL_0020_VERIFY_B_FIXTURE_MISSING';
  end if;
  set local role service_role;
  v_r := public.zell_inv_create_purchase(v_owner, gen_random_uuid(), jsonb_build_object(
           'locationId', v_main, 'docDate', to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD'),
           'lines', jsonb_build_array(jsonb_build_object('kind', 'batch', 'productId', v_pc, 'quantity', 1, 'lineTotalPiastres', 100))));
  v_id := (v_r ->> 'docId')::bigint;
  v_r := public.zell_inv_post_purchase(v_owner, gen_random_uuid(), v_id, 1);
  if v_r ->> 'status' <> 'posted' or jsonb_array_length(v_r -> 'lots') <> 1 then
    raise exception 'ZELL_0020_VERIFY_B_POST';
  end if;
  v_r := public.zell_inv_void_purchase(v_owner, gen_random_uuid(), v_id, 2, 'تحقق بعد التطبيق');
  if v_r ->> 'status' <> 'voided' then
    raise exception 'ZELL_0020_VERIFY_B_VOID';
  end if;
  reset role;
end
$zverify_b$;

do $zverify_end$
declare
  v_fp text;
begin
  select md5(row(n.*)::text) into v_fp from (select
  (select count(*) from public.orders) as orders_n,
  (select count(*) from public.order_items) as order_items_n,
  (select count(*) from public.products) as products_n,
  (select count(*) from public.product_widths) as product_widths_n,
  (select count(*) from public.product_addons) as product_addons_n,
  (select count(*) from public.coupons) as coupons_n,
  (select count(*) from public.settings) as settings_n,
  (select count(*) from public.admin_users) as admin_users_n,
  (select coalesce(sum(o.total_piastres), 0) from public.orders o) as orders_total,
  (select md5(coalesce(string_agg(p.id || ':' || p.sale_unit || ':' || p.price_per_meter_piastres || ':' || p.width_cm, ',' order by p.id), ''))
     from public.products p) as products_md5,
  (select md5(coalesce(string_agg(s.key || '=' || s.value::text, ',' order by s.key), ''))
     from public.settings s) as settings_md5,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text), ''))
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('zell_create_order', 'zell_get_order_receipt', 'zell_preview_coupon',
                        'zell_set_product_widths', 'zell_set_product_addons', 'zell_orders_cancelled_final')) as functions_md5) n;
  -- 0020-S متطبّق: علامة في آخر الرسالة (من غيره الرسالة زي ما هي بالحرف).
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') then
    v_fp := v_fp || ' 0020s=applied';
    if not exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                      and p.proname not like 'zell\_inv\_session\_%' and a.grantee = 'service_role'::regrole) then
      v_fp := v_fp || ' pr3=applied';
    end if;
  end if;
  -- 0022 متطبّق: علامة في آخر الرسالة (من غيره الرسالة زي ما هي بالحرف).
  if pg_catalog.to_regprocedure('public.zell_inv_product_stock_ref_exists(integer)') is not null then
    v_fp := v_fp || ' 0022=applied';
  end if;
  raise exception 'ZELL_0020_VERIFY_RESULT part_a=ok part_b=% fingerprint_md5=%',
    pg_catalog.current_setting('zell.verify_part_b'), v_fp;
end
$zverify_end$;
rollback;
