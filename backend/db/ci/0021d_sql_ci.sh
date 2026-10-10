#!/usr/bin/env bash
# 0021-D — اختبار SQL الدائم في CI: Postgres 17 مؤقت + shim شبه Supabase بجداول مسار الطلب (products · product_widths
# · settings · coupons من 0019 بالحرف · orders · order_items) والدالتين القديمتين zell_create_order وzell_get_order_receipt
# متاخدين بالحرف من 0019_coupons.sql (مالكهم zell_order_writer)، وA1 متطبّق فوقهم بملفه الحقيقي.
# بيغطي: شكل المعاملة · md5 الجسم · ptest (ci + production) · التطبيق · رفض الإعادة · verify · مقارنة قديم/جديد على
# مصفوفة طلبات (أرقام + صفوف + بنود بالحرف) · نداء PostgREST بدور service_role · الإيصال · الفترات · حارس الانحراف
# · rollback (ببيانات ومن غير) وإعادة التطبيق. ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
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
OLD19="$MIG/0019_coupons.sql"
A1="$MIG/0021a_a1_order_cycle.sql"
A1VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
APPLY="$MIG/0021d_preferred_delivery.sql"
PTEST="$MIG/0021d_preferred_delivery_ptest.sql"
VERIFY="$MIG/0021d_preferred_delivery_verify.sql"
ROLLBACK="$MIG/0021d_preferred_delivery_rollback.sql"
SHAPE="$ROOT/backend/db/ci/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0

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
code_in() { grep -o 'ERROR:  [0-9A-Z]\{5\}' | head -n 1 | awk '{print $2}'; }
has() { grep -q -- "$2" "$1"; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
# الدالة من 0019 بالحرف: من سطر البداية لحد سطر $function$ لوحده، وبعدها ;
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
NEW_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb'
OLD_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text'

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
-- مالك دوال مسار الطلب: postgres يقدر يوصله (زي ما 0019 اتطبّقت بـ CREATE OR REPLACE على الإيصال).
grant zell_order_writer to postgres with inherit true, set true;
SQL
}

reset_db() {
  su_sql postgres "drop database if exists $DB with (force)"
  su_sql postgres "drop role if exists zell_order_definer"
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
alter function public.zell_create_order($OLD_SIG) owner to zell_order_writer;
revoke all on function public.zell_create_order($OLD_SIG) from public, anon, authenticated;
grant execute on function public.zell_create_order($OLD_SIG) to service_role, zell_order_writer;
alter function public.zell_get_order_receipt(text, text) owner to zell_order_writer;
revoke all on function public.zell_get_order_receipt(text, text) from public, anon, authenticated;
grant execute on function public.zell_get_order_receipt(text, text) to service_role, zell_order_writer;
SQL
  } | psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" > "$TMP/old.out" 2>&1 || { echo "--- old.out"; cat "$TMP/old.out"; return 1; }
  run_file "$A1" "$TMP/a1.out" || { echo "--- a1.out"; cat "$TMP/a1.out"; return 1; }
  q "insert into public.admin_users (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'owner')" > /dev/null
}

# نسخة القديمة في schema لوحدها للمقارنة بعد التطبيق (قبل التطبيق، من 0019 بالحرف).
load_old_copy() {
  su_sql "$DB" "create schema if not exists ci_old authorization postgres"
  extract_fn 'CREATE FUNCTION public.zell_create_order(' | sed '1s/public\.zell_create_order(/ci_old.zell_create_order(/' \
    | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/old_copy.out" 2>&1
}

apply_d() { run_file "$APPLY" "$TMP/apply.out"; }
verify_row() { run_file "$VERIFY" "$TMP/verify.out"; grep '^0|summary|' "$TMP/verify.out"; }
verify_fails() { grep -E '^[0-9]+\|check\|[^|]*\|[^|]*\|f\|' "$TMP/verify.out" | tr '\n' ' '; }
ptest_text() { sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = '$1';/" "$PTEST"; }
run_ptest() { ptest_text "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/ptest.out" 2>&1; }
ptest_summary() { grep '^0|summary|' "$TMP/ptest.out"; }
ptest_fails() { grep -E '^[0-9]+\|test\|[^|]*\|[^|]*\|fail\|' "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-1800; }

# استعلام الأثر المعتمد (قراءة بس) — نفس النص في وصف الـ PR بالحرف.
IMPACT_SQL=$(cat <<'SQL'
select
 (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('preferred_delivery_date','preferred_delivery_period','preferred_delivery_note')) as preferred_columns,
 (select coalesce(string_agg(p.pronargs::text, ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order_args,
 (select coalesce(string_agg(pg_catalog.md5(p.prosrc), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order_md5,
 (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_get_order_receipt(text, text)')) as receipt_md5,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_delivery_periods') as checkout_periods_fn,
 (select coalesce(string_agg(pg_catalog.pg_get_userbyid(p.proowner), ','), '') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order') as create_order_owner,
 (select count(*) from public.orders) as orders_total,
 (select coalesce(string_agg(s.status || '=' || s.n, ',' order by s.status), '') from (select o.status, count(*) as n from public.orders o group by o.status) s) as statuses,
 (select count(*) from pg_catalog.pg_stat_activity where state like 'idle in transaction%' and pid <> pg_catalog.pg_backend_pid()) as idle_tx,
 (select count(*) from pg_catalog.pg_locks where relation = 'public.orders'::regclass and pid <> pg_catalog.pg_backend_pid()) as orders_locks;
SQL
)
impact() { q "$IMPACT_SQL"; }

# مصفوفة المقارنة: قديم (ci_old) / جديد من غير موعد / جديد بموعد — كل نداء في subtransaction بيترجع.
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
                                   - 'preferred_delivery_date' - 'preferred_delivery_period' - 'preferred_delivery_note')::text
                                   from public.orders o where o.order_number = r ->> 'order_number'), 'none')
         || ' ITEMS ' || (select coalesce(jsonb_agg(to_jsonb(i) - 'id' - 'order_id' - 'created_at' order by i.id), '[]'::jsonb)::text
                            from public.order_items i join public.orders o on o.id = i.order_id
                           where o.order_number = r ->> 'order_number');
    raise exception using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then null;
    when others then v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  return v;
end
$f$;
create or replace function pg_temp.ci_call(p_fn text, p_items text, p_gov text, p_area text, p_inst boolean, p_coupon text, p_phone text, p_pref text)
returns text language sql as $f$
  select format('select %s(p_items => %L::jsonb, p_customer_name => %L, p_customer_phone => %L, p_governorate => %L, p_address => %L, '
                || 'p_notes => %L, p_idempotency_key => %L, p_request_hash => %L, p_checkout_session_hash => %L, p_receipt_token_hash => %L%s%s%s%s)',
                p_fn, p_items, 'عميل المقارنة', p_phone, p_gov, 'عنوان المقارنة طويل كفاية', 'ملاحظة', 'ci-parity-key-' || p_phone,
                repeat('a', 64), repeat('b', 64), repeat('c', 64),
                case when p_area is null then '' else format(', p_area => %L', p_area) end,
                case when p_inst then ', p_installation => true' else '' end,
                case when p_coupon is null then '' else format(', p_coupon_code => %L', p_coupon) end,
                case when p_pref is null then '' else format(', p_preferred_delivery => %L::jsonb', p_pref) end);
$f$;
create temporary table ci_parity (n integer, ok boolean, outcome text, detail text);
do $m$
declare
  carts text[] := array[
    '[{"productId":1,"lengthCm":300}]', '[{"productId":1,"lengthCm":350,"widthCm":100}]', '[{"productId":1,"lengthCm":300,"widthCm":50}]',
    '[{"productId":3,"quantity":2}]', '[{"productId":1,"lengthCm":300},{"productId":3,"quantity":1}]', '[{"productId":1,"lengthCm":2000}]',
    '[{"productId":1,"lengthCm":1000},{"productId":1,"lengthCm":500,"widthCm":100}]', '[{"productId":1,"lengthCm":325}]',
    '[{"productId":2,"lengthCm":300}]', '[{"productId":1,"lengthCm":300,"widthCm":150}]', '[{"productId":3,"quantity":11}]', '[]'];
  combos text[] := array['القاهرة||f', 'الجيزة||f', 'القاهرة|المعادي|f', 'القاهرة|المعادي|t', 'القاهرة|مدينة نصر|t', 'الجيزة|المعادي|f', 'أسوان||f', 'القاهرة|الزمالك|f'];
  coupons text[] := array[null, 'PCT10', 'FIX20', 'NOPE1', 'OLD10'];
  v_pref text := '{"date":"' || to_char((now() at time zone 'Africa/Cairo')::date + 3, 'YYYY-MM-DD') || '","period":"morning","note":"قبلها بساعة"}';
  n integer := 0;
  v_old text; v_new text; v_newp text; v_gov text; v_area text; v_inst boolean; v_phone text;
begin
  for i in 1 .. array_length(carts, 1) loop
    for j in 1 .. array_length(combos, 1) loop
      for k in 1 .. array_length(coupons, 1) loop
        n := n + 1;
        v_gov := split_part(combos[j], '|', 1);
        v_area := nullif(split_part(combos[j], '|', 2), '');
        v_inst := split_part(combos[j], '|', 3) = 't';
        v_phone := '010' || lpad(n::text, 8, '0');
        v_old := pg_temp.ci_try(pg_temp.ci_call('ci_old.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, null));
        v_new := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, null));
        v_newp := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, v_pref));
        insert into ci_parity values (n, v_old = v_new and v_old = v_newp, split_part(v_old, ' ', 1) || ' ' || split_part(v_old, ' ', 2),
                                      left(v_old || ' || ' || v_new || ' || ' || v_newp, 600));
      end loop;
    end loop;
  end loop;
end
$m$;
select count(*) || '|' || count(*) filter (where not ok) || '|' || count(*) filter (where outcome like 'OK %') || '|'
       || count(distinct outcome) || '|' || coalesce((select detail from ci_parity where not ok order by n limit 1), '')
  from ci_parity;
SQL
)

init_cluster

# ── S0: الشكل ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021D BODY'); M2=$(body_md5 "$PTEST" '0021D BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no; if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"

# ── S1: ptest قبل التطبيق ──
if ! reset_db; then record "S09 shim + old functions from 0019 + A1" "no" "see output"; fi
BEFORE=$(impact)
run_ptest ci; E=$?; S=$(ptest_summary)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 7)" = "ci" ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 9)" = "0" ] && [ "$(rf "$S" 13)" = "" ]; then ok=yes; fi
record "S10 ptest ci profile -> PASS, no skips" "$ok" "E=$E S=$S fails=$(ptest_fails) tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
run_ptest production; E=$?; S=$(ptest_summary)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 13)" = "O00" ]; then ok=yes; fi
record "S11 ptest production profile -> PASS, expected skip O00" "$ok" "E=$E S=$S fails=$(ptest_fails)"
ok=no; if [ "$(impact)" = "$BEFORE" ]; then ok=yes; fi
record "S12 ptest leaves nothing behind" "$ok" "before=$BEFORE after=$(impact)"

# ── S2: التطبيق ──
load_old_copy
q "insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, total_piastres) values ('FLM-OLD001', 'زبون قديم', '01099999999', 'القاهرة', 'عنوان قديم طويل كفاية', 30000, 35000)" > /dev/null
PRE=$(impact)
apply_d; E=$?
AFTER=$(impact)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$AFTER" 1)|$(rf "$AFTER" 2)|$(rf "$AFTER" 5)|$(rf "$AFTER" 6)" = "3|14|1|zell_order_writer" ] \
   && [ "$(rf "$AFTER" 7)|$(rf "$AFTER" 8)" = "$(rf "$PRE" 7)|$(rf "$PRE" 8)" ] && [ "$(rf "$AFTER" 9)" = "0" ]; then ok=yes; fi
record "S20 apply -> impact (columns, 14 args, owner kept, orders untouched)" "$ok" "E=$E pre=$PRE after=$AFTER $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
apply_d; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021D_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S21 re-apply refused (ALREADY_APPLIED)" "$ok" "E=$E"
V=$(verify_row)
ok=no; if [ "$(rf "$V" 7)" = "PASS" ] && [ "$(rf "$V" 10)" = "0" ] && [ "$(rf "$V" 11)" = "zell_order_writer" ]; then ok=yes; fi
record "S22 verify -> PASS (owner kept, no preferred yet)" "$ok" "V=$V fails=$(verify_fails)"
run_ptest ci; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021D_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S23 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"
run_file "$A1VERIFY" "$TMP/a1v.out"; A1V=$(grep '^0|summary|' "$TMP/a1v.out")
ok=no; if [ "$(rf "$A1V" 7)" = "PASS" ]; then ok=yes; fi
record "S24 A1 verify still PASS after D" "$ok" "$A1V"
ACL_NEW=$(q "select string_agg(x, ',' order by x) from (select distinct pg_get_userbyid(a.grantee) || ':' || a.privilege_type as x from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.zell_create_order($NEW_SIG)'::regprocedure) s")
ok=no; if [ "$ACL_NEW" = "service_role:EXECUTE,zell_order_writer:EXECUTE" ]; then ok=yes; fi
record "S25 EXECUTE grants kept exactly (owner + service_role)" "$ok" "new=$ACL_NEW"

# ── S3: المقارنة ──
P=$(printf '%s\n' "$PARITY_SQL" | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1 | tail -n 1)
ok=no; if [ "$(rf "$P" 1)" -ge 480 ] 2>/dev/null && [ "$(rf "$P" 2)" = "0" ] && [ "$(rf "$P" 3)" -ge 60 ] 2>/dev/null && [ "$(rf "$P" 4)" -ge 6 ] 2>/dev/null; then ok=yes; fi
record "S30 parity matrix: old = new = new+preferred (amounts, rows, items, rejections)" "$ok" "cases|mismatches|ok_orders|distinct_outcomes|first_mismatch = $P"

# ── S4: نداء PostgREST بدور service_role + الإيصال + الفترات ──
PREF="{\"date\":\"$(q "select to_char((now() at time zone 'Africa/Cairo')::date + 5, 'YYYY-MM-DD')")\",\"period\":\"noon\",\"note\":\"قبلها بساعة\"}"
R1=$(q "set role service_role; select public.zell_create_order(p_items => '[{\"productId\":1,\"lengthCm\":300}]', p_customer_name => 'عميل', p_customer_phone => '01011112222', p_governorate => 'القاهرة', p_address => 'عنوان طويل كفاية', p_notes => null, p_idempotency_key => 'ci-rest-key-000001', p_request_hash => repeat('d', 64), p_checkout_session_hash => repeat('e', 64), p_receipt_token_hash => repeat('f', 64)) ->> 'total_piastres'")
R2=$(q "set role service_role; select public.zell_create_order(p_items => '[{\"productId\":1,\"lengthCm\":300}]', p_customer_name => 'عميل', p_customer_phone => '01011113333', p_governorate => 'القاهرة', p_address => 'عنوان طويل كفاية', p_notes => null, p_idempotency_key => 'ci-rest-key-000002', p_request_hash => repeat('d', 64), p_checkout_session_hash => repeat('e', 64), p_receipt_token_hash => repeat('f', 64), p_preferred_delivery => '$PREF') ->> 'order_number'")
RC=$(q "set role service_role; select public.zell_get_order_receipt('$R2', repeat('f', 64)) -> 'preferred_delivery'")
ROW=$(q "select preferred_delivery_period || '|' || preferred_delivery_note || '|' || total_piastres from public.orders where order_number = '$R2'")
ok=no; if [ -n "$R1" ] && [ "$ROW" = "noon|قبلها بساعة|$R1" ] && printf '%s' "$RC" | grep -q '"period": "noon"'; then ok=yes; fi
record "S40 service_role call without / with preferred · snapshot stored · receipt returns it · totals equal" "$ok" "R1=$R1 R2=$R2 ROW=$ROW RC=$RC"
C1=$(q "set role service_role; select string_agg(e ->> 'period', ',') from jsonb_array_elements(public.zell_checkout_delivery_periods()) e")
C2=$(psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -c "set role anon; select public.zell_checkout_delivery_periods()" 2>&1 | code_in)
C3=$(psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -c "set role authenticated; select public.zell_get_order_receipt('$R2', repeat('f', 64))" 2>&1 | code_in)
ok=no; if [ "$C1" = "morning,noon,evening" ] && [ "$C2" = "42501" ] && [ "$C3" = "42501" ]; then ok=yes; fi
record "S41 checkout periods for service_role only · receipt still closed to authenticated" "$ok" "$C1|$C2|$C3"

# ── S5: rollback ببيانات ثم من غير ──
SNAP=$(q "select md5(prosrc) from pg_proc where oid = 'ci_old.zell_create_order($OLD_SIG)'::regprocedure")
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
RB=$(impact)
ok=no; if [ "$E" -eq 0 ] && has "$TMP/rb.out" 'ZELL_0021D_RB_COLUMNS_KEPT' && [ "$(rf "$RB" 1)|$(rf "$RB" 2)|$(rf "$RB" 3)|$(rf "$RB" 5)|$(rf "$RB" 6)" = "3|13|$SNAP|0|zell_order_writer" ] \
   && [ "$(rf "$RB" 4)" = "$(rf "$BEFORE" 4)" ]; then ok=yes; fi
record "S50 rollback with preferred data: old functions back by fingerprint, owner kept, columns kept" "$ok" "E=$E rb=$RB $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021D_RB_NOT_APPLIED'; then ok=yes; fi
record "S51 rollback when not applied -> NOT_APPLIED" "$ok" "E=$E"

reset_db
PRE2=$(impact)
apply_d > /dev/null
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -eq 0 ] && [ "$(impact)" = "$PRE2" ]; then ok=yes; fi
record "S52 clean rollback -> exact pre-apply impact (columns dropped)" "$ok" "E=$E pre=$PRE2 post=$(impact)"
apply_d; E=$?; V=$(verify_row)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$V" 7)" = "PASS" ]; then ok=yes; fi
record "S53 re-apply after rollback + verify PASS" "$ok" "E=$E V=$V"

# ── S6: حارس الانحراف ──
reset_db
psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -c "update pg_catalog.pg_proc set prosrc = prosrc || ' ' where oid = 'public.zell_create_order($OLD_SIG)'::regprocedure" > /dev/null 2>&1
DRIFT=$(impact)
apply_d; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021D_CREATE_ORDER_DRIFT' && [ "$(impact)" = "$DRIFT" ]; then ok=yes; fi
record "S60 live body differs from the reviewed one -> refused (DRIFT), nothing changed" "$ok" "E=$E"

su_sql postgres "drop database if exists $DB with (force)"
su_sql postgres "drop role if exists zell_order_definer"
rm -rf "$TMP"
echo "ZELL_0021D_SQL_CI_RESULT pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ] || [ "$PASS" -eq 0 ]; then exit 1; fi
