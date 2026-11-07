-- 0026 IMAGE-DELETE — التحقق بعد التطبيق (قراية كتالوج بس) لـ 0026_image_delete.sql
--
-- • معاملة واحدة read only: begin ... SELECT واحد ... rollback. قبل التطبيق النتيجة FAIL (الدوال مش موجودة).
-- • الصف 0 = الحكم (PASS/FAIL) وعدد النجاح والفشل، وبعده صف لكل فحص.
-- • المتوقع بعد التطبيق: PASS بـ 9 نجاح و 0 فشل.

begin;
set transaction read only;

with f as (
  select pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') as del,
         pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()') as trg,
         (select a.attnum from pg_catalog.pg_attribute a
           where a.attrelid = 'public.products'::regclass and a.attname = 'is_active') as att
), c(n, id, ok, detail) as (
  select 1, 'V01', coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef
                               and p.proconfig = array['search_path=""', 'lock_timeout=3s']
                              from pg_catalog.pg_proc p, f where p.oid = f.del), false),
         'zell_product_image_delete: owner zell_catalog_definer, security definer, search_path empty, lock_timeout 3s'
  union all
  select 2, 'V02', coalesce((select pg_catalog.pg_get_userbyid(p.proowner) = 'zell_catalog_definer' and p.prosecdef
                               and p.proconfig = array['search_path=""']
                              from pg_catalog.pg_proc p, f where p.oid = f.trg), false),
         'zell_catalog_trg_products_activation_guard: owner zell_catalog_definer, security definer, search_path empty'
  union all
  select 3, 'V03', (select pg_catalog.string_agg(f.n || '=' || case when p.oid is null then '-' when p.proacl is null then 'DEFAULT'
                     else coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                      from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s from pg_catalog.aclexplode(p.proacl) x where x.grantee <> p.proowner) e), '') end,
                 ' | ' order by f.n collate "C")
               from (values ('delete'::text, pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)')::oid),
                            ('trigger'::text, pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()')::oid)) f(n, o)
               left join pg_catalog.pg_proc p on p.oid = f.o) = 'delete=authenticated/EXECUTE | trigger=',
         'EXECUTE exact on both functions (every grantee except the owner): authenticated on the delete function only, nobody on the trigger function, no grant option'
  union all
  select 4, 'V04', coalesce((select exists (select 1 from pg_catalog.pg_trigger t
                               where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'
                                 and t.tgenabled = 'O' and t.tgfoid = f.trg and t.tgtype = 23
                                 and t.tgattr::text = f.att::text) from f), false),
         'trigger zell_catalog_products_activation_guard: before insert or update of is_active, for each row, enabled'
  union all
  select 5, 'V05', (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
                   || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
                 ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
               from pg_catalog.pg_policies p
              where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
                and p.roles && array['zell_catalog_definer', 'public']::name[]) = 'product_images.zell_catalog_definer_image_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | product_images.zell_catalog_definer_image_promote:UPDATE:PERMISSIVE:zell_catalog_definer:true:(is_primary AND (fit = ''cover''::text) AND (kind = ''gallery''::text)) | product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_insert_removed:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''removed''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-',
         'policies of zell_catalog_definer (and PUBLIC) on product_images / products / storage_orphans = expected text exactly'
  union all
  select 6, 'V06', (select pg_catalog.string_agg(t.n
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
                            ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o)) = 'product_images:REL=zell_catalog_definer/DELETE;COL=bucket:zell_catalog_definer/SELECT,fit:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/UPDATE,kind:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/SELECT,sort_order:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | products:REL=zell_catalog_definer/DELETE;COL=id:zell_catalog_definer/SELECT,is_active:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | storage_orphans:REL=;COL=bucket:zell_catalog_definer/INSERT,bucket:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/INSERT,object_path:zell_catalog_definer/SELECT,reason:zell_catalog_definer/INSERT',
         'ACL entries of zell_catalog_definer and PUBLIC on product_images / products / storage_orphans and their columns = expected exactly (every privilege type, grant options)'
  union all
  select 7, 'V07', (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
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
               from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer') = 'super=false inherit=false createrole=false createdb=false login=false replication=false bypassrls=false memberof= members=postgres:inherit=false,set=true schema_usage=true schema_create=false',
         'zell_catalog_definer attributes, memberships and schema public privileges = 0022 baseline (no CREATE)'
  union all
  select 8, 'V08', (select pg_catalog.pg_get_constraintdef(k.oid) from pg_catalog.pg_constraint k
                     where k.conrelid = 'public.storage_orphans'::regclass and k.conname = 'storage_orphans_reason_check')
                   = 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))',
         'storage_orphans_reason_check unchanged'
  union all
  select 9, 'V09', (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.prosrc ~ '4570[1-5]') = 2,
         'codes 45701..45705 used by the two new functions only'
)
select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where not coalesce(c.ok, false)) = 0 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where coalesce(c.ok, false)) || ' fail=' || pg_catalog.count(*) filter (where not coalesce(c.ok, false)) as detail
          from c
        union all
        select c.n, c.id, case when coalesce(c.ok, false) then 'pass' else 'fail' end, c.detail from c) s
 order by s.n;
rollback;
