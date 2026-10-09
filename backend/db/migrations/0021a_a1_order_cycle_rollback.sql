-- 0021-A A1 — الرجوع عن 0021a_a1_order_cycle.sql
--
-- • بيرفض (ومابيغيّرش حاجة) لو: مش متطبّق · البوابة مفتوحة · فيه أحداث غير created · فيه سطر في zell_order_config_log
--   (يعني البوابة اتفتحت قبل كده أو الفترات اتعدّلت) · فيه طلب حالته preparing أو refused · أي عمود من الأربعة الجداد مش فاضي.
--   الرجوع بعد استخدام حقيقي = قرار منفصل (السجل بيضيع)، مش الملف ده.
-- • بيرجّع قيد الحالة بتعريفه القديم بالحرف (من تعليق القيد)، وبيشيل الـ triggers والـ policies والصلاحيات والأعمدة والجداول
--   والدوال والدور. أحداث created بس بتتمسح مع جدولها (مالهاش قيمة من غير الدورة).
-- • ⚠ بموافقة صريحة بس، بعد backup، وقت طلبات قليلة (قفل ACCESS EXCLUSIVE على orders لثواني).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '50s';

do $a1rb$
declare
  v_comment text;
  v_def text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0021A1_RB_WRONG_CALLER';
  end if;
  if pg_catalog.to_regrole('zell_order_definer') is null or pg_catalog.to_regclass('public.order_events') is null
     or pg_catalog.to_regclass('public.zell_order_gate') is null or pg_catalog.to_regclass('public.zell_order_config_log') is null
     or pg_catalog.to_regclass('public.order_status_transitions') is null or pg_catalog.to_regclass('public.order_delivery_periods') is null then
    raise exception 'ZELL_0021A1_RB_NOT_APPLIED';
  end if;
  lock table public.orders in share row exclusive mode;
  if exists (select 1 from public.zell_order_gate g where g.is_open) then
    raise exception 'ZELL_0021A1_RB_GATE_OPEN';
  end if;
  if exists (select 1 from public.order_events e where e.kind <> 'created') then
    raise exception 'ZELL_0021A1_RB_EVENTS_IN_USE';
  end if;
  if exists (select 1 from public.zell_order_config_log) then
    raise exception 'ZELL_0021A1_RB_CONFIG_IN_USE';
  end if;
  if exists (select 1 from public.orders o where o.status in ('preparing', 'refused')) then
    raise exception 'ZELL_0021A1_RB_NEW_STATUSES';
  end if;
  if exists (select 1 from public.orders o
              where o.next_follow_up_at is not null or o.delivery_confirmed_date is not null
                 or o.delivery_confirmed_period is not null or o.delivery_confirmed_note is not null) then
    raise exception 'ZELL_0021A1_RB_COLUMNS_IN_USE';
  end if;
  select pg_catalog.obj_description(c.oid, 'pg_constraint') into v_comment
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check' and c.contype = 'c';
  if v_comment is null or v_comment not like 'zell-0021a1-previous: CHECK %' then
    raise exception 'ZELL_0021A1_RB_PREVIOUS_STATUS_CHECK';
  end if;
  v_def := pg_catalog.substr(v_comment, pg_catalog.char_length('zell-0021a1-previous: ') + 1);
  if v_def not like '%''new''%' or v_def not like '%''confirmed''%' or v_def not like '%''shipped''%'
     or v_def not like '%''delivered''%' or v_def not like '%''cancelled''%'
     or v_def like '%''preparing''%' or v_def like '%''refused''%' or v_def like '%;%' then
    raise exception 'ZELL_0021A1_RB_PREVIOUS_STATUS_CHECK';
  end if;

  -- orders: الـ triggers والـ policies والصلاحيات والأعمدة، والقيد القديم بالحرف.
  drop trigger orders_status_guard on public.orders;
  drop trigger orders_created_event on public.orders;
  drop policy zell_order_definer_select on public.orders;
  drop policy zell_order_definer_update on public.orders;
  revoke update (status, updated_at, customer_name, customer_phone, address, notes, internal_notes,
                 next_follow_up_at, delivery_confirmed_date, delivery_confirmed_period, delivery_confirmed_note)
    on table public.orders from zell_order_definer;
  revoke all on table public.orders from zell_order_definer;
  alter table public.orders
    drop constraint orders_delivery_confirmed_shape,
    drop column next_follow_up_at,
    drop column delivery_confirmed_date,
    drop column delivery_confirmed_period,
    drop column delivery_confirmed_note;
  execute 'alter table public.orders drop constraint orders_status_check, add constraint orders_status_check ' || v_def;

  -- الجداول الجديدة (triggers والـ policies والـ sequences بتتشال معاها).
  drop table public.order_events;
  drop table public.zell_order_config_log;
  drop table public.zell_order_gate;
  drop table public.order_delivery_periods;
  drop table public.order_status_transitions;

  -- الدوال: بتاعة الدور تحت SET LOCAL ROLE (العضوية من غير inherit)، وبعدين بتاعة postgres.
  execute 'set local role zell_order_definer';
  drop function public.zell_order_trg_created_event();
  drop function public.zell_order_set_gate(boolean, text);
  drop function public.zell_order_gate_state();
  drop function public.zell_order_save_delivery_periods(timestamptz, jsonb);
  drop function public.zell_order_delivery_periods();
  drop function public.zell_order_events(integer);
  drop function public.zell_order_set_internal_note(integer, timestamptz, text);
  drop function public.zell_order_edit_details(integer, timestamptz, jsonb);
  drop function public.zell_order_set_confirmed_delivery(integer, timestamptz, date, text, text);
  drop function public.zell_order_set_follow_up(integer, timestamptz, timestamptz, text);
  drop function public.zell_order_record_call(integer, timestamptz, text, text, timestamptz);
  drop function public.zell_order_transition(integer, timestamptz, text, text);
  drop function public.zell_order_result(integer);
  drop function public.zell_order_apply_transition(public.orders, text, uuid, text);
  drop function public.zell_order_text(text, integer);
  drop function public.zell_order_lock(integer, timestamptz);
  drop function public.zell_order_gate_is_open();
  drop function public.zell_order_actor(boolean);
  drop function public.zell_order_claims_actor();
  execute 'reset role';
  drop function public.zell_order_trg_status_guard();
  drop function public.zell_order_admin_role(uuid);
  drop function public.zell_order_trg_gate_guard();
  drop function public.zell_order_trg_events_immutable();
  drop function public.zell_order_trg_append_only();

  revoke usage on schema public from zell_order_definer;
  drop role zell_order_definer;

  -- postflight
  if pg_catalog.to_regrole('zell_order_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%')
     or exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped
                  and a.attname in ('next_follow_up_at', 'delivery_confirmed_date', 'delivery_confirmed_period', 'delivery_confirmed_note'))
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.orders'::regclass
                  and t.tgname in ('orders_status_guard', 'orders_created_event'))
     or exists (select 1 from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'orders'
                  and p.policyname like 'zell\_order\_definer\_%')
     or (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check') is distinct from v_def then
    raise exception 'ZELL_0021A1_RB_POSTFLIGHT';
  end if;
end
$a1rb$;

commit;
