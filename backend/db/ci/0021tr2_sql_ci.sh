#!/usr/bin/env bash
# TRACK-ORDER v2 W1 — اختبار SQL في CI: Postgres 17 مؤقت + shim الـ CI بتاع P1 بالحرف (init_cluster و reset_db و IMPACT_SQL من
# backend/db/ci/0021p1_sql_ci.sh: 0021-P ← A1 ← D)، وفوقه P1 و P2 و D2 و TR و EXPRESS-SHIPPING (شكل Production، ومالك
# zell_create_order = postgres، و RLS على order_items)، وبعدين TRACK-ORDER v2 (0021tr2).
# بيغطي: شكل المعاملة · md5 الجسم · الأكواد · جسم T1 بالحرف في الرجوع والمقارنة · ptest (production و ci) · رفض التطبيق من غير
# موافقة ومن متصل تاني · التطبيق · بصمة دالة التتبّع (T1 قبل · v2 بعد · الصلاحيات زي ما هي) · استعلام الأثر (مفيش خانة بتتغيّر) ·
# كل الـ verify (A1 · D · P1 · P2 · 0021-P · D2 · TR بالحالتين · EX · TR2) ورفض البصمة المجهولة والخليط · السيناريوهات
# (0021tr2_flows.sql) · بيانات حقيقية + رفض الرجوع (TR2 · TR · EX) · التزامن بجلستين (الشحنة والتعديل) · الرجوع (بصمات T1
# التلاتة) وإعادة التطبيق · حراس الـ preflight · توافق حارس v1 (parseTrackedOrder من c825ce3d4c4896943d94209a5a382d934229f97e) مع رد v2 على طلبات حقيقية.
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
P1CI="$CIDIR/0021p1_sql_ci.sh"
# متغيرات الـ shim (init_cluster و reset_db من CI بتاع P1 بيستخدموها).
OLD19="$MIG/0019_coupons.sql"
A1="$MIG/0021a_a1_order_cycle.sql"
DAPPLY="$MIG/0021d_preferred_delivery.sql"
ENGINE="$MIG/0021p_erp_access.sql"
ADAPTER="$MIG/0021p_zell_erp_access.sql"
A1VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
DVERIFY="$MIG/0021d_preferred_delivery_verify.sql"
PVERIFY="$MIG/0021p_access_verify.sql"
P1APPLY="$MIG/0021a_p1_payments.sql"
P1VERIFY="$MIG/0021a_p1_payments_verify.sql"
P2APPLY="$MIG/0021a_p2_checkout_fee.sql"
P2VERIFY="$MIG/0021a_p2_checkout_fee_verify.sql"
D2APPLY="$MIG/0021d2_delivery_settings.sql"
D2VERIFY="$MIG/0021d2_delivery_settings_verify.sql"
TRAPPLY="$MIG/0021tr_track_order.sql"
TRVERIFY="$MIG/0021tr_track_order_verify.sql"
TRROLLBACK="$MIG/0021tr_track_order_rollback.sql"
EXAPPLY="$MIG/0021ex_express_shipping.sql"
EXVERIFY="$MIG/0021ex_express_shipping_verify.sql"
EXROLLBACK="$MIG/0021ex_express_shipping_rollback.sql"
APPLY="$MIG/0021tr2_track_order_v2.sql"
PTEST="$MIG/0021tr2_track_order_v2_ptest.sql"
VERIFY="$MIG/0021tr2_track_order_v2_verify.sql"
ROLLBACK="$MIG/0021tr2_track_order_v2_rollback.sql"
FLOWS="$CIDIR/0021tr2_flows.sql"
GUARD="$CIDIR/0021tr2_v1_guard.mjs"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
OLD_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text'
# شكل Production (08-HANDOFF-NOW): مالك zell_create_order = postgres.
CO_OWNER=postgres
OWNER_ID='00000000-0000-0000-0000-00000000000a'
ADMIN_ID='00000000-0000-0000-0000-00000000000b'
TRSTART='create function public.zell_checkout_track_order(p_order_number text)'
TRREPLACE='create or replace function public.zell_checkout_track_order(p_order_number text)'
# بصمات قراءة T1 (Production 2026-10-14) لدالة التتبّع الحالية، والبصمة الجديدة المعتمدة.
T1_MD5='edd7a26279a345963c68d69425f0ea1a'
T1_DEF_MD5='6d2d323e0801fa43053984f2504ba3c4'
T1_DEF_SHA='e7fec5a9f85d67e922c6b9a1a7439e16510d8c0c41d0e918388427c773e069bc'
T1_ACL='{zell_order_definer=X/zell_order_definer,service_role=X/zell_order_definer}'
NEW_MD5='14dad4721c48b73ee5e040bf7436bfc5'
# حارس v1 المنشور (#146): الملف بالحرف من الكوميت ده (blob مثبّت).
V1_COMMIT='c825ce3d4c4896943d94209a5a382d934229f97e'
V1_GUARD_BLOB='92b59827ec5872ca675056db7655c904f0fc601f'

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
# نداءات بدور service_role (زي المتجر): الـ SQL من stdin.
srq() { { echo 'set role service_role;'; cat; } | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
# الـ shim بيستخدمها (نفس تعريف CI بتاع P1 بالحرف).
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
# جسم الدالة (prosrc) من ملف: السطور بعد سطر البداية + سطر returns لحد سطر $fn$; — و md5 بنفس شكل prosrc (سطر فاضي قبله).
body_after() { awk -v s="$2" 'f == 2 && $0 == "$fn$;" {exit} f == 2 {print} f == 1 {f = 2} f == 0 && index($0, s) == 1 {f = 1}' "$1"; }
prosrc_md5() { { echo; body_after "$1" "$2"; } | md5sum | cut -d' ' -f1; }
# تعريف كامل (من سطر البداية لحد $fn$;) من ملف.
def_of() { awk -v s="$2" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$fn$;" {exit}' "$1"; }
v2_def() { def_of "$APPLY" "$TRREPLACE"; }
t1_def() { def_of "$TRAPPLY" "$TRSTART" | sed "1s/^create function /create or replace function /"; }
# كـ superuser (المالك والصلاحيات بيفضلوا زي ما هم مع CREATE OR REPLACE).
su_file() { psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f - > "$1" 2>&1; }
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
apply_tr2() { run_approved "$APPLY" 'ci-0021tr2' "$TMP/apply.out"; }
rollback_tr2() { run_approved "$ROLLBACK" 'ci-0021tr2-rollback' "$TMP/rb.out"; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
vsum() { run_file "$1" "$TMP/v.out"; summary_of "$TMP/v.out"; }
ptest_text() { sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = '$1';/" "$PTEST"; }
run_ptest() { ptest_text "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/ptest.out" 2>&1; }
# الأحكام: A1 · D · P1 · P2 · 0021-P (العمود 11) · D2 · TR · EX
verdicts() { printf '%s|%s|%s|%s|%s|%s|%s|%s' "$(rf "$(vsum "$A1VERIFY")" 7)" "$(rf "$(vsum "$DVERIFY")" 7)" "$(rf "$(vsum "$P1VERIFY")" 7)" "$(rf "$(vsum "$P2VERIFY")" 7)" "$(rf "$(vsum "$PVERIFY")" 11)" "$(rf "$(vsum "$D2VERIFY")" 7)" "$(rf "$(vsum "$TRVERIFY")" 7)" "$(rf "$(vsum "$EXVERIFY")" 7)"; }
ALL8='PASS|PASS|PASS|PASS|PASS|PASS|PASS|PASS'
verify_tr2() { run_file "$VERIFY" "$TMP/tr2v.out"; summary_of "$TMP/tr2v.out"; }
verify_tr() { run_file "$TRVERIFY" "$TMP/trv.out"; summary_of "$TMP/trv.out"; }
# الحالة: الجداول الأربعة · عدد دوال zell_shipment_* و zell_customer_update_*
tr2_state() { q "select (to_regclass('public.zell_order_shipments') is not null)::int || '|' || (to_regclass('public.zell_order_shipments_log') is not null)::int || '|' || (to_regclass('public.zell_order_customer_updates') is not null)::int || '|' || (to_regclass('public.zell_order_customer_updates_log') is not null)::int || '|' || (select count(*) from pg_proc p where p.proname like 'zell\_shipment\_%' or p.proname like 'zell\_customer\_update\_%')"; }
# بصمة دالة التتبّع: md5(prosrc) · md5(def) · sha256(def) · المالك · security definer · volatile · الإعداد · الصلاحيات · oid
track_fp() { q "select md5(p.prosrc) || '|' || md5(pg_get_functiondef(p.oid)) || '|' || encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || array_to_string(p.proconfig, ',') || '|' || coalesce(p.proacl::text, '') || '|' || p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_checkout_track_order'"; }
codes() { grep -o "errcode = '[0-9A-Z]*'" | grep -o "'[0-9A-Z]*'" | tr -d "'" | sort -u | tr '\n' ' '; }
# نداء كـ مستخدم (جلسة authenticated) في معاملة لوحده.
as_user() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" 2>&1 <<SQL
begin;
set local request.jwt.claims = '{"sub": "$1", "role": "authenticated"}';
set local role authenticated;
$2;
commit;
SQL
}

# init_cluster و reset_db و IMPACT_SQL من CI بتاع P1 بالحرف (مصدر واحد للـ shim واستعلام الأثر).
awk '/^init_cluster\(\) \{$/ {f = 1} f {print} f && /^\}$/ {f = 0}' "$P1CI" > "$TMP/shim.sh"
awk '/^reset_db\(\) \{$/ {f = 1} f {print} f && /^\}$/ {f = 0}' "$P1CI" >> "$TMP/shim.sh"
awk 'index($0, "IMPACT_SQL=$(cat <<") == 1 {f = 1} f {print} f && $0 == ")" {f = 0}' "$P1CI" >> "$TMP/shim.sh"
# shellcheck disable=SC1090
. "$TMP/shim.sh"
if ! declare -F init_cluster > /dev/null || ! declare -F reset_db > /dev/null || [ -z "$(declare -p IMPACT_SQL 2> /dev/null)" ]; then
  echo "refusing: could not load the shim from $P1CI" >&2
  exit 2
fi
impact() { q "$IMPACT_SQL"; }

# شكل Production قبل v2: الـ shim (0021-P ← A1 ← D) + P1 + P2 + D2، و RLS على order_items، و TR، و EXPRESS (إلا no_ex).
prep() {
  reset_db || return 1
  run_approved "$P1APPLY" 'ci-0021a-p1' "$TMP/p1.out" || { echo "--- p1.out"; tail -n 20 "$TMP/p1.out"; return 1; }
  run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2.out" || { echo "--- p2.out"; tail -n 20 "$TMP/p2.out"; return 1; }
  run_approved "$D2APPLY" 'ci-0021d2' "$TMP/d2.out" || { echo "--- d2.out"; tail -n 20 "$TMP/d2.out"; return 1; }
  su_sql "$DB" "alter table public.order_items enable row level security"
  run_approved "$TRAPPLY" 'ci-0021tr' "$TMP/tr.out" || { echo "--- tr.out"; tail -n 20 "$TMP/tr.out"; return 1; }
  if [ "$1" != "no_ex" ]; then
    run_approved "$EXAPPLY" 'ci-0021ex' "$TMP/ex.out" || { echo "--- ex.out"; tail -n 20 "$TMP/ex.out"; return 1; }
  fi
}

# طلبات حقيقية بالدوال (كل جملة معاملة لوحدها، فالأوقات مختلفة): كل الحالات · موعد مفضّل ومؤكد · متر بعرض وقطعة ومن غير سطور ·
# كوبون · دفعة ورد · سريع · طلب قديم من غير طريقة شحن.
SEED_SQL=$(cat <<'SQL'
create function pg_temp.as_user(p_sub text, p_sql text) returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into r;
  execute 'reset role';
  return r;
end
$f$;
create function pg_temp.adm(p_sql text) returns jsonb language sql as $f$ select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', p_sql) $f$;
create function pg_temp.own(p_sql text) returns jsonb language sql as $f$ select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', p_sql) $f$;
create function pg_temp.id_of(p_phone text) returns integer language sql as $f$ select o.id from public.orders o where o.customer_phone = p_phone $f$;
create function pg_temp.ver(p_phone text) returns text language sql as $f$
  select pg_catalog.quote_literal(o.updated_at::text) || '::timestamptz' from public.orders o where o.customer_phone = p_phone
$f$;
create function pg_temp.co(p_phone text, p_extra text, p_notes text default null) returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  execute 'select public.zell_create_order(p_customer_name => ''عميل التوافق'', p_customer_phone => ' || pg_catalog.quote_literal(p_phone)
          || ', p_governorate => ''القاهرة'', p_address => ''عنوان التوافق طويل كفاية'', p_notes => ' || pg_catalog.quote_nullable(p_notes)
          || ', p_idempotency_key => '
          || pg_catalog.quote_literal('ci-0021tr2-compat-' || p_phone) || ', p_request_hash => repeat(''a'', 64), '
          || 'p_checkout_session_hash => repeat(''b'', 64), p_receipt_token_hash => repeat(''c'', 64), ' || p_extra || ')' into r;
  return r;
end
$f$;
create function pg_temp.tr(p_phone text, p_to text, p_reason text) returns jsonb language sql as $f$
  select pg_temp.adm(pg_catalog.format('select public.zell_order_transition(%s, %s, %L, %L)', pg_temp.id_of(p_phone), pg_temp.ver(p_phone), p_to, p_reason))
$f$;
create function pg_temp.pay(p_who text, p_fn text, p_cmd integer, p_phone text, p_amount integer) returns jsonb language sql as $f$
  select pg_temp.as_user(case p_who when 'owner' then '00000000-0000-0000-0000-00000000000a' else '00000000-0000-0000-0000-00000000000b' end,
    pg_catalog.format('select public.%s(%L::uuid, %s, %s, %s, %L, %s, null, %L, %L)', p_fn,
      '00000000-0000-4000-8000-' || lpad(p_cmd::text, 12, '0'), pg_temp.id_of(p_phone), pg_temp.ver(p_phone), p_amount, 'balance',
      (select m.id from public.zell_payment_methods m where m.name = 'كاش'), 'REF-COMPAT-' || p_cmd, 'ملاحظة دفع داخلية'))
$f$;
select pg_temp.co('01000000301', 'p_items => ''[{"productId":1,"lengthCm":300}]''::jsonb, p_coupon_code => ''PCT10''', 'ملاحظة العميل للتوافق');
select pg_temp.co('01000000302', 'p_items => ''[{"productId":1,"lengthCm":300},{"productId":3,"quantity":2}]''::jsonb, p_preferred_delivery => '
                  || pg_catalog.quote_literal(pg_catalog.jsonb_build_object('date', pg_catalog.to_char((now() at time zone 'Africa/Cairo')::date + 3, 'YYYY-MM-DD'), 'period', 'morning')::text) || '::jsonb');
select pg_temp.co('01000000303', 'p_items => ''[{"productId":1,"lengthCm":350,"widthCm":100}]''::jsonb, p_area => ''المعادي'', p_installation => true');
select pg_temp.co('01000000304', 'p_items => ''[{"productId":3,"quantity":1}]''::jsonb');
select pg_temp.co('01000000305', 'p_items => ''[{"productId":1,"lengthCm":300}]''::jsonb');
select pg_temp.co('01000000306', 'p_items => ''[{"productId":1,"lengthCm":400}]''::jsonb');
select pg_temp.co('01000000307', 'p_items => ''[{"productId":1,"lengthCm":300}]''::jsonb');
update public.zell_shipping_options
   set express_enabled = true,
       governorates = '{"القاهرة": {"standard_days_min": 2, "standard_days_max": 4, "express_enabled": true, "express_price_piastres": 11000, "express_days_min": 1, "express_days_max": 1}}'::jsonb
 where id;
select pg_temp.co('01000000308', 'p_items => ''[{"productId":1,"lengthCm":300}]''::jsonb, p_shipping_method => ''express''');
-- الإعداد يرجع لقيم التطبيق (زي 0021ex_sql_ci.sh) من غير سطر سجل، علشان EX verify V07.
update public.zell_shipping_options set express_enabled = false, governorates = '{}'::jsonb where id;
select pg_temp.co('01000000310', 'p_items => ''[{"productId":1,"lengthCm":500}]''::jsonb');
insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres)
values ('FLM-GKAAAA', 'عميل قديم', '01000000309', 'القاهرة', 'عنوان قديم طويل كفاية', 30000, 5000, 35000);
select pg_temp.tr('01000000302', 'confirmed', null);
select pg_temp.tr('01000000303', 'confirmed', null);
select pg_temp.adm(pg_catalog.format('select public.zell_order_set_confirmed_delivery(%s, %s, %L::date, %L, %L)', pg_temp.id_of('01000000303'),
                   pg_temp.ver('01000000303'), (now() at time zone 'Africa/Cairo')::date + 2, 'evening', 'ملاحظة تأكيد داخلية'));
select pg_temp.tr('01000000304', 'cancelled', 'سبب إلغاء داخلي');
select pg_temp.tr('01000000305', 'confirmed', null);
select pg_temp.tr('01000000305', 'shipped', null);
select pg_temp.pay('admin', 'zell_payment_record', 701, '01000000305', 10000);
select pg_temp.pay('owner', 'zell_payment_refund', 702, '01000000305', 2000);
select pg_temp.own(pg_catalog.format('select public.zell_order_set_gate(true, %L)', 'owner-approval-2026-10-15-ci-tr2-compat'));
select pg_temp.tr('01000000306', 'confirmed', null);
select pg_temp.tr('01000000306', 'preparing', null);
select pg_temp.tr('01000000306', 'shipped', null);
select pg_temp.pay('admin', 'zell_payment_record', 703, '01000000306', (select o.total_piastres from public.orders o where o.customer_phone = '01000000306'));
select pg_temp.tr('01000000306', 'delivered', null);
select pg_temp.tr('01000000307', 'confirmed', null);
select pg_temp.tr('01000000307', 'preparing', null);
select pg_temp.tr('01000000307', 'shipped', null);
select pg_temp.pay('admin', 'zell_payment_record', 704, '01000000307', 5000);
select pg_temp.tr('01000000307', 'refused', 'سبب رفض داخلي');
select 'SEED_OK ' || count(*) from public.orders;
SQL
)

# بعد التطبيق: شحنات ورسايل حقيقية (بدوال اللوحة) على الطلبات.
SEED2_SQL=$(cat <<'SQL'
create function pg_temp.as_user(p_sub text, p_sql text) returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into r;
  execute 'reset role';
  return r;
end
$f$;
create function pg_temp.num(p_phone text) returns text language sql as $f$ select o.order_number from public.orders o where o.customer_phone = p_phone $f$;
create function pg_temp.uid(p_phone text, p_n integer) returns bigint language sql as $f$
  select u.id from public.zell_order_customer_updates u join public.orders o on o.id = u.order_id
   where o.customer_phone = p_phone order by u.id offset p_n - 1 limit 1
$f$;
create function pg_temp.uver(p_id bigint) returns text language sql as $f$
  select pg_catalog.quote_literal(u.updated_at::text) || '::timestamptz' from public.zell_order_customer_updates u where u.id = p_id
$f$;
create function pg_temp.uadd(p_who text, p_phone text, p_text text) returns jsonb language sql as $f$
  select pg_temp.as_user(p_who, pg_catalog.format('select public.zell_customer_update_add(%L, %s, %L)', pg_temp.num(p_phone),
    coalesce((select pg_catalog.max(u.id)::text from public.zell_order_customer_updates u join public.orders o on o.id = u.order_id
               where o.customer_phone = p_phone), 'null'), p_text))
$f$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', pg_catalog.format('select public.zell_shipment_save(%L, null, %L, %L, %L, %L::date, null)',
       pg_temp.num('01000000305'), 'أرامكس', 'AWB-305', 'https://track.example.com/305', (now() at time zone 'Africa/Cairo')::date));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', pg_catalog.format('select public.zell_shipment_save(%L, null, %L, null, null, null, %L::date)',
       pg_temp.num('01000000306'), 'بوسطة', (now() at time zone 'Africa/Cairo')::date + 1));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', pg_catalog.format('select public.zell_shipment_save(%L, null, %L, null, null, null, null)',
       pg_temp.num('01000000303'), 'شركة محلية'));
select pg_temp.uadd('00000000-0000-0000-0000-00000000000b', '01000000302', 'تم تأكيد طلبك');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', pg_catalog.format('select public.zell_customer_update_edit(%L, %s, %s, %L)',
       pg_temp.num('01000000302'), pg_temp.uid('01000000302', 1), pg_temp.uver(pg_temp.uid('01000000302', 1)), 'تم تأكيد طلبك وجاري التجهيز'));
select pg_temp.uadd('00000000-0000-0000-0000-00000000000b', '01000000306', 'وصل طلبك');
select pg_temp.uadd('00000000-0000-0000-0000-00000000000b', '01000000306', 'رسالة هتتخفي');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', pg_catalog.format('select public.zell_customer_update_set_hidden(%L, %s, %s, true)',
       pg_temp.num('01000000306'), pg_temp.uid('01000000306', 2), pg_temp.uver(pg_temp.uid('01000000306', 2))));
select pg_temp.uadd('00000000-0000-0000-0000-00000000000b', '01000000310', 'طلبك وصلنا');
select 'SEED2_OK ' || (select count(*) from public.zell_order_shipments) || '/' || (select count(*) from public.zell_order_customer_updates);
SQL
)
DUMP_SQL="select o.order_number || chr(9) || coalesce(public.zell_checkout_track_order(o.order_number)::text, 'null') from public.orders o order by o.id;"

init_cluster

# ── S0: الشكل والملفات ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" "$TRVERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify + flows + TR verify (two states)" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021TR2 BODY'); M2=$(body_md5 "$PTEST" '0021TR2 BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no
if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] \
   && [ "$(grep -c '^begin;$' "$ROLLBACK")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"
C_FILE=$(codes < "$APPLY")
ok=no; if [ "$C_FILE" = "45403 45404 45410 45413 45433 45434 " ] && [ -z "$(codes < "$ROLLBACK")" ]; then ok=yes; fi
record "S04 error codes: the migration uses 45403 / 45404 / 45410 / 45413 (A1) + 45433 / 45434 (new) only · none in the rollback" "$ok" "file=$C_FILE"
OTHER=$(grep -rlE '4543[34]' "$ROOT/backend" 2> /dev/null | grep -v '/0021tr2_' | grep -v '\.md$' | tr '\n' ' ')
ok=no; if [ -z "$OTHER" ]; then ok=yes; fi
record "S05 45433 / 45434 unused in any other database code file under backend/ (0021tr2_* and Markdown docs excluded)" "$ok" "$OTHER"
B_TR=$(prosrc_md5 "$TRAPPLY" "$TRSTART"); B_RB=$(prosrc_md5 "$ROLLBACK" "$TRREPLACE")
B_FL=$(prosrc_md5 "$FLOWS" 'create function pg_temp.track_v1(p_order_number text)'); B_V2=$(prosrc_md5 "$APPLY" "$TRREPLACE")
B_PT=$(prosrc_md5 "$PTEST" "$TRREPLACE")
ok=no
if [ "$B_TR" = "$T1_MD5" ] && [ "$B_RB" = "$T1_MD5" ] && [ "$B_FL" = "$T1_MD5" ] && [ "$B_V2" = "$NEW_MD5" ] && [ "$B_PT" = "$NEW_MD5" ]; then ok=yes; fi
record "S06 bodies: TR W1 file = rollback = flows v1 copy = T1 md5 · migration = ptest = the new md5" "$ok" "tr=$B_TR rb=$B_RB flows=$B_FL v2=$B_V2 ptest=$B_PT"

# ── S1: قبل التطبيق (شكل Production) و ptest ──
if ! prep full; then record "S10 prep" "no" "see output"; fi
# طلب واحد حقيقي (علشان V04 / V05 في TR verify و T05 في الـ ptest يقارنوا رد فعلي).
SEEDONE=$(srq <<'SQL'
select public.zell_create_order(p_items => '[{"productId":1,"lengthCm":300}]'::jsonb, p_customer_name => 'عميل الأساس', p_customer_phone => '01099999900',
         p_governorate => 'القاهرة', p_address => 'عنوان الأساس طويل كفاية', p_notes => 'ملاحظة الأساس الداخلية', p_idempotency_key => 'ci-0021tr2-base-0001',
         p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64)) ->> 'order_number';
SQL
)
BEFORE=$(impact)
V0=$(verdicts)
FP0=$(track_fp)
ok=no
if [ -n "$SEEDONE" ] && [ "$V0" = "$ALL8" ] && [ "$(tr2_state)" = "0|0|0|0|0" ] && [ "$(rf "$FP0" 1)" = "$T1_MD5" ] && [ "$(rf "$FP0" 2)" = "$T1_DEF_MD5" ] \
   && [ "$(rf "$FP0" 3)" = "$T1_DEF_SHA" ] && [ "$(rf "$FP0" 4)" = "zell_order_definer" ] && [ "$(rf "$FP0" 8)" = "$T1_ACL" ]; then ok=yes; fi
record "S10 baseline = Production shape (8 verify PASS incl. EX) + 1 order, no TR2 objects, track function = T1 (md5 · functiondef md5 · sha256 · owner · grants)" "$ok" "seed=$SEEDONE V=$V0 state=$(tr2_state) fp=$FP0 impact=$BEFORE"
run_ptest ci; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "9" ] && [ "$(rf "$S" 8)" = "0" ] && [ "$(rf "$S" 10)" = "0" ]; then ok=yes; fi
record "S11 ptest ci profile -> PASS (9 pass, no skips)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
run_ptest production; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "8" ] && [ "$(rf "$S" 8)" = "0" ] && [ "$(rf "$S" 10)" = "1" ]; then ok=yes; fi
record "S12 ptest production profile -> PASS (8 pass), expected skip T09" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
ok=no; if [ "$(tr2_state)" = "0|0|0|0|0" ] && [ "$(impact)" = "$BEFORE" ] && [ "$(track_fp)" = "$FP0" ]; then ok=yes; fi
record "S13 ptest leaves nothing behind (no TR2 objects, impact + track fingerprint unchanged)" "$ok" "state=$(tr2_state) before=$BEFORE after=$(impact)"
q "create table public.zell_order_shipments (id integer)" > /dev/null
VM=$(rf "$(verify_tr)" 7)
q "drop table public.zell_order_shipments" > /dev/null
ok=no; if [ "$VM" = "FAIL" ] && [ "$(rf "$(verify_tr)" 7)" = "PASS" ]; then ok=yes; fi
record "S14 mixed state (shipments table + v1 response) -> TR verify FAIL; back to the before shape -> PASS" "$ok" "mixed=$VM"

# ── S2: التطبيق ──
run_file "$APPLY" "$TMP/noapproval.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/noapproval.out" 'ZELL_0021TR2_APPROVAL_MISSING' && [ "$(tr2_state)" = "0|0|0|0|0" ]; then ok=yes; fi
record "S20 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f <(approved "$APPLY" 'ci-0021tr2') > "$TMP/wrongcaller.out" 2>&1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/wrongcaller.out" 'ZELL_0021TR2_WRONG_CALLER' && [ "$(tr2_state)" = "0|0|0|0|0" ]; then ok=yes; fi
record "S21 apply by another role (not postgres) -> refused (WRONG_CALLER)" "$ok" "E=$E"
apply_tr2; E=$?
AFTER=$(impact); TR2V=$(verify_tr2)
ok=no; if [ "$E" -eq 0 ] && [ "$(tr2_state)" = "1|1|1|1|11" ] && [ "$AFTER" = "$BEFORE" ] && [ "$(rf "$TR2V" 7)" = "PASS" ]; then ok=yes; fi
record "S22 apply -> 4 tables + 11 functions, TR2 verify PASS (10), impact = before exactly" "$ok" "E=$E state=$(tr2_state) before=$BEFORE after=$AFTER TR2=$TR2V fails=$(fails_of "$TMP/tr2v.out") $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
V1=$(verdicts)
ok=no; if [ "$V1" = "$ALL8" ]; then ok=yes; fi
record "S23 A1 · D · P1 · P2 · 0021-P · D2 · TR (v2 state) · EX verify PASS after TR2" "$ok" "V=$V1 $(fails_of "$TMP/v.out")"
FP1=$(track_fp)
ok=no
if [ "$(rf "$FP1" 1)" = "$NEW_MD5" ] && [ "$(rf "$FP1" 4)" = "zell_order_definer" ] && [ "$(rf "$FP1" 5)" = "true" ] && [ "$(rf "$FP1" 6)" = "s" ] \
   && [ "$(rf "$FP1" 7)" = "$(rf "$FP0" 7)" ] && [ "$(rf "$FP1" 8)" = "$T1_ACL" ] && [ "$(rf "$FP1" 9)" = "$(rf "$FP0" 9)" ]; then ok=yes; fi
record "S24 track function: same oid, new md5, owner zell_order_definer, security definer, stable, search_path and EXECUTE exactly as T1" "$ok" "fp0=$FP0 fp1=$FP1"
apply_tr2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S25 apply twice -> refused (ALREADY_APPLIED)" "$ok" "E=$E"
run_ptest production; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021TR2_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S26 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"

# ── S3: فحوص التحقق: مفيش بصمة مجهولة ولا خليط ──
v2_def | awk '{print} /as \$fn\$$/ && !d {print "  -- ci tamper"; d = 1}' | su_file "$TMP/tamper.out"
VT=$(rf "$(verify_tr2)" 7)
v2_def | su_file "$TMP/restore.out"
ok=no; if [ "$VT" = "FAIL" ] && [ "$(rf "$(verify_tr2)" 7)" = "PASS" ] && [ "$(track_fp)" = "$FP1" ]; then ok=yes; fi
record "S30 changed track body (unknown md5) -> TR2 verify FAIL; restored verbatim -> PASS, fingerprint back" "$ok" "tampered=$VT $(tail -n 2 "$TMP/tamper.out" | tr '\n' ' ')"
t1_def | su_file "$TMP/mixed.out"
VX="$(rf "$(verify_tr)" 7)|$(rf "$(verify_tr2)" 7)"
v2_def | su_file "$TMP/restore2.out"
ok=no; if [ "$VX" = "FAIL|FAIL" ] && [ "$(rf "$(verify_tr)" 7)" = "PASS" ] && [ "$(rf "$(verify_tr2)" 7)" = "PASS" ] && [ "$(track_fp)" = "$FP1" ]; then ok=yes; fi
record "S31 mixed state (TR2 tables + T1 track body) -> TR and TR2 verify FAIL; v2 restored -> PASS" "$ok" "mixed=$VX $(tail -n 2 "$TMP/mixed.out" | tr '\n' ' ')"

# ── S4: السلوك ──
run_file "$FLOWS" "$TMP/flows.out"; E=$?; S=$(summary_of "$TMP/flows.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "36" ] && [ "$(rf "$S" 8)" = "0" ]; then ok=yes; fi
record "S40 flows (F00–F49) -> PASS (36 pass, 0 fail)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/flows.out") tail=$(tail -n 3 "$TMP/flows.out" | tr '\n' ' ' | cut -c1-600)"
ROW=$(q "select (select count(*) from public.zell_order_shipments) || '|' || (select count(*) from public.zell_order_shipments_log) || '|' || (select count(*) from public.zell_order_customer_updates) || '|' || (select count(*) from public.zell_order_customer_updates_log) || '|' || (select count(*) from public.orders)")
ok=no; if [ "$ROW" = "0|0|0|0|1" ] && [ "$(impact)" = "$AFTER" ] && [ "$(rf "$(verify_tr2)" 7)" = "PASS" ]; then ok=yes; fi
record "S41 flows left nothing (4 tables empty, only the base order, impact unchanged), TR2 verify PASS" "$ok" "row=$ROW"
R=$(srq <<'SQL'
select public.zell_create_order(p_items => '[{"productId":1,"lengthCm":300}]'::jsonb, p_customer_name => 'عميل CI', p_customer_phone => '01099999901',
         p_governorate => 'القاهرة', p_address => 'عنوان CI طويل كفاية', p_notes => null, p_idempotency_key => 'ci-0021tr2-committed-0001',
         p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64)) ->> 'order_number';
select public.zell_create_order(p_items => '[{"productId":1,"lengthCm":300}]'::jsonb, p_customer_name => 'عميل CI', p_customer_phone => '01099999902',
         p_governorate => 'القاهرة', p_address => 'عنوان CI طويل كفاية', p_notes => null, p_idempotency_key => 'ci-0021tr2-committed-0002',
         p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64)) ->> 'order_number';
SQL
)
N1=$(printf '%s\n' "$R" | sed -n 1p); N2=$(printf '%s\n' "$R" | sed -n 2p)
for P in 01099999901 01099999902; do
  OID=$(q "select o.id from public.orders o where o.customer_phone = '$P'")
  OUV=$(q "select o.updated_at from public.orders o where o.customer_phone = '$P'")
  as_user "$ADMIN_ID" "select public.zell_order_transition($OID, '$OUV'::timestamptz, 'confirmed') ->> 'status'" > "$TMP/conf_$P.out"
done
R1=$(as_user "$ADMIN_ID" "select public.zell_shipment_save('$N1', null, 'أرامكس', 'AWB-1', 'https://track.example.com/1', null, null) ->> 'changed'")
R2=$(as_user "$OWNER_ID" "select public.zell_customer_update_add('$N1', null, 'طلبك اتأكد') ->> 'changed'")
TR2V=$(verify_tr2); TRV=$(verify_tr)
ok=no
if [ -n "$N1" ] && [ -n "$N2" ] && [ "$R1" = "true" ] && [ "$R2" = "true" ] && [ "$(rf "$TR2V" 7)" = "PASS" ] && [ "$(rf "$TR2V" 8)" = "1" ] \
   && [ "$(rf "$TR2V" 9)" = "1" ] && [ "$(rf "$TRV" 7)" = "PASS" ] && [ "$(verdicts)" = "$ALL8" ]; then ok=yes; fi
record "S42 committed data (2 confirmed orders · shipment by admin · update by owner) -> TR2 verify PASS (V08 data = log), TR verify PASS on v2 keys, 8 verify PASS" "$ok" "n1=$N1 n2=$N2 r1=$R1 r2=$R2 TR2=$TR2V TR=$TRV fails=$(fails_of "$TMP/tr2v.out") $(fails_of "$TMP/trv.out")"
PRE=$(impact); ST=$(tr2_state)
rollback_tr2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021TR2_RB_HAS_DATA' && [ "$(tr2_state)" = "$ST" ] && [ "$(impact)" = "$PRE" ] && [ "$(rf "$(track_fp)" 1)" = "$NEW_MD5" ]; then ok=yes; fi
record "S43 rollback after a shipment / update -> refused (HAS_DATA), nothing changed" "$ok" "E=$E $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"
run_file "$TRROLLBACK" "$TMP/trrb.out"; E1=$?
run_approved "$EXROLLBACK" 'ci-0021ex-rollback' "$TMP/exrb.out"; E2=$?
ok=no
if [ "$E1" -ne 0 ] && has "$TMP/trrb.out" 'ZELL_0021TR_RB_TR2_APPLIED' && [ "$E2" -ne 0 ] && has "$TMP/exrb.out" 'ZELL_0021EX_RB_TR2_APPLIED' \
   && [ "$(tr2_state)" = "$ST" ] && [ "$(impact)" = "$PRE" ] && [ "$(rf "$(track_fp)" 1)" = "$NEW_MD5" ]; then ok=yes; fi
record "S44 TR rollback and EXPRESS rollback while v2 is applied -> refused (TR2_APPLIED), nothing changed" "$ok" "E1=$E1 E2=$E2 $(grep -m1 -E 'ZELL' "$TMP/trrb.out" | cut -c1-200) $(grep -m1 -E 'ZELL' "$TMP/exrb.out" | cut -c1-200)"
# التزامن: جلستين بنفس النسخة. الأولى بتمسك القفل 3 ثواني، والتانية بتستنى وبعدين بتاخد 45404 (مفيش كتابة مزدوجة).
psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/c1.out" 2>&1 <<SQL &
begin;
set local request.jwt.claims = '{"sub": "$ADMIN_ID", "role": "authenticated"}';
set local role authenticated;
select public.zell_shipment_save('$N2', null, 'شركة الجلسة الأولى', null, null, null, null) ->> 'changed';
select pg_sleep(3);
commit;
SQL
BG=$!
sleep 1
R2=$(as_user "$OWNER_ID" "select public.zell_shipment_save('$N2', null, 'شركة الجلسة التانية', null, null, null, null) ->> 'changed'")
wait "$BG"; E1=$?
ROW=$(q "select s.carrier || '|' || (select count(*) from public.zell_order_shipments_log l where l.order_id = s.order_id) from public.zell_order_shipments s join public.orders o on o.id = s.order_id where o.order_number = '$N2'")
ok=no; if [ "$E1" -eq 0 ] && printf '%s' "$R2" | grep -q '45404' && [ "$ROW" = "شركة الجلسة الأولى|1" ]; then ok=yes; fi
record "S45 concurrent first shipment save (two sessions, both expecting none) -> the second waits and gets 45404, one row + one log row" "$ok" "E1=$E1 c1=$(tr '\n' ' ' < "$TMP/c1.out" | cut -c1-200) r2=$(printf '%s' "$R2" | tr '\n' ' ' | cut -c1-200) row=$ROW"
UID1=$(q "select u.id from public.zell_order_customer_updates u join public.orders o on o.id = u.order_id where o.order_number = '$N1' order by u.id limit 1")
UV1=$(q "select u.updated_at from public.zell_order_customer_updates u where u.id = $UID1")
psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/c2.out" 2>&1 <<SQL &
begin;
set local request.jwt.claims = '{"sub": "$ADMIN_ID", "role": "authenticated"}';
set local role authenticated;
select public.zell_customer_update_edit('$N1', $UID1, '$UV1'::timestamptz, 'نص الجلسة الأولى') ->> 'changed';
select pg_sleep(3);
commit;
SQL
BG=$!
sleep 1
R2=$(as_user "$OWNER_ID" "select public.zell_customer_update_edit('$N1', $UID1, '$UV1'::timestamptz, 'نص الجلسة التانية') ->> 'changed'")
wait "$BG"; E1=$?
ROW=$(q "select u.text || '|' || (select count(*) from public.zell_order_customer_updates_log l where l.update_id = u.id) from public.zell_order_customer_updates u where u.id = $UID1")
ok=no; if [ "$E1" -eq 0 ] && printf '%s' "$R2" | grep -q '45404' && [ "$ROW" = "نص الجلسة الأولى|2" ] && [ "$(rf "$(verify_tr2)" 7)" = "PASS" ]; then ok=yes; fi
record "S46 concurrent edit of one update (two sessions, same version) -> the second waits and gets 45404, one edit log row, TR2 verify PASS" "$ok" "E1=$E1 c2=$(tr '\n' ' ' < "$TMP/c2.out" | cut -c1-200) r2=$(printf '%s' "$R2" | tr '\n' ' ' | cut -c1-200) row=$ROW"

# ── S5: الرجوع ──
if ! prep full; then record "S50 prep" "no" "see output"; fi
PRE=$(impact); FPPRE=$(track_fp)
apply_tr2; E1=$?
run_file "$ROLLBACK" "$TMP/rbna.out"; E=$?
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -ne 0 ] && has "$TMP/rbna.out" 'ZELL_0021TR2_RB_APPROVAL_MISSING' && [ "$(tr2_state)" = "1|1|1|1|11" ]; then ok=yes; fi
record "S50 rollback without the approval line -> refused, nothing changed" "$ok" "E1=$E1 E=$E"
rollback_tr2; E=$?
V2=$(verdicts); FPRB=$(track_fp)
ok=no
if [ "$E" -eq 0 ] && [ "$(tr2_state)" = "0|0|0|0|0" ] && [ "$FPRB" = "$FPPRE" ] && [ "$(rf "$FPRB" 1)" = "$T1_MD5" ] && [ "$(rf "$FPRB" 2)" = "$T1_DEF_MD5" ] \
   && [ "$(rf "$FPRB" 3)" = "$T1_DEF_SHA" ] && [ "$(rf "$FPRB" 8)" = "$T1_ACL" ] && [ "$(impact)" = "$PRE" ] \
   && [ "$V2" = "$ALL8" ]; then ok=yes; fi
record "S51 clean rollback -> TR2 objects gone, track function = T1 (md5 · functiondef md5 · sha256 · owner · grants · same oid), impact = before, 8 verify PASS (TR back to v1 keys)" "$ok" "E=$E state=$(tr2_state) fp=$FPRB pre=$PRE now=$(impact) V=$V2 $(tail -n 3 "$TMP/rb.out" | tr '\n' ' ')"
apply_tr2; E=$?; TR2V=$(verify_tr2)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$TR2V" 7)" = "PASS" ] && [ "$(verdicts)" = "$ALL8" ] && [ "$(rf "$(track_fp)" 1)" = "$NEW_MD5" ]; then ok=yes; fi
record "S52 re-apply after a clean rollback -> TR2 verify PASS, new md5" "$ok" "E=$E TR2=$TR2V fails=$(fails_of "$TMP/tr2v.out")"
v2_def | awk '{print} /as \$fn\$$/ && !d {print "  -- ci drift"; d = 1}' | su_file "$TMP/drift.out"
rollback_tr2; E=$?
v2_def | su_file "$TMP/undrift.out"
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021TR2_RB_TRACK_DRIFT' && [ "$(tr2_state)" = "1|1|1|1|11" ]; then ok=yes; fi
record "S53 rollback with a changed track body -> refused (TRACK_DRIFT), nothing changed" "$ok" "E=$E"
rollback_tr2; E=$?
cp "$TMP/rb.out" "$TMP/rb1.out"
rollback_tr2; E2=$?
ok=no; if [ "$E" -eq 0 ] && [ "$E2" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021TR2_RB_NOT_APPLIED' && [ "$(tr2_state)" = "0|0|0|0|0" ] && [ "$(track_fp)" = "$FPPRE" ]; then ok=yes; fi
record "S54 rollback twice -> second refused (NOT_APPLIED), T1 fingerprint kept" "$ok" "E=$E E2=$E2 $(tail -n 2 "$TMP/rb1.out" | tr '\n' ' ')"

# ── S6: حراس الـ preflight ──
q "create function public.ci_code_taken() returns text language sql as \$c\$ select 'ZELL_X 45433' \$c\$" > /dev/null
apply_tr2; E=$?
q "drop function public.ci_code_taken()" > /dev/null
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_CODE_TAKEN' && [ "$(tr2_state)" = "0|0|0|0|0" ]; then ok=yes; fi
record "S60 45433 already used by another function -> refused (CODE_TAKEN), nothing changed" "$ok" "E=$E"
t1_def | awk '{print} /as \$fn\$$/ && !d {print "  -- ci drift"; d = 1}' | su_file "$TMP/drift.out"
apply_tr2; E=$?
t1_def | su_file "$TMP/undrift.out"
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_TRACK_DRIFT' && [ "$(track_fp)" = "$FPPRE" ]; then ok=yes; fi
record "S61 track function not the T1 body -> refused (TRACK_DRIFT); T1 restored verbatim -> fingerprint back" "$ok" "E=$E fp=$(track_fp)"
su_sql "$DB" "grant execute on function public.zell_checkout_track_order(text) to authenticated"
apply_tr2; E=$?
su_sql "$DB" "revoke execute on function public.zell_checkout_track_order(text) from authenticated"
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_TRACK_DRIFT' && [ "$(track_fp)" = "$FPPRE" ]; then ok=yes; fi
record "S62 track function grants not T1 (extra EXECUTE) -> refused (TRACK_DRIFT)" "$ok" "E=$E fp=$(track_fp)"
q "create function public.zell_shipment_ci() returns integer language sql as \$c\$ select 1 \$c\$" > /dev/null
apply_tr2; E1=$?
q "drop function public.zell_shipment_ci()" > /dev/null
su_sql "$DB" "create schema ci_other authorization postgres"
q "create table ci_other.zell_order_customer_updates (id integer)" > /dev/null
apply_tr2; E2=$?
su_sql "$DB" "drop schema ci_other cascade"
ok=no
if [ "$E1" -ne 0 ] && [ "$E2" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_ALREADY_APPLIED' && [ "$(tr2_state)" = "0|0|0|0|0" ]; then ok=yes; fi
record "S63 a zell_shipment_* function / a table named like a new one in another schema -> refused (ALREADY_APPLIED)" "$ok" "E1=$E1 E2=$E2"
if ! prep no_ex; then record "S64 prep" "no" "see output"; fi
apply_tr2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR2_PREREQ_MISSING' && [ "$(tr2_state)" = "0|0|0|0|0" ]; then ok=yes; fi
record "S64 apply before EXPRESS-SHIPPING -> refused (PREREQ_MISSING), nothing changed" "$ok" "E=$E"

# ── S7: توافق حارس v1 المنشور مع رد v2 (طلبات حقيقية) ──
if ! prep full; then record "S70 prep" "no" "see output"; fi
printf '%s\n' "$SEED_SQL" | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - > "$TMP/seed.out" 2>&1; E1=$?
printf '%s\n' "$DUMP_SQL" | srq > "$TMP/v1.tsv"; E2=$?
apply_tr2; E3=$?
printf '%s\n' "$SEED2_SQL" | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - > "$TMP/seed2.out" 2>&1; E4=$?
printf '%s\n' "$DUMP_SQL" | srq > "$TMP/v2.tsv"; E5=$?
TR2V=$(verify_tr2); TRV=$(verify_tr)
ok=no
if [ "$E1" -eq 0 ] && [ "$E2" -eq 0 ] && [ "$E3" -eq 0 ] && [ "$E4" -eq 0 ] && [ "$E5" -eq 0 ] && grep -q '^SEED_OK 10$' "$TMP/seed.out" \
   && grep -q '^SEED2_OK 3/4$' "$TMP/seed2.out" && [ "$(wc -l < "$TMP/v1.tsv")" = "10" ] && [ "$(wc -l < "$TMP/v2.tsv")" = "10" ] \
   && [ "$(rf "$TR2V" 7)" = "PASS" ] && [ "$(rf "$TRV" 7)" = "PASS" ] && [ "$(verdicts)" = "$ALL8" ]; then ok=yes; fi
record "S70 10 real orders (all statuses, deliveries, items, coupon, payments, express, old order) + 3 shipments + 4 updates; v1 / v2 responses dumped; all verify PASS" "$ok" "E=$E1/$E2/$E3/$E4/$E5 seed=$(tail -n 3 "$TMP/seed.out" | tr '\n' ' ' | cut -c1-400) seed2=$(tail -n 3 "$TMP/seed2.out" | tr '\n' ' ' | cut -c1-300) TR2=$TR2V TR=$TRV fails=$(fails_of "$TMP/tr2v.out") $(fails_of "$TMP/trv.out")"
mkdir -p "$TMP/v1src"
GB=$(git -C "$ROOT" rev-parse "$V1_COMMIT:apps/storefront/lib/orders/trackOrder.ts" 2>&1)
git -C "$ROOT" archive "$V1_COMMIT" apps/storefront/lib/orders/trackOrder.ts packages/core/src 2> "$TMP/archive.err" | tar -x -C "$TMP/v1src" 2>> "$TMP/archive.err"
node "$GUARD" "$ROOT" "$TMP/v1src" "$TMP/v1.tsv" "$TMP/v2.tsv" > "$TMP/guard.out" 2>&1; E=$?
ok=no
if [ "$GB" = "$V1_GUARD_BLOB" ] && [ "$E" -eq 0 ] && grep -q '^ZELL_TR2_V1_GUARD orders=10 nonnull=10 same=10 raw_same=10 control_null=10$' "$TMP/guard.out"; then ok=yes; fi
record "S71 v1 guard (parseTrackedOrder from $V1_COMMIT, blob pinned) on the v2 responses = the v1 result exactly for all 10 orders (and the v1 keys of v2 = v1 raw)" "$ok" "blob=$GB E=$E $(tail -n 5 "$TMP/guard.out" | tr '\n' ' ' | cut -c1-900) $(head -c 300 "$TMP/archive.err")"

echo "ZELL_0021TR2_SQL_CI_RESULT pass=$PASS fail=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
