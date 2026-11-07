-- 0026 IMAGE-DELETE — الرجوع (موافقة جديدة صريحة بس؛ وجود الملف مش تصريح)
--
-- • بيشيل الـ trigger والدالتين والـ policies التلاتة والمنح الزيادة على product_images، وبيرجّع UPDATE (product_id) بالظبط (العقد §٤).
-- • قبل الرجوع: الحالة لازم تطابق بعد 0026 بالنص (ACL الجداول والدالتين، صفات الدور والسكيما، الـ policies)، وإلا
--   ZELL_0026_RB_STATE_DRIFT من غير أي تغيير. بعده: ACL الجداول وصفات الدور والـ policies لازم تطابق خط أساس 0022 بالنص.
-- • مابيلمسش سجلات storage_orphans (السبب removed موجود قبل 0026 من 0012، ومستخدم لأغلفة الأقسام).
-- • الصور اللي اتحذفت قبل الرجوع مابترجعش: الرجوع للدالة، مش للبيانات. بعده حارس التفعيل فحص تطبيق بس زي قبل 0026.
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0026-rollback';

begin;
-- >>> 0026 ROLLBACK
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $rbpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_g text;
  v_p text;
  v_r text;
  v_f text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0026_RB_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0026_RB_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is null
     or pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard') then
    raise exception 'ZELL_0026_RB_NOT_APPLIED';
  end if;
  v_g := (select pg_catalog.string_agg(t.n
         || ':REL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                                          where c.oid = t.o and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), '')
         || ';COL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select a.attname::text || ':' || case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
                                          where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped
                                            and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), ''),
       ' | ' order by t.n collate "C")
     from (values ('product_images'::text, 'public.product_images'::regclass::oid),
                  ('products'::text, 'public.products'::regclass::oid),
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  v_r := (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
         || ' createdb=' || r.rolcreatedb::text || ' login=' || r.rolcanlogin::text || ' replication=' || r.rolreplication::text
         || ' bypassrls=' || r.rolbypassrls::text
         || ' memberof=' || coalesce((select pg_catalog.string_agg(g.rolname::text, ',' order by g.rolname::text collate "C")
                                        from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid = m.roleid
                                       where m.member = r.oid), '')
         || ' members=' || coalesce((select pg_catalog.string_agg(y.s, ';' order by y.s collate "C")
                                       from (select mm.rolname::text || ':inherit=' || pg_catalog.bool_or(m.inherit_option)::text
                                                    || ',set=' || pg_catalog.bool_or(m.set_option)::text as s
                                               from pg_catalog.pg_auth_members m join pg_catalog.pg_roles mm on mm.oid = m.member
                                              where m.roleid = r.oid group by mm.rolname) y), '')
         || ' schema_usage=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')::text
         || ' schema_create=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')::text
     from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer');
  v_f := (select pg_catalog.string_agg(f.n || '=' || case when p.oid is null then '-' when p.proacl is null then 'DEFAULT'
           else coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                            from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s from pg_catalog.aclexplode(p.proacl) x where x.grantee <> p.proowner) e), '') end,
       ' | ' order by f.n collate "C")
     from (values ('delete'::text, pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)')::oid),
                  ('trigger'::text, pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()')::oid)) f(n, o)
     left join pg_catalog.pg_proc p on p.oid = f.o);
  v_p := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
  if v_g is distinct from 'product_images:REL=zell_catalog_definer/DELETE;COL=bucket:zell_catalog_definer/SELECT,fit:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/UPDATE,kind:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/SELECT,sort_order:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | products:REL=zell_catalog_definer/DELETE;COL=id:zell_catalog_definer/SELECT,is_active:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | storage_orphans:REL=;COL=bucket:zell_catalog_definer/INSERT,bucket:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/INSERT,object_path:zell_catalog_definer/SELECT,reason:zell_catalog_definer/INSERT' or v_r is distinct from 'super=false inherit=false createrole=false createdb=false login=false replication=false bypassrls=false memberof= members=postgres:inherit=false,set=true schema_usage=true schema_create=false' or v_f is distinct from 'delete=authenticated/EXECUTE | trigger='
     or v_p is distinct from 'product_images.zell_catalog_definer_image_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | product_images.zell_catalog_definer_image_promote:UPDATE:PERMISSIVE:zell_catalog_definer:true:(is_primary AND (fit = ''cover''::text) AND (kind = ''gallery''::text)) | product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_insert_removed:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''removed''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    raise exception 'ZELL_0026_RB_STATE_DRIFT' using detail = 'acl: ' || coalesce(v_g, '(null)') || ' || role: ' || coalesce(v_r, '(null)')
      || ' || function_acl: ' || coalesce(v_f, '(null)') || ' || policies: ' || coalesce(v_p, '(null)');
  end if;
end
$rbpre$;

drop trigger zell_catalog_products_activation_guard on public.products;
set local role zell_catalog_definer;
drop function public.zell_product_image_delete(integer, bigint);
drop function public.zell_catalog_trg_products_activation_guard();
reset role;
drop policy zell_catalog_definer_image_delete on public.product_images;
drop policy zell_catalog_definer_image_promote on public.product_images;
drop policy zell_catalog_definer_insert_removed on public.storage_orphans;
revoke select (kind, is_primary, sort_order), update (is_primary, fit, updated_at), delete
  on table public.product_images from zell_catalog_definer;
grant update (product_id) on table public.product_images to zell_catalog_definer;

do $rbpost$
declare
  v_g text := (select pg_catalog.string_agg(t.n
         || ':REL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                                          where c.oid = t.o and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), '')
         || ';COL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select a.attname::text || ':' || case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
                                          where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped
                                            and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), ''),
       ' | ' order by t.n collate "C")
     from (values ('product_images'::text, 'public.product_images'::regclass::oid),
                  ('products'::text, 'public.products'::regclass::oid),
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  v_r text := (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
         || ' createdb=' || r.rolcreatedb::text || ' login=' || r.rolcanlogin::text || ' replication=' || r.rolreplication::text
         || ' bypassrls=' || r.rolbypassrls::text
         || ' memberof=' || coalesce((select pg_catalog.string_agg(g.rolname::text, ',' order by g.rolname::text collate "C")
                                        from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid = m.roleid
                                       where m.member = r.oid), '')
         || ' members=' || coalesce((select pg_catalog.string_agg(y.s, ';' order by y.s collate "C")
                                       from (select mm.rolname::text || ':inherit=' || pg_catalog.bool_or(m.inherit_option)::text
                                                    || ',set=' || pg_catalog.bool_or(m.set_option)::text as s
                                               from pg_catalog.pg_auth_members m join pg_catalog.pg_roles mm on mm.oid = m.member
                                              where m.roleid = r.oid group by mm.rolname) y), '')
         || ' schema_usage=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')::text
         || ' schema_create=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')::text
     from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer');
  v_p text := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
begin
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null
     or pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard') then
    raise exception 'ZELL_0026_RB_POST_SHAPE' using detail = 'objects_left';
  end if;
  if v_g is distinct from 'product_images:REL=;COL=bucket:zell_catalog_definer/SELECT,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/UPDATE | products:REL=zell_catalog_definer/DELETE;COL=id:zell_catalog_definer/SELECT,is_active:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | storage_orphans:REL=;COL=bucket:zell_catalog_definer/INSERT,bucket:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/INSERT,object_path:zell_catalog_definer/SELECT,reason:zell_catalog_definer/INSERT' or v_r is distinct from 'super=false inherit=false createrole=false createdb=false login=false replication=false bypassrls=false memberof= members=postgres:inherit=false,set=true schema_usage=true schema_create=false' or v_p is distinct from 'product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    raise exception 'ZELL_0026_RB_POST_SHAPE' using detail = 'acl: ' || coalesce(v_g, '(null)') || ' || role: ' || coalesce(v_r, '(null)')
      || ' || policies: ' || coalesce(v_p, '(null)');
  end if;
end
$rbpost$;
-- <<< 0026 ROLLBACK
commit;
