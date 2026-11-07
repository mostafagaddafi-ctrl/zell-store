-- 0026 IMAGE-DELETE — استعلام الأثر (قبل التطبيق وبعده، نفس الملف بالحرف). قراية بس.
--
-- • معاملة read only: begin ... SELECT واحد ... rollback. صف واحد بـ 16 عمود:
--   1 applied (دالة الحذف|الـ trigger) · 2 عدد صور المنتجات · 3 عدد الرئيسيات · 4 المنتجات الظاهرة ·
--   5 المنتجات الظاهرة من غير رئيسية من المعرض · 6 سجلات storage_orphans لكل سبب · 7 السجلات المستنية تنظيف ·
--   8 بصمة product_images · 9 بصمة storage_orphans · 10 بصمة ظهور المنتجات ·
--   11 كل إدخالات ACL للدور ولـ PUBLIC على الجداول التلاتة وأعمدتها (كل الأنواع + grant options) ·
--   12 كل policies الجداول التلاتة اللي بتنطبق على الدور (أو PUBLIC) بالنص الكامل · 13 idle_tx (NULL لو الجلسات مش ظاهرة) ·
--   14 الجلسات ظاهرة · 15 ACL الدالتين (كل grantee غير المالك؛ '-' لو مش موجودة) · 16 صفات الدور وعضوياته وUSAGE/CREATE على public.
-- • قبل التطبيق وبعده: الأعمدة 2–10 لازم تبقى زي ما هي (التطبيق مابيغيّرش بيانات).

begin;
set transaction read only;

select
  (pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null)::text || '|'
    || (exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'))::text as applied,
  (select pg_catalog.count(*) from public.product_images) as images,
  (select pg_catalog.count(*) from public.product_images where is_primary) as primaries,
  (select pg_catalog.count(*) from public.products where is_active) as products_active,
  (select pg_catalog.count(*) from public.products p
    where p.is_active
      and not exists (select 1 from public.product_images i
                       where i.product_id = p.id and i.kind = 'gallery' and i.is_primary)) as active_without_primary,
  coalesce((select pg_catalog.string_agg(x.reason || '=' || x.n, ',' order by x.reason)
              from (select o.reason, pg_catalog.count(*) as n from public.storage_orphans o group by o.reason) x), '') as orphans_by_reason,
  (select pg_catalog.count(*) from public.storage_orphans where cleaned_at is null) as orphans_pending,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.product_images t) as fp_images,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t) as fp_orphans,
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t.id::text || ':' || t.is_active::text, ',' order by t.id), '')) from public.products t) as fp_visibility,
  (select pg_catalog.string_agg(t.n
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
                    ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o)) as definer_acl,
  coalesce((select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
           || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
         ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
       from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
        and p.roles && array['zell_catalog_definer', 'public']::name[]), '') as definer_policies,
  case when not exists (select 1 from pg_catalog.pg_stat_activity a
                         where a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid() and a.state is null)
       then (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a
              where a.pid <> pg_catalog.pg_backend_pid() and a.state like 'idle in transaction%')
  end as idle_tx,
  not exists (select 1 from pg_catalog.pg_stat_activity a
               where a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid() and a.state is null) as sessions_visible,
  (select pg_catalog.string_agg(f.n || '=' || case when p.oid is null then '-' when p.proacl is null then 'DEFAULT'
             else coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                              from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s from pg_catalog.aclexplode(p.proacl) x where x.grantee <> p.proowner) e), '') end,
         ' | ' order by f.n collate "C")
       from (values ('delete'::text, pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)')::oid),
                    ('trigger'::text, pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()')::oid)) f(n, o)
       left join pg_catalog.pg_proc p on p.oid = f.o) as function_acl,
  (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
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
       from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer') as definer_role;
rollback;
