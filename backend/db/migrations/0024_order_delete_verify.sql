-- 0024 ORDER-DELETE — التحقق بعد التطبيق (قراية بس) لـ 0024_order_delete.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد.
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict
-- • المتوقع: PASS (10 فحوص).

begin;
set transaction read only;
set local statement_timeout = '30s';

with checks(id, name, ok, detail) as (
  select 'V01', 'role zell_purge_definer: NOLOGIN · NOBYPASSRLS · NOINHERIT · postgres member with SET (no INHERIT) · no other member · no membership of its own',
         exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'zell_purge_definer' and not r.rolcanlogin and not r.rolbypassrls and not r.rolinherit and not r.rolsuper and not r.rolcreaterole)
     and exists (select 1 from pg_catalog.pg_auth_members a where a.roleid = pg_catalog.to_regrole('zell_purge_definer') and a.member = 'postgres'::regrole and a.set_option)
     and not exists (select 1 from pg_catalog.pg_auth_members a where a.roleid = pg_catalog.to_regrole('zell_purge_definer')
                       and (a.inherit_option or a.member <> 'postgres'::regrole))
     and not exists (select 1 from pg_catalog.pg_auth_members a where a.member = pg_catalog.to_regrole('zell_purge_definer')), null::text
  union all
  select 'V02', 'functions: exactly 8 zell_purge_* with md5 · owner · security definer · config',
         (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%') = 8
     and coalesce((select pg_catalog.md5(p.prosrc) = '84d52a5f10ec855f8358a4d8e7055077' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_ids_hash(integer[])'))
     and (select pg_catalog.md5(p.prosrc) = '757e7ca173717c6496505c0b24f4a38a' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_shape_problem()'))
     and (select pg_catalog.md5(p.prosrc) = 'de9442b871ac48af4a2d844ed66bc1e1' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = false and p.proconfig = array['search_path=""', 'TimeZone=UTC'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_snapshot_hash(integer[])'))
     and (select pg_catalog.md5(p.prosrc) = '007aa2299b6733d97dd41a96303c2f7a' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true and p.proconfig = array['search_path=""', 'TimeZone=UTC'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_preview(integer[])'))
     and (select pg_catalog.md5(p.prosrc) = 'c7184a12872628261de514294251147c' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_reauth_begin(uuid)'))
     and (select pg_catalog.md5(p.prosrc) = '8a87110ffbcbc9c7d449c67b29911d70' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)'))
     and (select pg_catalog.md5(p.prosrc) = 'ed31cbfba6bed01b319d1c405e7d2d3f' and pg_catalog.pg_get_userbyid(p.proowner) = 'zell_purge_definer' and p.prosecdef = true and p.proconfig = array['search_path=""', 'TimeZone=UTC', 'lock_timeout=3s'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_orders(integer[], text, integer, uuid)'))
     and (select pg_catalog.md5(p.prosrc) = '78e8fdd2db353f13621c82c6cf545297' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and p.prosecdef = false and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_purge_trg_append_only()')), false), null
  union all
  select 'V03', 'EXECUTE: preview + orders = authenticated only · reauth begin/finish = service_role only · internal + trigger = nobody',
         (select pg_catalog.bool_and(pg_catalog.has_function_privilege(r.n, f.s, 'EXECUTE') = (r.n = f.who))
            from (values ('anon'), ('authenticated'), ('service_role')) r(n),
                 (values ('public.zell_purge_preview(integer[])', 'authenticated'), ('public.zell_purge_orders(integer[], text, integer, uuid)', 'authenticated'), ('public.zell_purge_reauth_begin(uuid)', 'service_role'), ('public.zell_purge_reauth_finish(uuid, uuid, boolean, text, text, integer)', 'service_role'),
                         ('public.zell_purge_ids_hash(integer[])', '-'), ('public.zell_purge_shape_problem()', '-'), ('public.zell_purge_snapshot_hash(integer[])', '-'), ('public.zell_purge_trg_append_only()', '-')) f(s, who)), null
  union all
  select 'V04', 'guards: exception in 3 (new md5) · events guard and zell_create_order unchanged · owner postgres, invoker',
         coalesce((select pg_catalog.md5(p.prosrc) = '002afae51685f2ac8e4e718d33035997' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = 'b3d68e747a49556e01fa2918b0206415' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_shipment_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = '0668e7dacc77a9c9a138d3647521dc8e' and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and not p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_customer_update_trg_append_only()')), false)
     and coalesce((select pg_catalog.md5(p.prosrc) = 'd629f8b5c3a0fe1573ad87dd6727cccd' from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_trg_events_immutable()')), false)
     and (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order' and pg_catalog.md5(p.prosrc) = '62924d0fe9b1563e76c54bbddfb628b4') = 1, null
  union all
  select 'V05', 'new tables: owner postgres · RLS · zero for anon/authenticated/service_role · role: log INSERT, reauth + attempts SELECT/INSERT/UPDATE only',
         (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('zell_purge_log', 'zell_purge_reauth', 'zell_purge_attempts')
             and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') = 3
     and not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n), (values ('public.zell_purge_log'), ('public.zell_purge_reauth'), ('public.zell_purge_attempts')) t(s)
                      where pg_catalog.has_table_privilege(r.n, t.s, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     and (select pg_catalog.string_agg(c.relname || ':' || x.privilege_type, ',' order by c.relname, x.privilege_type)
            from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
           where c.relnamespace = 'public'::regnamespace and c.relname in ('zell_purge_log', 'zell_purge_reauth', 'zell_purge_attempts') and x.grantee = pg_catalog.to_regrole('zell_purge_definer'))
         = 'zell_purge_attempts:INSERT,zell_purge_attempts:SELECT,zell_purge_attempts:UPDATE,zell_purge_log:INSERT,zell_purge_reauth:INSERT,zell_purge_reauth:SELECT,zell_purge_reauth:UPDATE', null
  union all
  select 'V06', 'orders + dependents: role has SELECT on 9 · DELETE on 7 (not items/events) · no table-level UPDATE · column UPDATE on exactly one column each',
         (select pg_catalog.string_agg(c.relname || ':' || x.privilege_type, ',' order by c.relname, x.privilege_type)
            from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
           where c.relnamespace = 'public'::regnamespace and c.relname in ('orders', 'order_items', 'order_events', 'order_payments', 'zell_payment_commands', 'zell_order_shipments', 'zell_order_shipments_log', 'zell_order_customer_updates', 'zell_order_customer_updates_log') and x.grantee = pg_catalog.to_regrole('zell_purge_definer'))
         = 'order_events:SELECT,order_items:SELECT,order_payments:DELETE,order_payments:SELECT,orders:DELETE,orders:SELECT,zell_order_customer_updates:DELETE,zell_order_customer_updates:SELECT,zell_order_customer_updates_log:DELETE,zell_order_customer_updates_log:SELECT,zell_order_shipments:DELETE,zell_order_shipments:SELECT,zell_order_shipments_log:DELETE,zell_order_shipments_log:SELECT,zell_payment_commands:DELETE,zell_payment_commands:SELECT'
     and (select pg_catalog.string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname)
            from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid, pg_catalog.aclexplode(a.attacl) x
           where c.relnamespace = 'public'::regnamespace and x.grantee = pg_catalog.to_regrole('zell_purge_definer') and x.privilege_type = 'UPDATE')
         = 'order_events.order_id,order_items.order_id,order_payments.order_id,orders.updated_at,zell_order_customer_updates.order_id,zell_order_customer_updates_log.order_id,zell_order_shipments.order_id,zell_order_shipments_log.order_id,zell_payment_commands.order_id', null
  union all
  select 'V07', 'policies: 32 zell_purge_* (select + lock with check (false) on 9 · delete on 7 · log insert · reauth/attempts select/insert/update)',
         (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polname like 'zell\_purge\_%') = 32
     and (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polname = 'zell_purge_lock' and po.polcmd = 'w' and pg_catalog.pg_get_expr(po.polwithcheck, po.polrelid) = 'false') = 9
     and (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polname = 'zell_purge_delete' and po.polcmd = 'd') = 7
     and (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polname = 'zell_purge_select' and po.polcmd = 'r') = 9
     and not exists (select 1 from pg_catalog.pg_policy po where po.polname like 'zell\_purge\_%'
                      and po.polroles <> array[pg_catalog.to_regrole('zell_purge_definer')::oid]), null
  union all
  select 'V08', 'zell_purge_log guards: immutable (update/delete) + no truncate, enabled',
         (select pg_catalog.count(*) from pg_catalog.pg_trigger g where g.tgrelid = 'public.zell_purge_log'::regclass and not g.tgisinternal and g.tgenabled = 'O'
             and g.tgname in ('zell_purge_log_immutable', 'zell_purge_log_no_truncate') and g.tgfoid = pg_catalog.to_regprocedure('public.zell_purge_trg_append_only()')) = 2, null
  union all
  select 'V09', 'dependents of orders (FKs, recursive) = the approved list', (select s.v from (with recursive d(child, parent, conname, deltype) as (
      select c.conrelid, c.confrelid, c.conname, c.confdeltype
        from pg_catalog.pg_constraint c where c.contype = 'f' and c.confrelid = 'public.orders'::regclass
      union
      select c.conrelid, c.confrelid, c.conname, c.confdeltype
        from pg_catalog.pg_constraint c join d on c.confrelid = d.child where c.contype = 'f'
    )
    select pg_catalog.string_agg(cc.relname::text || '>' || pc.relname::text || ':' || d.conname::text || ':' || d.deltype::text, ','
                                 order by cc.relname::text collate "C", d.conname::text collate "C") as v
      from d join pg_catalog.pg_class cc on cc.oid = d.child join pg_catalog.pg_class pc on pc.oid = d.parent) s) = 'order_events>orders:order_events_order_fkey:c,order_items>orders:order_items_order_id_fkey:c,order_payments>orders:order_payments_order_fkey:r,zell_order_customer_updates>orders:zell_order_customer_updates_order_fkey:r,zell_order_customer_updates_log>orders:zell_order_customer_updates_log_order_fkey:r,zell_order_customer_updates_log>zell_order_customer_updates:zell_order_customer_updates_log_update_fkey:r,zell_order_shipments>orders:zell_order_shipments_order_fkey:r,zell_order_shipments_log>orders:zell_order_shipments_log_order_fkey:r,zell_payment_commands>orders:zell_payment_commands_order_fkey:r',
         (select s.v from (with recursive d(child, parent, conname, deltype) as (
      select c.conrelid, c.confrelid, c.conname, c.confdeltype
        from pg_catalog.pg_constraint c where c.contype = 'f' and c.confrelid = 'public.orders'::regclass
      union
      select c.conrelid, c.confrelid, c.conname, c.confdeltype
        from pg_catalog.pg_constraint c join d on c.confrelid = d.child where c.contype = 'f'
    )
    select pg_catalog.string_agg(cc.relname::text || '>' || pc.relname::text || ':' || d.conname::text || ':' || d.deltype::text, ','
                                 order by cc.relname::text collate "C", d.conname::text collate "C") as v
      from d join pg_catalog.pg_class cc on cc.oid = d.child join pg_catalog.pg_class pc on pc.oid = d.parent) s)
  union all
  select 'V10', 'no privilege for zell_purge_definer on any other table, and no CREATE on schema public',
         not exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                      where x.grantee = pg_catalog.to_regrole('zell_purge_definer')
                        and c.relname not in ('orders', 'order_items', 'order_events', 'order_payments', 'zell_payment_commands', 'zell_order_shipments', 'zell_order_shipments_log', 'zell_order_customer_updates', 'zell_order_customer_updates_log', 'zell_purge_log', 'zell_purge_reauth', 'zell_purge_attempts', 'zell_purge_log_id_seq'))
     and not pg_catalog.has_schema_privilege('zell_purge_definer', 'public', 'CREATE'), null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select pg_catalog.count(*) from checks) = 10 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
