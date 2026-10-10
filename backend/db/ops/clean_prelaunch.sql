-- تنضيف التجارب قبل الإطلاق — التنفيذ (docs/contracts/CLEAN-prelaunch.md)
--
-- • بيمسح كل orders و order_items و order_events (الأحداث بالـ cascade). مرة واحدة قبل P1. مش migration.
-- • معاملة واحدة repeatable read. الـ preflight بيرفض: P1 متطبّق · شكل الـ FKs على orders مختلف أو فيه FK جديد ·
--   idle in transaction · حماية ناقصة · أي حاجة اتغيّرت عن آخر موافقة (طلبات · حالات · سطور · أحداث).
-- • الـ postflight بيرفض الـ commit لو: الجداول التلاتة مش صفر · بصمة أي جدول برّه النطاق اتغيّرت · الحمايات أو الـ FKs اتغيّرت.
-- • الـ dry-run: clean_prelaunch_dryrun.sql (نفس الجسم بالحرف — md5 في CI). الفحص بعد: clean_prelaunch_verify.sql.
-- • الرجوع = الـ backup الكامل بس (§٨ في العقد).
-- سطور الموافقة بعد begin; (برّه الجسم) — القيم بتتنسخ بالحرف من صف approve في نتيجة clean_prelaunch_count.sql:
--   set local zell.approved_by = 'owner-approval-YYYY-MM-DD-prelaunch-clean';
--   set local zell.clean_orders = '<أرقام الطلبات مرتبة بفاصلة>';
--   set local zell.clean_statuses = '<حالة=عدد,…>';
--   set local zell.clean_counts = '<orders|items|events>';
-- ⚠ على Production بأمر صريح بس، بعد backup كامل وdry-run ورا بعض في وقت هادي.

begin;
-- >>> CLEAN_PRELAUNCH BODY
-- repeatable read: البصمتين (قبل/بعد) من نفس الـ snapshot، فأي كتابة من جلسة تانية وقت التنفيذ مابتظهرش، والبصمة بتقيس أثر المسح بس.
set transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '50s';
set local timezone = 'UTC';

-- (0) قبل: شكل الـ FKs (§٣) · بصمة الجداول برّه النطاق (§٥) · بصمة الحمايات (§٧).
do $clfk$
declare
  v text;
begin
  select coalesce(pg_catalog.string_agg(
           c.conname || '|' || cn.nspname || '.' || cl.relname || '|'
           || (select pg_catalog.string_agg(a.attname, ',' order by k.ord) from pg_catalog.unnest(c.conkey) with ordinality as k(attnum, ord)
                 join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || '|'
           || (select pg_catalog.string_agg(a.attname, ',' order by k.ord) from pg_catalog.unnest(c.confkey) with ordinality as k(attnum, ord)
                 join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) || '|'
           || c.confdeltype::text || '|' || c.confupdtype::text || '|' || c.condeferrable::text || '|' || c.convalidated::text,
           ';' order by c.conname collate "C"), '')
    into v
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace cn on cn.oid = cl.relnamespace
   where c.contype = 'f' and c.confrelid = 'public.orders'::regclass;
  perform pg_catalog.set_config('zell.clean_fk_before', v, true);
end
$clfk$;

do $clfp$
declare
  r record;
  v text;
  acc text := '';
  n integer := 0;
begin
  for r in select c.relname
             from pg_catalog.pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and c.relname not in ('orders', 'order_items', 'order_events')
            order by c.relname collate "C"
  loop
    execute pg_catalog.format(
      'select count(*)::text || %L || pg_catalog.md5(coalesce(pg_catalog.string_agg(x, %L order by x collate "C"), %L)) '
      || 'from (select pg_catalog.to_jsonb(t)::text as x from public.%I t) s', ':', '|', '', r.relname) into v;
    acc := acc || r.relname || '=' || v || ';';
    n := n + 1;
  end loop;
  if pg_catalog.to_regclass('auth.users') is null then
    acc := acc || 'auth.users=absent;';
  else
    execute 'select count(*)::text || '':'' || pg_catalog.md5(coalesce(pg_catalog.string_agg(u.id::text, '','' order by (u.id::text) collate "C"), '''')) from auth.users u'
      into v;
    acc := acc || 'auth.users=' || v || ';';
  end if;
  if pg_catalog.to_regclass('storage.objects') is null then
    acc := acc || 'storage.objects=absent;';
  else
    execute 'select count(*)::text || '':'' || pg_catalog.md5(coalesce(pg_catalog.string_agg(o.bucket_id || ''/'' || o.name, '','' '
         || 'order by (o.bucket_id || ''/'' || o.name) collate "C"), '''')) from storage.objects o'
      into v;
    acc := acc || 'storage.objects=' || v || ';';
  end if;
  perform pg_catalog.set_config('zell.clean_fp_before', pg_catalog.md5(acc), true);
  perform pg_catalog.set_config('zell.clean_fp_before_tables', n::text, true);
end
$clfp$;

do $clprot$
declare
  v text;
begin
  select pg_catalog.md5(
           coalesce((select pg_catalog.string_agg(c.relname || '.' || g.tgname || ':' || g.tgenabled::text, ','
                                                  order by c.relname collate "C", g.tgname collate "C")
                       from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
                      where c.relnamespace = 'public'::regnamespace and not g.tgisinternal), '')
           || '#' || coalesce((select pg_catalog.string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text, ','
                                                         order by c.relname collate "C")
                                 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')), '')
           || '#' || coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc) || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':'
                                                         || coalesce(p.proacl::text, ''), ',' order by p.oid)
                                 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), ''))
    into v;
  perform pg_catalog.set_config('zell.clean_prot_before', v, true);
end
$clprot$;

-- (0) preflight: الموافقة · قبل P1 بس · شكل الـ FKs · مفيش idle in transaction · الحمايات · نفس اللي اتوافق عليه بالظبط.
do $clpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_orders text := pg_catalog.current_setting('zell.clean_orders', true);
  v_statuses text := pg_catalog.current_setting('zell.clean_statuses', true);
  v_counts text := pg_catalog.current_setting('zell.clean_counts', true);
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_CLEAN_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 or v_orders is null or v_statuses is null or v_counts is null then
    raise exception 'ZELL_CLEAN_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regclass('public.order_payments') is not null or pg_catalog.to_regclass('public.zell_payment_commands') is not null then
    raise exception 'ZELL_CLEAN_P1_APPLIED';
  end if;
  if pg_catalog.current_setting('zell.clean_fk_before') is distinct from
     'order_events_order_fkey|public.order_events|order_id|id|c|a|false|true;order_items_order_id_fkey|public.order_items|order_id|id|c|a|false|true' then
    raise exception 'ZELL_CLEAN_FK_SHAPE';
  end if;
  if (select count(*) from pg_catalog.pg_stat_activity a
       where a.state like 'idle in transaction%' and a.pid <> pg_catalog.pg_backend_pid()) <> 0 then
    raise exception 'ZELL_CLEAN_IDLE_TX';
  end if;
  if (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
       where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled = 'O'
         and (c.relname, g.tgname) in (('orders', 'orders_cancelled_final'), ('orders', 'orders_status_guard'),
                                       ('orders', 'orders_created_event'), ('order_events', 'order_events_immutable'),
                                       ('order_events', 'order_events_no_truncate'))) <> 5 then
    raise exception 'ZELL_CLEAN_PROTECTIONS';
  end if;
  if v_orders is distinct from coalesce((select pg_catalog.string_agg(o.order_number, ',' order by o.order_number collate "C") from public.orders o), '')
     or v_statuses is distinct from coalesce((select pg_catalog.string_agg(s.status || '=' || s.n, ',' order by s.status collate "C")
                    from (select o.status, count(*) as n from public.orders o group by o.status) s), '')
     or v_counts is distinct from ((select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.order_events)) then
    raise exception 'ZELL_CLEAN_APPROVAL_STALE';
  end if;
end
$clpre$;

-- (1) delete: order_items صريح الأول، وبعدين orders، والأحداث بالـ cascade بس (مفيش delete مباشر على order_events).
delete from public.order_items;
delete from public.orders;

-- (2) بعد: نفس الحسابات بالحرف، والـ postflight بيرفض الـ commit لو أي حاجة اختلفت.
do $clfk$
declare
  v text;
begin
  select coalesce(pg_catalog.string_agg(
           c.conname || '|' || cn.nspname || '.' || cl.relname || '|'
           || (select pg_catalog.string_agg(a.attname, ',' order by k.ord) from pg_catalog.unnest(c.conkey) with ordinality as k(attnum, ord)
                 join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || '|'
           || (select pg_catalog.string_agg(a.attname, ',' order by k.ord) from pg_catalog.unnest(c.confkey) with ordinality as k(attnum, ord)
                 join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) || '|'
           || c.confdeltype::text || '|' || c.confupdtype::text || '|' || c.condeferrable::text || '|' || c.convalidated::text,
           ';' order by c.conname collate "C"), '')
    into v
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace cn on cn.oid = cl.relnamespace
   where c.contype = 'f' and c.confrelid = 'public.orders'::regclass;
  perform pg_catalog.set_config('zell.clean_fk_after', v, true);
end
$clfk$;

do $clfp$
declare
  r record;
  v text;
  acc text := '';
  n integer := 0;
begin
  for r in select c.relname
             from pg_catalog.pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and c.relname not in ('orders', 'order_items', 'order_events')
            order by c.relname collate "C"
  loop
    execute pg_catalog.format(
      'select count(*)::text || %L || pg_catalog.md5(coalesce(pg_catalog.string_agg(x, %L order by x collate "C"), %L)) '
      || 'from (select pg_catalog.to_jsonb(t)::text as x from public.%I t) s', ':', '|', '', r.relname) into v;
    acc := acc || r.relname || '=' || v || ';';
    n := n + 1;
  end loop;
  if pg_catalog.to_regclass('auth.users') is null then
    acc := acc || 'auth.users=absent;';
  else
    execute 'select count(*)::text || '':'' || pg_catalog.md5(coalesce(pg_catalog.string_agg(u.id::text, '','' order by (u.id::text) collate "C"), '''')) from auth.users u'
      into v;
    acc := acc || 'auth.users=' || v || ';';
  end if;
  if pg_catalog.to_regclass('storage.objects') is null then
    acc := acc || 'storage.objects=absent;';
  else
    execute 'select count(*)::text || '':'' || pg_catalog.md5(coalesce(pg_catalog.string_agg(o.bucket_id || ''/'' || o.name, '','' '
         || 'order by (o.bucket_id || ''/'' || o.name) collate "C"), '''')) from storage.objects o'
      into v;
    acc := acc || 'storage.objects=' || v || ';';
  end if;
  perform pg_catalog.set_config('zell.clean_fp_after', pg_catalog.md5(acc), true);
  perform pg_catalog.set_config('zell.clean_fp_after_tables', n::text, true);
end
$clfp$;

do $clprot$
declare
  v text;
begin
  select pg_catalog.md5(
           coalesce((select pg_catalog.string_agg(c.relname || '.' || g.tgname || ':' || g.tgenabled::text, ','
                                                  order by c.relname collate "C", g.tgname collate "C")
                       from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
                      where c.relnamespace = 'public'::regnamespace and not g.tgisinternal), '')
           || '#' || coalesce((select pg_catalog.string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text, ','
                                                         order by c.relname collate "C")
                                 from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')), '')
           || '#' || coalesce((select pg_catalog.string_agg(pg_catalog.md5(p.prosrc) || ':' || pg_catalog.pg_get_userbyid(p.proowner) || ':'
                                                         || coalesce(p.proacl::text, ''), ',' order by p.oid)
                                 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), ''))
    into v;
  perform pg_catalog.set_config('zell.clean_prot_after', v, true);
end
$clprot$;

do $clpost$
begin
  if (select count(*) from public.orders) <> 0 or (select count(*) from public.order_items) <> 0
     or (select count(*) from public.order_events) <> 0 then
    raise exception 'ZELL_CLEAN_NOT_EMPTY';
  end if;
  if pg_catalog.current_setting('zell.clean_fp_after') is distinct from pg_catalog.current_setting('zell.clean_fp_before')
     or pg_catalog.current_setting('zell.clean_fp_after_tables') is distinct from pg_catalog.current_setting('zell.clean_fp_before_tables') then
    raise exception 'ZELL_CLEAN_OUTSIDE_CHANGED';
  end if;
  if pg_catalog.current_setting('zell.clean_prot_after') is distinct from pg_catalog.current_setting('zell.clean_prot_before')
     or pg_catalog.current_setting('zell.clean_fk_after') is distinct from pg_catalog.current_setting('zell.clean_fk_before') then
    raise exception 'ZELL_CLEAN_PROTECTIONS_CHANGED';
  end if;
end
$clpost$;
-- <<< CLEAN_PRELAUNCH BODY
commit;
