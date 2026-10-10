-- تنضيف التجارب قبل الإطلاق — الحصر (قراية بس) (docs/contracts/CLEAN-prelaunch.md §٤)
--
-- • معاملة read only. أعداد وأرقام طلبات بس، من غير أي بيانات زباين.
-- • النتيجة صفوف: 1 ord · 2 key · 3 value. صف approve فيه القيم اللي بتتنسخ في سطور الموافقة بالحرف (orders ¦ statuses ¦ counts).

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

do $clinv$
declare
  t text;
  v bigint;
  acc text := '';
begin
  foreach t in array array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges',
                           'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      acc := acc || t || '=absent,';
    else
      execute pg_catalog.format('select count(*) from public.%I', t) into v;
      acc := acc || t || '=' || v || ',';
    end if;
  end loop;
  perform pg_catalog.set_config('zell.clean_inv', pg_catalog.rtrim(acc, ','), true);
end
$clinv$;

select 1 as ord, 'orders'::text as key, (select count(*) from public.orders)::text as value
union all select 2, 'statuses', coalesce((select pg_catalog.string_agg(s.status || '=' || s.n, ',' order by s.status collate "C")
                    from (select o.status, count(*) as n from public.orders o group by o.status) s), '')
union all select 3, 'order_numbers', coalesce((select pg_catalog.string_agg(o.order_number, ',' order by o.order_number collate "C") from public.orders o), '')
union all select 4, 'order_items', (select count(*) from public.order_items)::text
union all select 5, 'order_events', (select count(*) from public.order_events)::text
union all select 6, 'coupons_used', (select count(distinct o.coupon_code) from public.orders o where o.coupon_code is not null)::text
union all select 7, 'inventory', pg_catalog.current_setting('zell.clean_inv')
union all select 8, 'p1_tables', case when pg_catalog.to_regclass('public.order_payments') is not null
                                        or pg_catalog.to_regclass('public.zell_payment_commands') is not null then 'present' else 'absent' end
union all select 9, 'fk_shape', pg_catalog.current_setting('zell.clean_fk_now')
union all select 10, 'fk_expected', case when pg_catalog.current_setting('zell.clean_fk_now') = 'order_events_order_fkey|public.order_events|order_id|id|c|a|false|true;order_items_order_id_fkey|public.order_items|order_id|id|c|a|false|true' then 'ok' else 'DIFFERENT' end
union all select 11, 'idle_tx', (select count(*) from pg_catalog.pg_stat_activity a
                                  where a.state like 'idle in transaction%' and a.pid <> pg_catalog.pg_backend_pid())::text
union all select 12, 'protections', (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
       where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled = 'O'
         and (c.relname, g.tgname) in (('orders', 'orders_cancelled_final'), ('orders', 'orders_status_guard'),
                                       ('orders', 'orders_created_event'), ('order_events', 'order_events_immutable'),
                                       ('order_events', 'order_events_no_truncate')))::text || '/5'
union all select 13, 'create_order', coalesce((select pg_catalog.pg_get_userbyid(p.proowner) || ':' || pg_catalog.md5(p.prosrc)
                                                 from pg_catalog.pg_proc p
                                                where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), 'missing')
union all select 14, 'outside_fp', pg_catalog.current_setting('zell.clean_fp_now') || ' tables=' || pg_catalog.current_setting('zell.clean_fp_now_tables')
union all select 15, 'approve', coalesce((select pg_catalog.string_agg(o.order_number, ',' order by o.order_number collate "C") from public.orders o), '') || ' ¦ ' || coalesce((select pg_catalog.string_agg(s.status || '=' || s.n, ',' order by s.status collate "C")
                    from (select o.status, count(*) as n from public.orders o group by o.status) s), '') || ' ¦ ' || ((select count(*) from public.orders) || '|' || (select count(*) from public.order_items) || '|' || (select count(*) from public.order_events))
order by 1;

rollback;
