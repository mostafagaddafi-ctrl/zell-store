-- تنضيف التجارب قبل الإطلاق — الفحص بعد التنفيذ (قراية بس) (docs/contracts/CLEAN-prelaunch.md §٧)
--
-- • معاملة read only. سطر بعد begin; (برّه الفحص): set local zell.clean_fp_expected = '<outside_fp من الـ dry-run>';
-- • النتيجة صفوف: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict.
-- • verify A1 و D و 0021-P بيتشغّلوا لوحدهم بعده (ملفاتهم).

begin;
set transaction read only;
set local statement_timeout = '50s';
set local timezone = 'UTC';

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
           || c.confdeltype || '|' || c.confupdtype || '|' || c.condeferrable::text || '|' || c.convalidated::text,
           ';' order by c.conname collate "C"), '')
    into v
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace cn on cn.oid = cl.relnamespace
   where c.contype = 'f' and c.confrelid = 'public.orders'::regclass;
  perform pg_catalog.set_config('zell.clean_fk_now', v, true);
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
  perform pg_catalog.set_config('zell.clean_fp_now', pg_catalog.md5(acc), true);
  perform pg_catalog.set_config('zell.clean_fp_now_tables', n::text, true);
end
$clfp$;

with checks(id, name, ok, detail) as (
  select 'K01', 'orders = order_items = order_events = 0',
         ((select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.order_events)) = '0|0|0', ((select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.order_events))
  union all
  select 'K02', 'no orphan rows (items / events without an order)',
         not exists (select 1 from public.order_items i where not exists (select 1 from public.orders o where o.id = i.order_id))
         and not exists (select 1 from public.order_events e where not exists (select 1 from public.orders o where o.id = e.order_id)),
         null
  union all
  select 'K03', 'outside fingerprint = dry-run (zell.clean_fp_expected)',
         pg_catalog.current_setting('zell.clean_fp_now') = pg_catalog.current_setting('zell.clean_fp_expected', true),
         pg_catalog.current_setting('zell.clean_fp_now')
  union all
  select 'K04', 'FK shape on orders (contract §3)',
         pg_catalog.current_setting('zell.clean_fk_now') = 'order_events_order_fkey|public.order_events|order_id|id|c|a|false|true;order_items_order_id_fkey|public.order_items|order_id|id|c|a|false|true',
         pg_catalog.current_setting('zell.clean_fk_now')
  union all
  select 'K05', 'protections enabled (5 triggers on orders / order_events)', (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
       where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled = 'O'
         and (c.relname, g.tgname) in (('orders', 'orders_cancelled_final'), ('orders', 'orders_status_guard'),
                                       ('orders', 'orders_created_event'), ('order_events', 'order_events_immutable'),
                                       ('order_events', 'order_events_no_truncate'))) = 5, null
  union all
  select 'K06', 'zell_create_order body = D (c131cb51…)',
         coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), '') = 'c131cb51cd86830e9445b139296b0281',
         null
)
select 0::integer as ord, 'summary'::text as kind, null::text as check_id, null::text as check_name, null::boolean as ok, null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 6 then 'PASS' else 'FAIL' end as verdict
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail, null
  from checks c
order by 1;

rollback;
