#!/usr/bin/env bash
# 0021-A P1 — اختبار SQL الدائم في CI: Postgres 17 مؤقت + shim الـ CI بتاع 0021-D بالحرف (products · product_widths
# · settings · coupons من 0019 · orders · order_items + الدالتين من 0019) وفوقه الملفات الحقيقية: 0021-P (المحرك + المحوّل)
# ← A1 ← D، وبعدين P1.
# بيغطي: شكل المعاملة · md5 الجسم · ptest (ci + production) · التطبيق · رفض الإعادة · الـ verify (P1 · A1 · D · 0021-P
# بالكتالوج الجديد والمطابقة strict) · مقارنة zell_create_order قديم (D) / جديد على مصفوفة 520 حالة بإعدادات رسوم متغيّرة ·
# مقارنة حساب الرسوم DB = core (packages/core/src/confirmationFee.ts) على آلاف الحالات · سيناريوهات الدفع والرد والمقدم
# والتسليم والآجل · rollback (رفض بالفلوس، ونضيف) وإعادة التطبيق · rollback 0021-P بعد P1 · حارس الانحراف والموافقة.
# ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
set -uo pipefail

if [ "$(printenv ZELL_CI_DISPOSABLE_DB)" != "yes" ]; then
  echo "refusing: disposable CI database only" >&2
  exit 2
fi
case "$(printenv PGHOST)" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIG="$ROOT/backend/db/migrations"
CIDIR="$ROOT/backend/db/ci"
OLD19="$MIG/0019_coupons.sql"
A1="$MIG/0021a_a1_order_cycle.sql"
A1VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
DAPPLY="$MIG/0021d_preferred_delivery.sql"
DVERIFY="$MIG/0021d_preferred_delivery_verify.sql"
ENGINE="$MIG/0021p_erp_access.sql"
ADAPTER="$MIG/0021p_zell_erp_access.sql"
PVERIFY="$MIG/0021p_access_verify.sql"
PROLLBACK="$MIG/0021p_access_rollback.sql"
APPLY="$MIG/0021a_p1_payments.sql"
PTEST="$MIG/0021a_p1_payments_ptest.sql"
VERIFY="$MIG/0021a_p1_payments_verify.sql"
ROLLBACK="$MIG/0021a_p1_payments_rollback.sql"
FLOWS="$CIDIR/0021p1_flows.sql"
FEEJS="$CIDIR/0021p1_fee_parity.mjs"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
NEW_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb'
OLD_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text'
D_MD5='c131cb51cd86830e9445b139296b0281'
P1_MD5='811d4d573d750db9c7e5164799536aa6'
A1T_MD5='aa7cc01c2320cb97d76845d63413886c'
P1T_MD5='4d7c514ebe1d12281a81b63991df2324'
# B1 (مراجعة #122): مالك zell_create_order في الـ shim. الافتراضي zell_order_writer، وتشغيلة تانية بـ postgres = شكل Production
# (08-HANDOFF-NOW). الاتنين لازم PASS.
CO_OWNER="$(printenv ZELL_P1_CO_OWNER || echo zell_order_writer)"
case "$CO_OWNER" in
  zell_order_writer|postgres) ;;
  *) echo "refusing: ZELL_P1_CO_OWNER must be zell_order_writer or postgres" >&2; exit 2 ;;
esac
echo "CO_OWNER=$CO_OWNER"

record() {
  if [ "$2" = "yes" ]; then
    echo "CASE PASS $1"
    PASS=$((PASS + 1))
  else
    echo "CASE FAIL $1 :: $3"
    FAIL=$((FAIL + 1))
  fi
}

su_sql() { psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$1" -c "$2" > /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
# الدالة بالحرف من ملف: من سطر البداية لحد سطر $function$ لوحده، وبعدها ;
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
extract_from() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$2"; echo ';'; }
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
apply_p1() { run_approved "$APPLY" 'ci-0021a-p1' "$TMP/apply.out"; }
rollback_p1() { run_approved "$ROLLBACK" 'ci-0021a-p1-rollback' "$TMP/rb.out"; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
ptest_text() { sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = '$1';/" "$PTEST"; }
run_ptest() { ptest_text "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/ptest.out" 2>&1; }
verify_p1() { run_file "$VERIFY" "$TMP/verify.out"; summary_of "$TMP/verify.out"; }
verify_a1() { run_file "$A1VERIFY" "$TMP/a1v.out"; summary_of "$TMP/a1v.out"; }
verify_d() { run_file "$DVERIFY" "$TMP/dv.out"; summary_of "$TMP/dv.out"; }
verify_p() { run_file "$PVERIFY" "$TMP/pv.out"; summary_of "$TMP/pv.out"; }

init_cluster() {
  psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d postgres > /dev/null <<'SQL'
do $r$
begin
  if pg_catalog.to_regrole('postgres') is null then create role postgres login createrole nosuperuser password 'ci'; end if;
  if pg_catalog.to_regrole('service_role') is null then create role service_role nologin noinherit bypassrls; end if;
  if pg_catalog.to_regrole('anon') is null then create role anon nologin noinherit; end if;
  if pg_catalog.to_regrole('authenticated') is null then create role authenticated nologin noinherit; end if;
  if pg_catalog.to_regrole('authenticator') is null then create role authenticator login noinherit password 'ci'; end if;
  if pg_catalog.to_regrole('zell_order_writer') is null then create role zell_order_writer nologin nobypassrls; end if;
end
$r$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant zell_order_writer to postgres with inherit true, set true;
SQL
}

# shim الـ CI بتاع 0021-D بالحرف (0021d_sql_ci.sh) + مالك وأدمن شغالين وأدمن موقوف، وبعدين 0021-P ← A1 ← D.
reset_db() {
  su_sql postgres "drop database if exists $DB with (force)"
  su_sql postgres "drop role if exists zell_order_definer"
  su_sql postgres "drop role if exists zell_erp_definer"
  su_sql postgres "drop role if exists erp_definer"
  su_sql postgres "create database $DB owner postgres"
  su_sql "$DB" "alter schema public owner to postgres"
  su_sql "$DB" "revoke create on schema public from public"
  su_sql "$DB" "grant usage on schema public to anon, authenticated, service_role, zell_order_writer"
  {
    cat <<'SQL'
create table public.admin_users (
  user_id uuid primary key, role text not null check (role in ('owner', 'admin')),
  is_active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.products (
  id serial primary key, name_ar text not null, image_url text,
  price_per_meter_piastres integer not null check (price_per_meter_piastres > 0),
  width_cm integer not null default 50, min_length_cm integer not null default 100, step_cm integer not null default 50,
  max_length_cm integer not null default 3000, is_active boolean not null default true,
  sale_unit text not null default 'meter', max_quantity integer not null default 1
);
create table public.product_widths (
  id serial primary key, product_id integer not null references public.products (id), width_cm integer not null,
  price_per_meter_piastres integer not null, is_active boolean not null default true
);
create table public.settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
SQL
    awk '/^create table public.coupons \(/{f = 1} f {print} f && /^\);$/ {exit}' "$OLD19"
    cat <<'SQL'
create table public.orders (
  id serial primary key, order_number text not null unique,
  status text not null default 'new',
  customer_name text not null, customer_phone text not null, governorate text not null, address text not null,
  notes text, internal_notes text,
  subtotal_piastres integer not null, shipping_piastres integer not null default 0, total_piastres integer not null,
  idempotency_key text, request_hash text, checkout_session_hash text,
  receipt_token_hash text, receipt_token_hash_prev text, receipt_expires_at timestamptz,
  shipping_area text, installation_requested boolean not null default false, installation_rate_piastres integer,
  installation_length_cm integer, installation_piastres integer not null default 0, installation_travel_piastres integer not null default 0,
  coupon_id bigint references public.coupons (id), coupon_code text, coupon_kind text, coupon_percent integer,
  coupon_amount_piastres integer, coupon_max_discount_piastres integer, discount_piastres integer not null default 0,
  notified_at timestamptz, notify_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint orders_status_check check (status = any (array['new', 'confirmed', 'shipped', 'delivered', 'cancelled'])),
  constraint orders_internal_notes_length check (internal_notes is null or char_length(internal_notes) <= 2000)
);
create unique index orders_idempotency_key_uidx on public.orders (idempotency_key) where idempotency_key is not null;
create table public.order_items (
  id serial primary key, order_id integer not null references public.orders (id) on delete cascade,
  product_id integer references public.products (id), product_name_ar text not null, product_image_url text,
  unit_price_piastres integer not null, length_cm integer, width_cm integer, line_total_piastres integer not null,
  sale_unit text not null default 'meter', quantity integer not null default 1, created_at timestamptz not null default now()
);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
create function public.zell_orders_cancelled_final() returns trigger language plpgsql set search_path = '' as $f$
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end
$f$;
create trigger orders_cancelled_final before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();
grant select on public.products, public.product_widths, public.settings, public.coupons to zell_order_writer;
grant update on public.coupons to zell_order_writer;
grant select, insert, update on public.orders, public.order_items to zell_order_writer;
grant usage on sequence public.orders_id_seq, public.order_items_id_seq to zell_order_writer;
create policy orders_insert_for_writer on public.orders for insert to zell_order_writer with check (true);
create policy orders_read_for_writer on public.orders for select to zell_order_writer using (true); create policy orders_update_for_writer on public.orders for update to zell_order_writer using (true) with check (true);

insert into public.products (id, name_ar, price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sale_unit, max_quantity) values
  (1, 'فيلم عازل', 30000, 50, 100, 50, 3000, true, 'meter', 1),
  (2, 'فيلم موقوف', 25000, 50, 100, 50, 3000, false, 'meter', 1),
  (3, 'أداة تركيب', 15000, 50, 100, 50, 3000, true, 'piece', 10);
insert into public.product_widths (product_id, width_cm, price_per_meter_piastres, is_active) values (1, 100, 52000, true), (1, 150, 70000, false);
insert into public.settings (key, value) values
  ('shipping_rates', '{"القاهرة": 5000, "الجيزة": 6000, "أسوان": 9000}'),
  ('free_shipping_threshold_piastres', '500000'),
  ('shipping_disabled_governorates', '["أسوان"]'),
  ('shipping_areas', '{"القاهرة": ["المعادي", "مدينة نصر"]}'),
  ('installation', '{"enabled": true, "feePerMeterPiastres": 1500, "areas": {"القاهرة": {"المعادي": 2500, "مدينة نصر": 0}}}'),
  ('coupons_enabled', 'true');
insert into public.admin_users (user_id, role, is_active, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'owner', true, '2026-01-01 00:01+00'),
  ('00000000-0000-0000-0000-00000000000b', 'admin', true, '2026-01-01 00:02+00'),
  ('00000000-0000-0000-0000-00000000000c', 'admin', false, '2026-01-01 00:03+00');
insert into public.coupons (code, kind, percent_off, amount_off_piastres, max_discount_piastres, min_subtotal_piastres, ends_at, max_uses, max_uses_per_phone) values
  ('PCT10', 'percent', 10, null, 5000, 0, null, null, 1),
  ('FIX20', 'fixed', null, 2000, null, 100000, null, null, 1),
  ('OLD10', 'percent', 10, null, null, 0, now() - interval '1 day', null, 1);
SQL
  } | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/shim.out" 2>&1 || { echo "--- shim.out"; cat "$TMP/shim.out"; return 1; }
  {
    extract_fn 'CREATE FUNCTION public.zell_create_order('
    extract_fn 'CREATE OR REPLACE FUNCTION public.zell_get_order_receipt('
    cat <<SQL
alter function public.zell_create_order($OLD_SIG) owner to $CO_OWNER;
revoke all on function public.zell_create_order($OLD_SIG) from public, anon, authenticated;
grant execute on function public.zell_create_order($OLD_SIG) to service_role, zell_order_writer;
alter function public.zell_get_order_receipt(text, text) owner to zell_order_writer;
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;
SQL
  } | psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" > "$TMP/old.out" 2>&1 || { echo "--- old.out"; cat "$TMP/old.out"; return 1; }
  run_file "$ENGINE" "$TMP/engine.out" || { echo "--- engine.out"; tail -n 20 "$TMP/engine.out"; return 1; }
  run_approved "$ADAPTER" 'ci-0021p' "$TMP/adapter.out" || { echo "--- adapter.out"; tail -n 20 "$TMP/adapter.out"; return 1; }
  run_file "$A1" "$TMP/a1.out" || { echo "--- a1.out"; tail -n 20 "$TMP/a1.out"; return 1; }
  run_file "$DAPPLY" "$TMP/d.out" || { echo "--- d.out"; tail -n 20 "$TMP/d.out"; return 1; }
}

# نسخة zell_create_order الحالية (D) في schema لوحدها للمقارنة بعد التطبيق.
load_old_copy() {
  su_sql "$DB" "create schema if not exists ci_old authorization postgres"
  extract_from 'CREATE FUNCTION public.zell_create_order(' "$DAPPLY" | sed '1s/public\.zell_create_order(/ci_old.zell_create_order(/' \
    | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/old_copy.out" 2>&1
}

# استعلام الأثر المعتمد (قراءة بس) — نفس النص في وصف الـ PR بالحرف.
IMPACT_SQL=$(cat <<'SQL'
select
 (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('paid_piastres','confirmation_fee_piastres')) as money_columns,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_payment\_%') as payment_fns,
 (select count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('order_payments','zell_payment_methods','zell_payment_settings','zell_payment_config_log','zell_payment_commands')) as payment_tables,
 (select coalesce(string_agg(pg_catalog.md5(p.prosrc), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order_md5,
 (select coalesce(string_agg(pg_catalog.pg_get_userbyid(p.proowner), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order_owner,
 coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_order_apply_transition(public.orders, text, uuid, text)')), '') as transition_md5,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') as order_fns,
 (select count(*) from public.erp_capabilities) as capabilities,
 (select count(*) from public.erp_preset_items i where i.preset_key = 'zell.admin_today') as admin_today,
 (select count(*) from public.erp_user_grants) as grants,
 (select count(*) from public.orders) as orders_total,
 (select coalesce(string_agg(s.status || '=' || s.n, ',' order by s.status), '') from (select o.status, count(*) as n from public.orders o group by o.status) s) as statuses,
 (select count(*) from public.order_events) as events,
 (select count(*) from pg_catalog.pg_stat_activity where state like 'idle in transaction%' and pid <> pg_catalog.pg_backend_pid()) as idle_tx,
 (select count(*) from pg_catalog.pg_locks where relation = 'public.orders'::regclass and pid <> pg_catalog.pg_backend_pid()) as orders_locks;
SQL
)
impact() { q "$IMPACT_SQL"; }
# صلاحيات EXECUTE على zell_create_order (للمقارنة قبل/بعد التطبيق — B1).
acl_co() { q "select string_agg(x, ',' order by x) from (select distinct pg_get_userbyid(a.grantee) || ':' || a.privilege_type as x from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.zell_create_order($NEW_SIG)'::regprocedure) s"; }

# مصفوفة المقارنة: قديم (D في ci_old) / جديد (P1) بإعداد رسوم بيتغيّر كل حالة — كل نداء في subtransaction بيترجع.
PARITY_SQL=$(cat <<'SQL'
create or replace function pg_temp.ci_try(p_sql text) returns text language plpgsql as $f$
declare
  r jsonb;
  v text;
begin
  begin
    execute p_sql into r;
    v := 'OK ' || (r - 'order_number' - 'receipt_expires_at')::text
         || ' ROW ' || coalesce((select (to_jsonb(o) - 'id' - 'order_number' - 'created_at' - 'updated_at' - 'receipt_expires_at'
                                   - 'confirmation_fee_piastres')::text
                                   from public.orders o where o.order_number = r ->> 'order_number'), 'none')
         || ' ITEMS ' || (select coalesce(jsonb_agg(to_jsonb(i) - 'id' - 'order_id' - 'created_at' order by i.id), '[]'::jsonb)::text
                            from public.order_items i join public.orders o on o.id = i.order_id
                           where o.order_number = r ->> 'order_number')
         || ' |FEE| ' || coalesce((select o.confirmation_fee_piastres || '/' || public.zell_payment_fee_calc(
                                            (select s.confirmation_fee from public.zell_payment_settings s where s.id),
                                            o.total_piastres, o.shipping_piastres,
                                            exists (select 1 from public.order_items i where i.order_id = o.id and i.sale_unit = 'meter'),
                                            o.installation_requested)
                                     from public.orders o where o.order_number = r ->> 'order_number'), 'none');
    raise exception using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then null;
    when others then v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  return v;
end
$f$;
create or replace function pg_temp.ci_call(p_fn text, p_items text, p_gov text, p_area text, p_inst boolean, p_coupon text, p_phone text)
returns text language sql as $f$
  select format('select %s(p_items => %L::jsonb, p_customer_name => %L, p_customer_phone => %L, p_governorate => %L, p_address => %L, '
                || 'p_notes => %L, p_idempotency_key => %L, p_request_hash => %L, p_checkout_session_hash => %L, p_receipt_token_hash => %L%s%s%s)',
                p_fn, p_items, 'عميل المقارنة', p_phone, p_gov, 'عنوان المقارنة طويل كفاية', 'ملاحظة', 'ci-parity-key-' || p_phone,
                repeat('a', 64), repeat('b', 64), repeat('c', 64),
                case when p_area is null then '' else format(', p_area => %L', p_area) end,
                case when p_inst then ', p_installation => true' else '' end,
                case when p_coupon is null then '' else format(', p_coupon_code => %L', p_coupon) end);
$f$;
create temporary table ci_parity (n integer, ok boolean, outcome text, fee_pos boolean, detail text);
do $m$
declare
  carts text[] := array[
    '[{"productId":1,"lengthCm":300}]', '[{"productId":1,"lengthCm":350,"widthCm":100}]', '[{"productId":1,"lengthCm":300,"widthCm":50}]',
    '[{"productId":3,"quantity":2}]', '[{"productId":1,"lengthCm":300},{"productId":3,"quantity":1}]', '[{"productId":1,"lengthCm":2000}]',
    '[{"productId":1,"lengthCm":1000},{"productId":1,"lengthCm":500,"widthCm":100}]', '[{"productId":1,"lengthCm":325}]',
    '[{"productId":2,"lengthCm":300}]', '[{"productId":1,"lengthCm":300,"widthCm":150}]', '[{"productId":3,"quantity":11}]', '[]',
    '[{"productId":3,"quantity":10}]'];
  combos text[] := array['القاهرة||f', 'الجيزة||f', 'القاهرة|المعادي|f', 'القاهرة|المعادي|t', 'القاهرة|مدينة نصر|t', 'الجيزة|المعادي|f', 'أسوان||f', 'القاهرة|الزمالك|f'];
  coupons text[] := array[null, 'PCT10', 'FIX20', 'NOPE1', 'OLD10'];
  cfgs text[] := array[
    '{"enabled": false}',
    '{"enabled": true, "scope": "all", "method": "fixed", "fixed_piastres": 5000}',
    '{"enabled": true, "scope": "made_to_measure", "method": "percent", "percent_bp": 1000}',
    '{"enabled": true, "scope": "with_installation", "method": "shipping", "shipping_fallback_piastres": 3000}',
    '{"enabled": true, "scope": "above_amount", "method": "fixed", "fixed_piastres": 250000, "threshold_piastres": 100000}',
    '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 4000}',
    '{"enabled": true, "scope": "all", "method": "percent", "percent_bp": 3333}'];
  n integer := 0;
  v_old text; v_new text; v_gov text; v_area text; v_inst boolean; v_phone text; v_fee text;
begin
  for i in 1 .. array_length(carts, 1) loop
    for j in 1 .. array_length(combos, 1) loop
      for k in 1 .. array_length(coupons, 1) loop
        n := n + 1;
        update public.zell_payment_settings set confirmation_fee = cfgs[1 + n % array_length(cfgs, 1)]::jsonb where id;
        v_gov := split_part(combos[j], '|', 1);
        v_area := nullif(split_part(combos[j], '|', 2), '');
        v_inst := split_part(combos[j], '|', 3) = 't';
        v_phone := '010' || lpad(n::text, 8, '0');
        v_old := pg_temp.ci_try(pg_temp.ci_call('ci_old.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone));
        v_new := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone));
        v_fee := split_part(v_new, ' |FEE| ', 2);
        insert into ci_parity values (
          n,
          split_part(v_old, ' |FEE| ', 1) = split_part(v_new, ' |FEE| ', 1)
            and (v_old like 'ERR %' or (split_part(split_part(v_old, ' |FEE| ', 2), '/', 1) = '0'
                                        and split_part(v_fee, '/', 1) = split_part(v_fee, '/', 2))),
          split_part(v_old, ' ', 1) || ' ' || split_part(v_old, ' ', 2),
          v_new like 'OK %' and split_part(v_fee, '/', 1) <> '0',
          left(v_old || ' || ' || v_new, 600));
      end loop;
    end loop;
  end loop;
  update public.zell_payment_settings set confirmation_fee = '{"enabled": false}'::jsonb where id;
end
$m$;
select count(*) || '|' || count(*) filter (where not ok) || '|' || count(*) filter (where outcome like 'OK %') || '|'
       || count(*) filter (where fee_pos) || '|' || count(distinct outcome) || '|'
       || coalesce((select detail from ci_parity where not ok order by n limit 1), '')
  from ci_parity;
SQL
)

init_cluster

# ── S0: الشكل ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify + flows" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021A_P1 BODY'); M2=$(body_md5 "$PTEST" '0021A_P1 BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no; if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] \
   && [ "$(grep -c '^begin;$' "$ROLLBACK")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"

# ── S1: ptest قبل التطبيق ──
if ! reset_db; then record "S09 shim + 0019 functions + 0021-P + A1 + D" "no" "see output"; fi
# طلب واحد علشان G01 في الـ ptest يتجرّب فعلًا (B2)، وبيتمسح بعد S13.
q "insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, total_piastres) values ('FLM-PT0001', 'زبون الاختبار', '01099998888', 'القاهرة', 'عنوان اختبار طويل كفاية', 20000, 20000)" > /dev/null
BEFORE=$(impact)
ok=no; if [ "$(rf "$BEFORE" 1)|$(rf "$BEFORE" 2)|$(rf "$BEFORE" 4)|$(rf "$BEFORE" 6)|$(rf "$BEFORE" 8)|$(rf "$BEFORE" 9)" = "0|0|$D_MD5|$A1T_MD5|29|22" ]; then ok=yes; fi
record "S10 baseline = Production shape before P1 (D body, A1 transition, catalog 29 / 22)" "$ok" "$BEFORE"
run_ptest ci; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 7)" = "ci" ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 9)" = "0" ] && [ "$(rf "$S" 8)" = "33" ] && [ "$(rf "$S" 13)" = "" ]; then ok=yes; fi
record "S11 ptest ci profile -> PASS (33 pass, no skips)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
run_ptest production; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 8)" = "32" ] && [ "$(rf "$S" 13)" = "O00" ]; then ok=yes; fi
record "S12 ptest production profile -> PASS (32 pass), expected skip O00" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out")"
ok=no; if [ "$(impact)" = "$BEFORE" ]; then ok=yes; fi
record "S13 ptest leaves nothing behind" "$ok" "before=$BEFORE after=$(impact)"
q "delete from public.orders where order_number = 'FLM-PT0001'" > /dev/null

# ── S2: التطبيق ──
load_old_copy
q "insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, total_piastres) values ('FLM-OLD001', 'زبون قديم', '01099999999', 'القاهرة', 'عنوان قديم طويل كفاية', 30000, 35000)" > /dev/null
PRE=$(impact)
psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$APPLY" > "$TMP/noapproval.out" 2>&1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/noapproval.out" 'ZELL_0021A_P1_APPROVAL_MISSING' && [ "$(impact)" = "$PRE" ]; then ok=yes; fi
record "S20 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
ACL_PRE=$(acl_co)
apply_p1; E=$?
AFTER=$(impact)
EXP="2|24|5|$P1_MD5|$CO_OWNER|$P1T_MD5|24|31|23|$(( $(rf "$PRE" 10) + 1 ))|$(rf "$PRE" 11)|$(rf "$PRE" 12)|$(rf "$PRE" 13)|0|0"
ok=no; if [ "$E" -eq 0 ] && [ "$AFTER" = "$EXP" ]; then ok=yes; fi
record "S21 apply -> impact (columns, 24 functions, 5 tables, new create_order body + owner kept, transition, catalog 31/23, +1 grant, orders untouched)" "$ok" "E=$E pre=$PRE after=$AFTER exp=$EXP $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
apply_p1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021A_P1_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S22 re-apply refused (ALREADY_APPLIED)" "$ok" "E=$E"
V=$(verify_p1)
ok=no; if [ "$(rf "$V" 7)" = "PASS" ] && [ "$(rf "$V" 9)" = "0" ] && [ "$(rf "$V" 10)" = "f" ] && [ "$(rf "$V" 11)" = "f" ] && [ "$(rf "$V" 12)" = "4" ] && [ "$(rf "$V" 13)" = "$CO_OWNER" ]; then ok=yes; fi
record "S23 P1 verify -> PASS (no payments, fee off, credit off, 4 methods, owner kept)" "$ok" "V=$V fails=$(fails_of "$TMP/verify.out")"
run_ptest ci; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021A_P1_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S24 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"
A1V=$(verify_a1); DV=$(verify_d); PV=$(verify_p)
ok=no; if [ "$(rf "$A1V" 7)" = "PASS" ] && [ "$(rf "$DV" 7)" = "PASS" ] && [ "$(rf "$PV" 11)" = "PASS" ]; then ok=yes; fi
record "S25 A1 + D + 0021-P verify still PASS after P1 (0021-P: catalog 31, parity strict clean)" "$ok" "A1=$A1V D=$DV P=$PV $(fails_of "$TMP/pv.out")"
ACL_NEW=$(acl_co)
ok=no; if [ -n "$ACL_PRE" ] && [ "$ACL_NEW" = "$ACL_PRE" ] && printf '%s' "$ACL_NEW" | grep -q 'service_role:EXECUTE' \
   && ! printf '%s' "$ACL_NEW" | grep -Eq '(^|,)(anon|authenticated|unknown)'; then ok=yes; fi
record "S26 zell_create_order EXECUTE grants kept exactly (owner $CO_OWNER)" "$ok" "pre=$ACL_PRE new=$ACL_NEW"
CO=$(q "select pg_get_userbyid(p.proowner) || '|' || p.prosecdef::int || '|' || has_function_privilege(p.proowner, 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')::int || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE')::int || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::int || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::int || '|' || has_function_privilege('authenticated', 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')::int || '|' || has_function_privilege('service_role', 'public.zell_payment_order_fee(integer, integer, boolean, boolean)', 'EXECUTE')::int from pg_proc p where p.oid = 'public.zell_create_order($NEW_SIG)'::regprocedure")
ok=no; if [ "$CO" = "$CO_OWNER|1|1|1|0|0|0|0" ]; then ok=yes; fi
record "S28 zell_create_order owner $CO_OWNER: security definer, owner can compute the fee, service_role only; fee fn closed to anon/authenticated/service_role" "$ok" "co=$CO"
OLDROW=$(q "select paid_piastres || '|' || confirmation_fee_piastres || '|' || total_piastres || '|' || status from public.orders where order_number = 'FLM-OLD001'")
ok=no; if [ "$OLDROW" = "0|0|35000|new" ]; then ok=yes; fi
record "S27 existing order: paid 0, fee 0, total and status untouched" "$ok" "$OLDROW"

# ── S3: مقارنة zell_create_order قديم (D) / جديد (P1) ──
P=$(printf '%s\n' "$PARITY_SQL" | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1 | tail -n 1)
ok=no; if [ "$(rf "$P" 1)" -ge 520 ] 2>/dev/null && [ "$(rf "$P" 2)" = "0" ] && [ "$(rf "$P" 3)" -ge 60 ] 2>/dev/null && [ "$(rf "$P" 4)" -ge 30 ] 2>/dev/null && [ "$(rf "$P" 5)" -ge 6 ] 2>/dev/null; then ok=yes; fi
record "S30 parity matrix: old = new except the fee column (amounts, rows, items, rejections); fee = DB calc; old fee 0" "$ok" "cases|mismatches|ok_orders|fee_positive|distinct_outcomes|first_mismatch = $P"

# ── S4: حساب الرسوم DB = core ──
if node --experimental-strip-types "$FEEJS" > "$TMP/fee.tsv" 2> "$TMP/fee.err"; then
  q "create schema if not exists ci_p1; drop table if exists ci_p1.fee; create table ci_p1.fee (cfg jsonb, total integer, ship integer, mtm boolean, inst boolean, expected integer)" > /dev/null
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "\copy ci_p1.fee from '$TMP/fee.tsv' with (format text)" > "$TMP/fee_copy.out" 2>&1
  F=$(q "select count(*) || '|' || count(*) filter (where public.zell_payment_fee_calc(cfg, total, ship, mtm, inst) is distinct from expected) || '|' || count(*) filter (where expected > 0) || '|' || count(distinct cfg) || '|' || coalesce((select f2.cfg::text || ' ' || f2.total || ' ' || f2.ship || ' ' || f2.mtm || ' ' || f2.inst || ' core=' || f2.expected || ' db=' || public.zell_payment_fee_calc(f2.cfg, f2.total, f2.ship, f2.mtm, f2.inst) from ci_p1.fee f2 where public.zell_payment_fee_calc(f2.cfg, f2.total, f2.ship, f2.mtm, f2.inst) is distinct from f2.expected limit 1), '') from ci_p1.fee")
else
  F="node failed: $(tail -n 5 "$TMP/fee.err" | tr '\n' ' ')"
fi
ok=no; if [ "$(rf "$F" 1)" -ge 5000 ] 2>/dev/null && [ "$(rf "$F" 2)" = "0" ] && [ "$(rf "$F" 3)" -ge 2000 ] 2>/dev/null && [ "$(rf "$F" 4)" -ge 50 ] 2>/dev/null; then ok=yes; fi
record "S40 fee calc: DB (zell_payment_fee_calc) = core (confirmationFeePiastres) on thousands of cases" "$ok" "cases|mismatches|positive|configs|first = $F $(tail -n 3 "$TMP/fee_copy.out" 2>/dev/null | tr '\n' ' ')"

# ── S5: سيناريوهات الدفع ──
run_file "$FLOWS" "$TMP/flows.out"; E=$?; S=$(summary_of "$TMP/flows.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "42" ]; then ok=yes; fi
record "S50 payment flows: record / refund / idempotency (+ fingerprint after normalization, command log + original snapshot) / deposit rule / delivery collection / credit / cancelled / guards / methods / create_order snapshot" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/flows.out") tail=$(tail -n 3 "$TMP/flows.out" | tr '\n' ' ' | cut -c1-600)"
V=$(verify_p1)
ok=no; if [ "$(rf "$V" 7)" = "PASS" ] && [ "$(rf "$V" 9)" = "0" ] && [ "$(rf "$V" 14)" = "0" ]; then ok=yes; fi
record "S51 flows left nothing behind (verify PASS, 0 payments, 0 commands)" "$ok" "V=$V"

# ── S6: rollback بفلوس مسجّلة = رفض ──
cat > "$TMP/pay1.sql" <<'SQL'
do $x$
declare
  v_id integer;
  v_ver timestamptz;
begin
  insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, total_piastres)
  values ('FLM-RB0001', 'زبون الرجوع', '01099990000', 'القاهرة', 'عنوان طويل كفاية', 10000, 10000)
  returning id, updated_at into v_id, v_ver;
  perform pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.zell_payment_record('00000000-0000-4000-8000-000000009001'::uuid, v_id, v_ver, 1000, 'balance', 1);
  execute 'reset role';
end
$x$;
SQL
run_file "$TMP/pay1.sql" "$TMP/pay1.out"; E1=$?
MID=$(impact)
rollback_p1; E=$?
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A_P1_RB_HAS_MONEY_DATA' && [ "$(impact)" = "$MID" ]; then ok=yes; fi
record "S60 rollback with a recorded payment -> refused (HAS_MONEY_DATA), nothing changed" "$ok" "E1=$E1 E=$E $(tail -n 3 "$TMP/pay1.out" | tr '\n' ' ')"

# ── S6ب: rollback بأمر تسليم آجل من غير أي دفعة = رفض (مراجعة #122) ──
if ! reset_db; then record "S61 reset" "no" "see output"; fi
load_old_copy
apply_p1 > /dev/null
cat > "$TMP/pay2.sql" <<'SQL'
do $x$
declare
  v_id integer;
  v_ver timestamptz;
begin
  update public.zell_payment_settings set customer_credit_enabled = true where id;
  insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, total_piastres)
  values ('FLM-RB0002', 'زبون الآجل', '01099990001', 'القاهرة', 'عنوان طويل كفاية', 10000, 10000)
  returning id, updated_at into v_id, v_ver;
  perform pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.zell_order_transition(v_id, v_ver, 'confirmed');
  execute 'reset role';
  select o.updated_at into v_ver from public.orders o where o.id = v_id;
  execute 'set local role authenticated';
  perform public.zell_order_transition(v_id, v_ver, 'shipped');
  execute 'reset role';
  select o.updated_at into v_ver from public.orders o where o.id = v_id;
  execute 'set local role authenticated';
  perform public.zell_payment_deliver_order(p_command_id => '00000000-0000-4000-8000-000000009002'::uuid, p_order_id => v_id,
                                            p_expected_updated_at => v_ver, p_on_credit => true);
  execute 'reset role';
  if exists (select 1 from public.order_payments) or (select count(*) from public.zell_payment_commands) <> 1
     or (select o.status from public.orders o where o.id = v_id) <> 'delivered' then
    raise exception 'ZELL_CI_S61_SETUP';
  end if;
end
$x$;
SQL
run_file "$TMP/pay2.sql" "$TMP/pay2.out"; E1=$?
MID=$(impact)
rollback_p1; E=$?
CNT=$(q "select (select count(*) from public.order_payments) || '|' || (select count(*) from public.zell_payment_commands)")
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A_P1_RB_HAS_MONEY_DATA' && [ "$(impact)" = "$MID" ] && [ "$CNT" = "0|1" ]; then ok=yes; fi
record "S61 rollback with a command but no payment (explicit on-credit delivery) -> refused (HAS_MONEY_DATA), nothing changed" "$ok" "E1=$E1 E=$E CNT=$CNT $(tail -n 3 "$TMP/pay2.out" | tr '\n' ' ')"

# ── S6ج: rollback بسطر في سجل الإعدادات بس (من غير فلوس ولا أوامر) = رفض (مراجعة #122 B3) ──
if ! reset_db; then record "S62 reset" "no" "see output"; fi
load_old_copy
apply_p1 > /dev/null
cat > "$TMP/cfg1.sql" <<'SQL'
do $x$
declare
  v_ver timestamptz;
begin
  select s.updated_at into v_ver from public.zell_payment_settings s where s.id;
  perform pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.zell_payment_save_settings(v_ver, '{"enabled": false}'::jsonb, false, 'فودافون كاش 01000000000');
  execute 'reset role';
  if (select count(*) from public.zell_payment_config_log) <> 1 or exists (select 1 from public.order_payments)
     or exists (select 1 from public.zell_payment_commands) then
    raise exception 'ZELL_CI_S62_SETUP';
  end if;
end
$x$;
SQL
run_file "$TMP/cfg1.sql" "$TMP/cfg1.out"; E1=$?
MID=$(impact)
rollback_p1; E=$?
CNT=$(q "select (select count(*) from public.zell_payment_config_log) || '|' || (select count(*) from public.order_payments) || '|' || (select count(*) from public.zell_payment_commands)")
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A_P1_RB_HAS_CONFIG_DATA' && [ "$(impact)" = "$MID" ] && [ "$CNT" = "1|0|0" ]; then ok=yes; fi
record "S62 rollback with a settings log row only (no money, no commands) -> refused (HAS_CONFIG_DATA), nothing changed" "$ok" "E1=$E1 E=$E CNT=$CNT $(tail -n 3 "$TMP/cfg1.out" | tr '\n' ' ')"

# ── S7: rollback نضيف ثم إعادة التطبيق ──
if ! reset_db; then record "S70 reset" "no" "see output"; fi
load_old_copy
PRE=$(impact)
AUD0=$(q "select count(*) from public.erp_access_audit")
apply_p1 > /dev/null
rollback_p1; E=$?
RB=$(impact)
AUD1=$(q "select count(*) from public.erp_access_audit")
ok=no; if [ "$E" -eq 0 ] && [ "$RB" = "$PRE" ] && [ "$AUD1" = "$((AUD0 + 2))" ]; then ok=yes; fi
record "S70 clean rollback -> back to the exact pre-apply shape (D body, A1 transition, catalog 29/22, grants), audit +1 grant +1 revoke" "$ok" "E=$E pre=$PRE rb=$RB audit=$AUD0->$AUD1 $(grep -m3 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"
A1V=$(verify_a1); DV=$(verify_d); PV=$(verify_p)
ok=no; if [ "$(rf "$A1V" 7)" = "PASS" ] && [ "$(rf "$DV" 7)" = "PASS" ] && [ "$(rf "$PV" 11)" = "PASS" ]; then ok=yes; fi
record "S71 after rollback: A1 + D + 0021-P (29, parity clean) verify PASS" "$ok" "A1=$A1V D=$DV P=$PV $(fails_of "$TMP/pv.out")"
apply_p1; E=$?; V=$(verify_p1)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$V" 7)" = "PASS" ]; then ok=yes; fi
record "S72 re-apply after rollback -> verify PASS" "$ok" "E=$E V=$V fails=$(fails_of "$TMP/verify.out")"

# ── S95–S99: P2 (0021a_p2_checkout_fee.sql) فوق P1 — ptest · تطبيق · verify · النداء · rollback ──
P2APPLY="$MIG/0021a_p2_checkout_fee.sql"
P2PTEST="$MIG/0021a_p2_checkout_fee_ptest.sql"
P2VERIFY="$MIG/0021a_p2_checkout_fee_verify.sql"
P2ROLLBACK="$MIG/0021a_p2_checkout_fee_rollback.sql"
if python3 "$SHAPE" "$P2PTEST" "$P2VERIFY" > "$TMP/p2shape.out" 2>&1; then ok=yes; else ok=no; fi
M1=$(body_md5 "$P2APPLY" '0021A_P2 BODY'); M2=$(body_md5 "$P2PTEST" '0021A_P2 BODY')
if [ "$M1" != "$M2" ] || [ "$M1" = "$EMPTY_MD5" ]; then ok=no; fi
record "S95 P2 shape: ptest + verify, body copied verbatim (md5)" "$ok" "apply=$M1 ptest=$M2 $(tail -n 3 "$TMP/p2shape.out" | tr '\n' ' ')"
run_file "$P2PTEST" "$TMP/p2ptest.out"; E=$?; S=$(summary_of "$TMP/p2ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(q "select count(*) from pg_proc where proname = 'zell_checkout_confirmation_fee'")" = "0" ]; then ok=yes; fi
record "S96 P2 ptest (after P1) -> PASS, nothing left" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/p2ptest.out")"
run_file "$P2APPLY" "$TMP/p2apply.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/p2apply.out" 'ZELL_0021A_P2_APPROVAL_MISSING' && [ "$(q "select count(*) from pg_proc where proname = 'zell_checkout_confirmation_fee'")" = "0" ]; then ok=yes; fi
record "S96a P2 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2apply.out"; E=$?
run_file "$P2VERIFY" "$TMP/p2verify.out"; V=$(summary_of "$TMP/p2verify.out")
SR=$(q "set role service_role; select public.zell_checkout_confirmation_fee() -> 'confirmation_fee' ->> 'enabled'")
AN=$(psql -X -q -tA -v VERBOSITY=verbose -U postgres -d "$DB" -c "set role anon; select public.zell_checkout_confirmation_fee()" 2>&1 | grep -o 'ERROR:  [0-9A-Z]\{5\}' | head -n 1 | awk '{print $2}')
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$V" 7)" = "PASS" ] && [ "$SR" = "false" ] && [ "$AN" = "42501" ]; then ok=yes; fi
record "S97 P2 apply -> verify PASS, service_role reads the config, anon 42501" "$ok" "E=$E V=$V SR=$SR AN=$AN $(grep -m3 -E 'ERROR|ZELL' "$TMP/p2apply.out" | tr '\n' ' ' | cut -c1-400)"
run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2apply.out"; E=$?
V1=$(verify_p1)
ok=no; if [ "$E" -ne 0 ] && has "$TMP/p2apply.out" 'ZELL_0021A_P2_ALREADY_APPLIED' && [ "$(rf "$V1" 7)" = "PASS" ]; then ok=yes; fi
record "S98 P2 re-apply refused; P1 verify still PASS with P2" "$ok" "E=$E V1=$V1"
PRE2=$(impact)
rollback_p1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A_P1_RB_P2_FIRST' && [ "$(impact)" = "$PRE2" ] \
   && [ "$(q "select count(*) from pg_proc where proname = 'zell_checkout_confirmation_fee'")" = "1" ]; then ok=yes; fi
record "S98a P1 rollback while P2 is applied -> refused (P2_FIRST), nothing changed; P2 rollback first (S99), then P1 rollback (S81)" "$ok" "E=$E $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-300)"
run_file "$P2ROLLBACK" "$TMP/p2rb.out"; E=$?
ok=no; if [ "$E" -eq 0 ] && [ "$(q "select count(*) from pg_proc where proname = 'zell_checkout_confirmation_fee'")" = "0" ] && [ "$(rf "$(verify_p1)" 7)" = "PASS" ]; then ok=yes; fi
record "S99 P2 rollback -> function gone, P1 verify PASS" "$ok" "E=$E $(tail -n 3 "$TMP/p2rb.out" | tr '\n' ' ')"

# ── S8: rollback 0021-P بعد P1 (سطور المنح مصدرها migration، فمش «استخدام حقيقي»)، وبعده P1 rollback ──
sed "s/^-- select pg_catalog.set_config('zell.rollback_attest'/select pg_catalog.set_config('zell.rollback_attest'/" "$PROLLBACK" > "$TMP/prb.sql"
run_file "$TMP/prb.sql" "$TMP/prb.out"; E=$?
ok=no; if [ "$E" -eq 0 ]; then ok=yes; fi
record "S80 0021-P rollback still allowed with P1 applied (P1 audit rows are migration-sourced)" "$ok" "E=$E $(tail -n 3 "$TMP/prb.out" | tr '\n' ' ')"
rollback_p1; E=$?
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$(impact)" 8)|$(rf "$(impact)" 9)|$(rf "$(impact)" 2)" = "29|22|0" ]; then ok=yes; fi
record "S81 P1 rollback works after the 0021-P rollback (catalog back to 29 / 22)" "$ok" "E=$E $(grep -m3 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"

# ── S9: حارس الانحراف ──
if ! reset_db; then record "S90 reset" "no" "see output"; fi
psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -c "update pg_catalog.pg_proc set prosrc = prosrc || ' ' where oid = 'public.zell_create_order($NEW_SIG)'::regprocedure" > /dev/null
PRE=$(impact)
apply_p1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021A_P1_CREATE_ORDER_DRIFT' && [ "$(impact)" = "$PRE" ]; then ok=yes; fi
record "S90 drifted zell_create_order -> apply refused (CREATE_ORDER_DRIFT), nothing changed" "$ok" "E=$E"

# ── S14: ptest production من غير أدمن شغال ولا أي طلب (B2): الـ skips محسوبة من البيانات والحكم بالعدد بالحرف ──
if ! reset_db; then record "S14 reset" "no" "see output"; fi
q "update public.admin_users set is_active = false where role = 'admin'" > /dev/null
run_ptest production; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 8)" = "29" ] && [ "$(rf "$S" 12)" = "G01,M08,O00,V10" ] && [ "$(rf "$S" 13)" = "G01,M08,O00,V10" ]; then ok=yes; fi
record "S14 ptest production without an active admin or any order -> PASS (29 pass), skips G01,M08,O00,V10 from the data" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out")"

echo "SUMMARY co_owner=$CO_OWNER pass=$PASS fail=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
