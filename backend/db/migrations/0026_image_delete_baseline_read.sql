-- IMAGE-DELETE — قراية Production للتأكيد (كتالوج بس، من غير أي بيانات): نفس تعبير backend/db/ci/baseline_compare.sql
-- بالحرف (سطور 93-102) لقيمة واحدة بس: col:product_images.fit. معاملة read only بتخلص بـ rollback، صف واحد (k · v = نص jsonb).
-- مابتتشغّلش على Production غير بأمر قراية صريح ومنفصل من المالك بعد قبول المراجع. ممنوع تشغيل baseline_compare.sql كامل على Production.
begin;
set transaction read only;
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local search_path = pg_catalog, pg_temp;
select x.k, x.v::text as v from (
select 'col:' || t.tbl || '.' || t.col, pg_catalog.jsonb_build_object('num', a.attnum,
    'position', (select pg_catalog.count(*) from pg_catalog.pg_attribute b where b.attrelid = a.attrelid and b.attnum > 0 and not b.attisdropped and b.attnum <= a.attnum),
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'typmod', a.atttypmod, 'not_null', a.attnotnull, 'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
    'identity', a.attidentity, 'generated', a.attgenerated,
    'collation', case when a.attcollation <> 0 and a.attcollation <> ty.typcollation then (select co.collname from pg_catalog.pg_collation co where co.oid = a.attcollation) end,
    'column_acl', a.attacl, 'comment', pg_catalog.col_description(a.attrelid, a.attnum))
from (values ('product_images', 'fit')) t(tbl, col)
join pg_catalog.pg_attribute a on a.attrelid = pg_catalog.to_regclass('public.' || t.tbl) and a.attname = t.col and a.attnum > 0 and not a.attisdropped
join pg_catalog.pg_type ty on ty.oid = a.atttypid
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
) as x(k, v)
order by x.k collate "C";
rollback;
