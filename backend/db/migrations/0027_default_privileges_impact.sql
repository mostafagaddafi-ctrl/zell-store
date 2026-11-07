-- 0027 DEFAULT-PRIVILEGES — استعلام الأثر (read only، صف لكل قيمة: section | k | v). العقد §٦-١.
-- بيتشغّل قبل وبعد كل خطوة على Production (العقد §٦-٢). مفيش بيانات عملاء: كتالوج بس.
--   default_acl: صفوف pg_default_acl كلها (الدور | الـ schema | النوع = الصلاحيات بالنص).
--   fp: عدد + md5 مرتّب لصلاحيات الكائنات الموجودة: الجداول/sequences/views وأعمدتها في public وstorage، ودوال public وstorage،
--       ودوال الدور postgres في كل الـ schemas (كائنات التجربة zell_dp_probe_* مستبعدة من البصمات).
--   probe: عدد كائنات التجربة (لازم 0).  session: current_user وعدد الجلسات idle in transaction.

begin;
set transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local search_path = pg_catalog, pg_temp;
select x.section, x.k, x.v from (
  select 'default_acl'::text as section,
         pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
         d.defaclacl::text as v
    from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 'fp', 'rel public', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(c.relname || ':' || c.relkind::text || ':' || pg_catalog.pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, ''), ',' order by c.relname collate "C", c.relkind::text collate "C"), ''))
     from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'rel storage', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(c.relname || ':' || c.relkind::text || ':' || pg_catalog.pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, ''), ',' order by c.relname collate "C", c.relkind::text collate "C"), ''))
     from pg_catalog.pg_class c where c.relnamespace = 'storage'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'col public', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, ',' order by c.relname collate "C", a.attname collate "C"), ''))
     from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null and c.relname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'col storage', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, ',' order by c.relname collate "C", a.attname collate "C"), ''))
     from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'storage'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null and c.relname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'proc public', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(p.oid::regprocedure::text || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate "C"), ''))
     from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'proc storage', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(p.oid::regprocedure::text || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate "C"), ''))
     from pg_catalog.pg_proc p where p.pronamespace = 'storage'::regnamespace and p.proname not like 'zell\_dp\_probe%')
  union all
  select 'fp', 'proc owner postgres (all schemas)', (select pg_catalog.count(*)::text || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(p.oid::regprocedure::text || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate "C"), ''))
     from pg_catalog.pg_proc p where p.proowner = 'postgres'::regrole and p.proname not like 'zell\_dp\_probe%')
  union all
  select 'probe', 'zell_dp_probe objects',
         ((select pg_catalog.count(*) from pg_catalog.pg_class c where c.relname like 'zell\_dp\_probe%')
          + (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.proname like 'zell\_dp\_probe%')
          + (select pg_catalog.count(*) from pg_catalog.pg_namespace s where s.nspname like 'zell\_dp\_probe%'))::text
  union all
  select 'session', 'current_user', current_user::text
  union all
  select 'session', 'idle_tx', (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a where a.state like 'idle in transaction%')::text
) as x(section, k, v)
order by x.section collate "C", x.k collate "C";
rollback;
