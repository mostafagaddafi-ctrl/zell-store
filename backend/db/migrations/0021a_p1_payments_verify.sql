-- 0021-A P1 — التحقق بعد التطبيق (قراءة بس) لـ 0021a_p1_payments.sql
--
-- • معاملة read only: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (ord = 0 ملخص، والباقي فحص فحص).
-- • صالح في أي وقت بعد التطبيق (والإعدادات متفعّلة أو لأ، وفيه دفعات أو لأ). قبل التطبيق: بيقع بخطأ (الجداول مش موجودة).
-- • أعمدة psql -tA: 1 ord · 2 kind · 3 check_id · 4 check_name · 5 ok · 6 detail · 7 verdict · 8 orders_total · 9 payments
--   · 10 fee_enabled · 11 credit_enabled · 12 methods · 13 create_order_owner · 14 commands

begin;
set transaction read only;
set local statement_timeout = '30s';

with procs as (
  select p.oid, p.proname, pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%'
), pub(name) as (
  values ('zell_payment_record'), ('zell_payment_refund'), ('zell_payment_deliver_order'), ('zell_payment_order_summary'),
         ('zell_payment_list_methods'), ('zell_payment_add_method'), ('zell_payment_update_method'),
         ('zell_payment_delete_method'), ('zell_payment_get_settings'), ('zell_payment_save_settings')
), trg(name) as (
  values ('zell_payment_trg_append_only'), ('zell_payment_trg_settings_guard'), ('zell_payment_trg_orders_money')
), tbl(name) as (
  values ('order_payments'), ('zell_payment_methods'), ('zell_payment_settings'), ('zell_payment_config_log'), ('zell_payment_commands')
), co as (
  select p.oid, pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosrc
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb)')
), money as (
  select o.id, o.paid_piastres,
         coalesce((select pg_catalog.sum(case when p.kind = 'payment' then p.amount_piastres else -p.amount_piastres end)
                     from public.order_payments p where p.order_id = o.id), 0) as net,
         (select p.paid_after_piastres from public.order_payments p where p.order_id = o.id order by p.id desc limit 1) as last_after
    from public.orders o
), checks(id, name, ok, detail) as (
  select 'V01', 'tables: 5, owner postgres, RLS on, zero privileges for anon/authenticated/service_role',
         (select count(*) from pg_catalog.pg_class c join tbl on tbl.name = c.relname
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
             and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
             and not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
             and not pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
             and not pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) = 5
         and (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename in (select tbl.name from tbl)
                and p.roles = array['zell_order_definer']::name[]) = 5,
         null::text
  union all
  select 'V02', 'orders: paid_piastres + confirmation_fee_piastres (not null) with range checks, definer may update paid only',
         (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attnotnull
            and a.attname in ('paid_piastres', 'confirmation_fee_piastres')) = 2
         and (select count(*) from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass and c.convalidated
                and c.conname in ('orders_paid_range', 'orders_confirmation_fee_range')) = 2
         and pg_catalog.has_column_privilege('zell_order_definer', 'public.orders', 'paid_piastres', 'UPDATE')
         and not pg_catalog.has_column_privilege('zell_order_definer', 'public.orders', 'confirmation_fee_piastres', 'UPDATE')
         and not pg_catalog.has_column_privilege('zell_order_definer', 'public.orders', 'total_piastres', 'UPDATE'),
         null
  union all
  select 'V03', 'functions: 24 zell_payment_* (3 trigger owned by postgres, 21 by zell_order_definer), search_path empty',
         (select count(*) from procs) = 24
         and (select count(*) from procs where procs.proconfig @> array['search_path=""']) = 24
         and (select count(*) from procs join trg on trg.name = procs.proname where procs.owner = 'postgres') = 3
         and (select count(*) from procs where procs.owner = 'zell_order_definer') = 21,
         (select count(*) from procs)::text
  union all
  select 'V04', 'EXECUTE: the 10 public for authenticated (security definer), none for anon / service_role',
         (select count(*) from procs where pg_catalog.has_function_privilege('authenticated', procs.oid, 'EXECUTE')) = 10
         and (select count(*) from procs join pub on pub.name = procs.proname
               where pg_catalog.has_function_privilege('authenticated', procs.oid, 'EXECUTE') and procs.prosecdef) = 10
         and not exists (select 1 from procs where pg_catalog.has_function_privilege('anon', procs.oid, 'EXECUTE')
                                                 or pg_catalog.has_function_privilege('service_role', procs.oid, 'EXECUTE')),
         null
  union all
  select 'V05', 'triggers: orders_money_guard + append-only (payments, config log, commands) + settings guard, enabled',
         (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
           where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled = 'O'
             and g.tgname in ('orders_money_guard', 'order_payments_immutable', 'order_payments_no_truncate',
                              'zell_payment_config_log_immutable', 'zell_payment_config_log_no_truncate',
                              'zell_payment_settings_guard', 'zell_payment_settings_no_truncate',
                              'zell_payment_commands_immutable', 'zell_payment_commands_no_truncate')) = 9,
         null
  union all
  select 'V06', 'zell_create_order: one (14 args), P1 body (md5), security definer, service_role only, owner can compute the fee',
         (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') = 1
         and (select pg_catalog.md5(co.prosrc) from co) = '811d4d573d750db9c7e5164799536aa6'
         and (select pg_catalog.has_function_privilege('service_role', co.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('anon', co.oid, 'EXECUTE')
                     and not pg_catalog.has_function_privilege('authenticated', co.oid, 'EXECUTE')
                     and pg_catalog.has_function_privilege(co.owner, 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')
                from co),
         (select pg_catalog.md5(co.prosrc) from co)
  union all
  select 'V07', 'transition rules in place (deposit 45419 + balance 45420), A1 intact (24 zell_order_*, 11 public)',
         (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
           where p.oid = pg_catalog.to_regprocedure('public.zell_order_apply_transition(public.orders, text, uuid, text)')) = '4d7c514ebe1d12281a81b63991df2324'
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') = 24
         and (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%'
                and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 11,
         null
  union all
  select 'V08', 'settings: exactly one row; saved fee config is valid (normalizes to itself)',
         (select count(*) from public.zell_payment_settings) = 1
         and (select public.zell_payment_validate_fee(s.confirmation_fee) = s.confirmation_fee from public.zell_payment_settings s),
         (select s.confirmation_fee::text from public.zell_payment_settings s)
  union all
  select 'V09', 'paid_piastres = sum(payments) - sum(refunds) for every order, = last paid_after, 0 <= paid <= total (ر٤)',
         not exists (select 1 from money m where m.paid_piastres <> m.net or (m.last_after is not null and m.last_after <> m.paid_piastres))
         and not exists (select 1 from public.orders o where o.paid_piastres < 0 or o.paid_piastres > o.total_piastres
                           or o.confirmation_fee_piastres < 0 or o.confirmation_fee_piastres > o.total_piastres),
         (select pg_catalog.string_agg(m.id::text, ',') from money m where m.paid_piastres <> m.net)
  union all
  select 'V10', 'payments: every row has its event (payment_recorded / payment_refunded)',
         (select count(*) from public.order_payments)
           = (select count(*) from public.order_events e where e.kind in ('payment_recorded', 'payment_refunded')),
         null
  union all
  select 'V11', 'catalog 0021-P: 31 capabilities, the 2 new ones (sales / owner), admin_today 23, every active admin holds payments_record',
         (select count(*) from public.erp_capabilities) = 31
         and exists (select 1 from public.erp_capabilities c where c.key = 'zell.orders.payments_record' and c.category = 'sales')
         and exists (select 1 from public.erp_capabilities c where c.key = 'zell.orders.payments_admin' and c.category = 'owner')
         and exists (select 1 from public.erp_preset_items i where i.preset_key = 'zell.admin_today' and i.capability_key = 'zell.orders.payments_record')
         and (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') = 23
         and not exists (select 1 from public.erp_user_grants g where g.capability_key = 'zell.orders.payments_admin')
         and not exists (select 1 from public.admin_users a where a.role = 'admin' and a.is_active
                           and not exists (select 1 from public.erp_user_grants g where g.user_id = a.user_id
                                             and g.capability_key = 'zell.orders.payments_record')),
         null
  union all
  select 'V12', 'fee calc spot checks (scope, methods, cap, rounding)',
         public.zell_payment_fee_calc('{"enabled": true, "scope": "all", "method": "percent", "percent_bp": 1000}', 123456, 0, false, false) = 12400
         and public.zell_payment_fee_calc('{"enabled": true, "scope": "made_to_measure", "method": "shipping", "shipping_fallback_piastres": 3000}', 80000, 0, true, false) = 3000
         and public.zell_payment_fee_calc('{"enabled": true, "scope": "all", "method": "fixed", "fixed_piastres": 900000}', 80000, 0, false, false) = 80000
         and public.zell_payment_fee_calc('{"enabled": false}', 80000, 5000, true, true) = 0,
         null
  union all
  select 'V13', 'commands: every payment / refund row has its command (same order, operation payment / refund); results are objects',
         not exists (select 1 from public.order_payments p
                      where not exists (select 1 from public.zell_payment_commands c
                                         where c.command_id = p.command_id and c.order_id = p.order_id
                                           and (c.operation = p.kind or (p.kind = 'payment' and c.operation = 'deliver'))))
         and not exists (select 1 from public.zell_payment_commands c
                          where pg_catalog.jsonb_typeof(c.result) <> 'object' or (c.result ->> 'replay')::boolean is distinct from false),
         (select pg_catalog.string_agg(p.command_id::text, ',') from public.order_payments p
           where not exists (select 1 from public.zell_payment_commands c where c.command_id = p.command_id))
)
select 0::integer as ord,
       'summary'::text as kind,
       null::text as check_id,
       null::text as check_name,
       null::boolean as ok,
       null::text as detail,
       case when (select bool_and(coalesce(c.ok, false)) from checks c) and (select count(*) from checks) = 13 then 'PASS' else 'FAIL' end as verdict,
       (select count(*) from public.orders) as orders_total,
       (select count(*) from public.order_payments) as payments,
       (select (s.confirmation_fee ->> 'enabled')::boolean from public.zell_payment_settings s) as fee_enabled,
       (select s.customer_credit_enabled from public.zell_payment_settings s) as credit_enabled,
       (select count(*) from public.zell_payment_methods m where not m.is_archived) as methods,
       (select co.owner from co) as create_order_owner,
       (select count(*) from public.zell_payment_commands) as commands
union all
select (row_number() over (order by c.id))::integer, 'check', c.id, c.name, coalesce(c.ok, false), c.detail,
       null, null, null, null, null, null, null, null
  from checks c
order by 1;

rollback;
