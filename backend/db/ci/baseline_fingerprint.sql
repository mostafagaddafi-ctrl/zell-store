-- backend/db/ci/baseline_fingerprint.sql — CI ONLY. Read only. ONE md5 of the database design AND row counts, used by the
-- guard tests (§4-6): a refused file must leave this value unchanged. build_from_scratch.sh accepts only: psql exit 0, an empty
-- error stream, exactly ONE output line of 32 hex characters. Anything else stops the run as FAILED (never "unchanged").
-- Every non-text value is cast to text explicitly; "char" catalog fields (relkind, tgenabled, polcmd, defaclobjtype, prokind)
-- included. Covered: functions (full definition md5 = body, config, security, volatility; owner; ACL) · relations (kind, owner,
-- ACL, RLS / FORCE) · columns (type, NOT NULL, default, ACL) · constraints (+ validated) · index definitions · trigger definitions
-- and enabled state · policies (command, roles, expressions) · comments · sequences · schemas · extensions · roles and
-- memberships · default privileges · exact row counts of every table in public / auth / storage.
-- Not covered: table data values (only counts), large objects, server settings.
\set ON_ERROR_STOP on
set search_path = pg_catalog, pg_temp;
select pg_catalog.md5(coalesce(pg_catalog.string_agg(x, E'\n' order by x collate "C"), '')) from (
  select 'p|' || n.nspname::text || '|' || p.proname::text || '|' || p.prokind::text || '|' || pg_catalog.pg_get_function_identity_arguments(p.oid)
         || '|' || pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '') || '|' || pg_catalog.pg_get_userbyid(p.proowner)::text
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and p.prokind in ('f', 'p')
  union all
  select 'c|' || n.nspname::text || '|' || c.relname::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
         || pg_catalog.pg_get_userbyid(c.relowner)::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  union all
  select 'a|' || a.attrelid::regclass::text || '|' || a.attnum::text || '|' || a.attname::text || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod)
         || '|' || a.attnotnull::text || '|' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') || '|' || coalesce(a.attacl::text, '')
  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and a.attnum > 0 and not a.attisdropped
  union all
  select 'k|' || k.conrelid::regclass::text || '|' || k.conname::text || '|' || k.contype::text || '|' || pg_catalog.pg_get_constraintdef(k.oid)
         || '|' || k.convalidated::text
  from pg_catalog.pg_constraint k join pg_catalog.pg_namespace n on n.oid = k.connamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
  union all
  select 'i|' || pg_catalog.pg_get_indexdef(x.indexrelid) from pg_catalog.pg_index x join pg_catalog.pg_class c on c.oid = x.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  union all
  select 't|' || pg_catalog.pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text from pg_catalog.pg_trigger t where not t.tgisinternal
  union all
  select 'y|' || p.polrelid::regclass::text || '|' || p.polname::text || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|'
         || p.polroles::text || '|' || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || '|'
         || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
  from pg_catalog.pg_policy p
  union all
  select 'm|' || ds.classoid::regclass::text || '|' || ds.objoid::text || '|' || ds.objsubid::text || '|' || ds.description::text
  from pg_catalog.pg_description ds
  where ds.classoid in ('pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass, 'pg_catalog.pg_namespace'::regclass) and ds.objoid >= 16384
  union all
  select 's|' || sq.seqrelid::regclass::text || '|' || sq.seqtypid::regtype::text || '|' || sq.seqstart::text || '|' || sq.seqincrement::text
         || '|' || sq.seqmax::text || '|' || sq.seqmin::text || '|' || sq.seqcycle::text from pg_catalog.pg_sequence sq
  union all
  select 'n|' || n.nspname::text || '|' || pg_catalog.pg_get_userbyid(n.nspowner)::text || '|' || coalesce(n.nspacl::text, '') from pg_catalog.pg_namespace n
  union all
  select 'e|' || e.extname::text || '|' || e.extnamespace::regnamespace::text || '|' || e.extversion::text from pg_catalog.pg_extension e
  union all
  select 'r|' || r.rolname::text || '|' || r.rolsuper::text || '|' || r.rolcreaterole::text || '|' || r.rolbypassrls::text || '|'
         || r.rolinherit::text || '|' || r.rolcanlogin::text
  from pg_catalog.pg_roles r
  union all
  select 'g|' || pg_catalog.pg_get_userbyid(am.roleid)::text || '>' || pg_catalog.pg_get_userbyid(am.member)::text || '|' || am.admin_option::text
         || '|' || am.inherit_option::text || '|' || am.set_option::text from pg_catalog.pg_auth_members am
  union all
  select 'd|' || pg_catalog.pg_get_userbyid(da.defaclrole)::text || '|' || da.defaclnamespace::text || '|' || da.defaclobjtype::text || '|'
         || coalesce(da.defaclacl::text, '')
  from pg_catalog.pg_default_acl da
  union all
  select 'w|' || n.nspname::text || '.' || c.relname::text || '|' || (pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
           pg_catalog.format('select pg_catalog.count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage')
) s(x);
