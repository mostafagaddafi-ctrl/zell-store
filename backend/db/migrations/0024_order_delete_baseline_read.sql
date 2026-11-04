-- ORDER-DELETE phase C1 — قراية Production للتأكيد (كتالوج بس، من غير أي بيانات): نفس تعبيرات backend/db/ci/baseline_compare.sql
-- بالحرف للقيم الست otbl / ocols / opol لـ orders وorder_items. معاملة read only، وصف لكل قيمة (k · v = نص jsonb)، 6 صفوف.
-- مابتتشغّلش على Production غير بأمر قراية صريح ومنفصل من المالك بعد قبول المراجع. CI: build_from_scratch.sh الحالة C02.
begin;
set transaction read only;
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local search_path = pg_catalog, pg_temp;
select x.k, x.v::text as v from (
select 'otbl:' || t.tbl, (select pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'acl', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantor', pg_catalog.pg_get_userbyid(x.grantor),
      'grantee', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, 'privilege', x.privilege_type, 'grantable', x.is_grantable)
      order by case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, x.privilege_type)
     from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) x),
    'live_columns', (select pg_catalog.count(*) from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
  from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass('public.' || t.tbl))
from (values ('orders'), ('order_items')) t(tbl)
union all
select 'ocols:' || t.tbl, coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'position', (select pg_catalog.count(*) from pg_catalog.pg_attribute b where b.attrelid = a.attrelid and b.attnum > 0 and not b.attisdropped and b.attnum <= a.attnum),
    'column', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'typmod', a.atttypmod, 'not_null', a.attnotnull,
    'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity, 'generated', a.attgenerated,
    'collation', case when a.attcollation <> 0 and a.attcollation <> ty.typcollation then (select co.collname from pg_catalog.pg_collation co where co.oid = a.attcollation) end,
    'column_acl', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantor', pg_catalog.pg_get_userbyid(x.grantor),
        'grantee', case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, 'privilege', x.privilege_type, 'grantable', x.is_grantable)
      order by case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end, x.privilege_type) from pg_catalog.aclexplode(a.attacl) x),
    'comment', pg_catalog.col_description(a.attrelid, a.attnum)) order by a.attnum)
  from pg_catalog.pg_attribute a join pg_catalog.pg_type ty on ty.oid = a.atttypid
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = pg_catalog.to_regclass('public.' || t.tbl) and a.attnum > 0 and not a.attisdropped), '[]'::jsonb)
from (values ('orders'), ('order_items')) t(tbl)
union all
select 'opol:' || t.tbl, coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', p.polname, 'cmd', p.polcmd, 'permissive', p.polpermissive,
    'roles', (select pg_catalog.jsonb_agg(case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end order by 1) from pg_catalog.unnest(p.polroles) r),
    'qual', pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)) order by p.polname)
  from pg_catalog.pg_policy p where p.polrelid = pg_catalog.to_regclass('public.' || t.tbl)), '[]'::jsonb)
from (values ('orders'), ('order_items')) t(tbl)
) as x(k, v)
order by x.k collate "C";
rollback;
