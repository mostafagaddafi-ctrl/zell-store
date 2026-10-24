-- BASELINE-OUTSIDE step 0 (docs/contracts/BASELINE-OUTSIDE.md §2) — FOR REVIEW. Not executed on Production.
-- Catalog-only, single READ ONLY transaction, limits inlined (objects=200, inventory=3000, def_bytes=200000).
begin transaction isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';
set local search_path = pg_catalog, pg_temp;
with
target(name) as (values ('zell_save_shipping'), ('zell_save_identity'), ('zell_reorder_products'),
  ('zell_reorder_product_images'), ('zell_set_primary_product_image'), ('zell_valid_benefits')),
au as (select pg_catalog.to_regclass('public.admin_users') as oid),
pr as (select pg_catalog.to_regclass('public.products') as oid),
f1 as (
  select n.nspname as schema, p.proname as name, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args,
    pg_catalog.pg_get_function_arguments(p.oid) as args, pg_catalog.pg_get_function_result(p.oid) as result,
    p.prokind as kind, p.provolatile as volatility, p.proisstrict as strict, p.prosecdef as security_definer,
    p.proparallel as parallel, p.proleakproof as leakproof, p.proconfig as config,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    (select pg_catalog.json_agg(pg_catalog.json_build_object('grantor', pg_catalog.pg_get_userbyid(a.grantor),
        'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
        'privilege', a.privilege_type, 'grantable', a.is_grantable)
      order by case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, a.privilege_type, pg_catalog.pg_get_userbyid(a.grantor))
     from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a) as acl,
    pg_catalog.pg_get_functiondef(p.oid) as def,
    row_number() over (order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as rn
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p') and p.proname in (select name from target)),
c2 as (
  select a.attnum as num, a.attname as name, pg_catalog.format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) as dflt, a.attidentity as identity, a.attgenerated as generated,
    (select pg_catalog.json_agg(pg_catalog.json_build_object('grantor', pg_catalog.pg_get_userbyid(x.grantor),
        'grantee', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
        'privilege', x.privilege_type, 'grantable', x.is_grantable)
      order by case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, x.privilege_type)
     from pg_catalog.aclexplode(a.attacl) x) as column_acl,
    row_number() over (order by a.attnum) as rn
  from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = (select oid from au) and a.attnum > 0 and not a.attisdropped),
k2 as (select conname as name, contype as type, pg_catalog.pg_get_constraintdef(oid) as def, row_number() over (order by conname) as rn
  from pg_catalog.pg_constraint where conrelid = (select oid from au)),
i2 as (select ic.relname as name, pg_catalog.pg_get_indexdef(x.indexrelid) as def, row_number() over (order by ic.relname) as rn
  from pg_catalog.pg_index x join pg_catalog.pg_class ic on ic.oid = x.indexrelid where x.indrelid = (select oid from au)),
s2 as (
  select sn.nspname as schema, sc.relname as name, ra.attname as column_name, d.deptype as dep_type,
    pg_catalog.format_type(s.seqtypid, null) as type, s.seqstart as start, s.seqincrement as increment, s.seqmin as min, s.seqmax as max,
    s.seqcache as cache, s.seqcycle as cycle, pg_catalog.pg_get_userbyid(sc.relowner) as owner,
    (select pg_catalog.json_agg(pg_catalog.json_build_object('grantor', pg_catalog.pg_get_userbyid(x.grantor),
        'grantee', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
        'privilege', x.privilege_type, 'grantable', x.is_grantable)
      order by case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, x.privilege_type)
     from pg_catalog.aclexplode(coalesce(sc.relacl, pg_catalog.acldefault('s', sc.relowner))) x) as acl,
    row_number() over (order by sc.relname) as rn
  from pg_catalog.pg_depend d join pg_catalog.pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
  join pg_catalog.pg_namespace sn on sn.oid = sc.relnamespace join pg_catalog.pg_sequence s on s.seqrelid = sc.oid
  left join pg_catalog.pg_attribute ra on ra.attrelid = d.refobjid and ra.attnum = d.refobjsubid
  where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.refobjid = (select oid from au)),
p2 as (select polname as name, polcmd as cmd, polpermissive as permissive,
    (select pg_catalog.json_agg(case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end order by 1) from pg_catalog.unnest(polroles) r) as roles,
    pg_catalog.pg_get_expr(polqual, polrelid) as using_expr, pg_catalog.pg_get_expr(polwithcheck, polrelid) as check_expr,
    row_number() over (order by polname) as rn
  from pg_catalog.pg_policy where polrelid = (select oid from au)),
t2 as (select tgname as name, tgenabled as enabled, pg_catalog.pg_get_triggerdef(oid) as def, row_number() over (order by tgname) as rn
  from pg_catalog.pg_trigger where tgrelid = (select oid from au) and not tgisinternal),
d3 as (
  select pg_catalog.pg_get_userbyid(d.defaclrole) as creator, coalesce(n.nspname, '(global)') as schema, d.defaclobjtype as objtype,
    pg_catalog.pg_get_userbyid(a.grantor) as grantor, case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
    a.privilege_type as privilege, a.is_grantable as grantable,
    row_number() over (order by pg_catalog.pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '(global)'), d.defaclobjtype,
      case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, a.privilege_type) as rn
  from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a),
creators as (
  select distinct r from (
    select c.relowner as r from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    union select p.proowner from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union select defaclrole from pg_catalog.pg_default_acl) z),
h3 as (
  select pg_catalog.pg_get_userbyid(c.r) as creator, t.objtype,
    case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee, a.privilege_type as privilege, a.is_grantable as grantable,
    row_number() over (order by pg_catalog.pg_get_userbyid(c.r), t.objtype, case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, a.privilege_type) as rn
  from creators c cross join (values ('r'), ('S'), ('f'), ('T'), ('n')) t(objtype)
  cross join lateral pg_catalog.aclexplode(pg_catalog.acldefault(t.objtype::"char", c.r)) a),
r4 as (select rolname as name, rolsuper as super, rolinherit as inherit, rolcreaterole as createrole, rolcreatedb as createdb,
    rolcanlogin as login, rolreplication as replication, rolbypassrls as bypassrls, row_number() over (order by rolname) as rn
  from pg_catalog.pg_roles where rolname !~ '^pg_'),
m4 as (select r.rolname as role, m.rolname as member, g.rolname as grantor, am.admin_option, am.inherit_option, am.set_option,
    row_number() over (order by r.rolname, m.rolname, g.rolname) as rn
  from pg_catalog.pg_auth_members am join pg_catalog.pg_roles r on r.oid = am.roleid join pg_catalog.pg_roles m on m.oid = am.member
  join pg_catalog.pg_roles g on g.oid = am.grantor where r.rolname !~ '^pg_'),
f5 as (select p.proname as name, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args, p.prokind as kind,
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as md5,
    row_number() over (order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as rn
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')),
r5 as (select c.relname as name, c.relkind as kind,
    pg_catalog.md5(coalesce(case when c.relkind in ('v', 'm') then pg_catalog.pg_get_viewdef(c.oid) end, '') || '|' ||
      coalesce((select pg_catalog.string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')) as md5,
    row_number() over (order by c.relname) as rn
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p'))
select pg_catalog.json_build_object(
  'meta', pg_catalog.json_build_object('at_utc', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'version', pg_catalog.version(), 'database', pg_catalog.current_database(), 'user', current_user,
    'read_only', pg_catalog.current_setting('transaction_read_only'), 'limits', pg_catalog.json_build_object('objects', 200, 'inventory', 3000, 'def_bytes', 200000)),
  'q1_functions', (select pg_catalog.json_build_object('count', count(*), 'limit', 200, 'complete', count(*) <= 200,
      'missing', (select pg_catalog.json_agg(t.name order by t.name) from target t where not exists (select 1 from f1 where f1.name = t.name)),
      'overloaded', (select pg_catalog.json_agg(z.name order by z.name) from (select name from f1 group by name having count(*) > 1) z),
      'items', coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('schema', schema, 'name', name, 'identity_args', identity_args, 'args', args,
        'result', result, 'kind', kind, 'volatility', volatility, 'strict', strict, 'security_definer', security_definer, 'parallel', parallel,
        'leakproof', leakproof, 'config', config, 'owner', owner, 'acl', acl, 'def_bytes', pg_catalog.octet_length(def),
        'def_md5', pg_catalog.md5(def), 'def_oversize', pg_catalog.octet_length(def) > 200000,
        'def', case when pg_catalog.octet_length(def) <= 200000 then def end) order by rn) filter (where rn <= 200), '[]'::json)) from f1),
  'q2_present', (select oid is not null from au),
  'q2_columns', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('num', num, 'name', name, 'type', type, 'not_null', not_null, 'default', dflt, 'identity', identity,
        'generated', generated, 'column_acl', column_acl) order by rn) filter (where rn <= 200), '[]'::json)) from c2),
  'q2_constraints', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'type', type, 'def', def) order by rn) filter (where rn <= 200), '[]'::json)) from k2),
  'q2_benefits_constraint', (select pg_catalog.json_build_object('table_present', (select oid is not null from pr), 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('schema', 'public', 'table', 'products', 'name', conname, 'def', pg_catalog.pg_get_constraintdef(oid)) order by conname), '[]'::json))
    from pg_catalog.pg_constraint where conrelid = (select oid from pr) and conname = 'products_benefits_shape'),
  'q2_indexes', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'def', def) order by rn) filter (where rn <= 200), '[]'::json)) from i2),
  'q2_table', (select pg_catalog.json_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'acl', (select pg_catalog.json_agg(pg_catalog.json_build_object('grantor', pg_catalog.pg_get_userbyid(x.grantor),
          'grantee', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, 'privilege', x.privilege_type, 'grantable', x.is_grantable)
        order by case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, x.privilege_type)
       from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) x))
    from pg_catalog.pg_class c where c.oid = (select oid from au)),
  'q2_sequences', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('schema', schema, 'name', name, 'column', column_name, 'dep_type', dep_type, 'type', type, 'start', start,
        'increment', increment, 'min', min, 'max', max, 'cache', cache, 'cycle', cycle, 'owner', owner, 'acl', acl) order by rn) filter (where rn <= 200), '[]'::json)) from s2),
  'q2_policies', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'cmd', cmd, 'permissive', permissive, 'roles', roles, 'using', using_expr, 'check', check_expr) order by rn)
      filter (where rn <= 200), '[]'::json)) from p2),
  'q2_triggers', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'enabled', enabled, 'def', def) order by rn) filter (where rn <= 200), '[]'::json)) from t2),
  'q3_default_acl', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('creator', creator, 'schema', schema, 'objtype', objtype, 'grantor', grantor, 'grantee', grantee, 'privilege', privilege,
        'grantable', grantable) order by rn) filter (where rn <= 200), '[]'::json)) from d3),
  'q3_hardwired', (select pg_catalog.json_build_object('note', 'built-in defaults per creator/objtype; a (global) row replaces them, a schema row adds to them',
      'count', count(*), 'complete', count(*) <= 3000, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('creator', creator, 'objtype', objtype, 'grantee', grantee, 'privilege', privilege, 'grantable', grantable) order by rn)
      filter (where rn <= 3000), '[]'::json)) from h3),
  'q4_roles', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 200, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'super', super, 'inherit', inherit, 'createrole', createrole, 'createdb', createdb, 'login', login,
        'replication', replication, 'bypassrls', bypassrls) order by rn) filter (where rn <= 200), '[]'::json)) from r4),
  'q4_members', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 3000, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('role', role, 'member', member, 'grantor', grantor, 'admin_option', admin_option, 'inherit_option', inherit_option,
        'set_option', set_option) order by rn) filter (where rn <= 3000), '[]'::json)) from m4),
  'q5_functions', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 3000, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'identity_args', identity_args, 'kind', kind, 'md5', md5) order by rn) filter (where rn <= 3000), '[]'::json)) from f5),
  'q5_relations', (select pg_catalog.json_build_object('count', count(*), 'complete', count(*) <= 3000, 'items', coalesce(pg_catalog.json_agg(
      pg_catalog.json_build_object('name', name, 'kind', kind, 'md5', md5) order by rn) filter (where rn <= 3000), '[]'::json)) from r5)
) as step0;
rollback;
