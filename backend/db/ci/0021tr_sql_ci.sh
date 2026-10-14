#!/usr/bin/env bash
# 0021-TR W1 — اختبار SQL في CI: Postgres 17 مؤقت + shim الـ CI بتاع P1 بالحرف (init_cluster و reset_db و IMPACT_SQL من
# backend/db/ci/0021p1_sql_ci.sh: 0021-P ← A1 ← D)، وفوقه P1 و P2 و D2 (شكل Production، ومالك zell_create_order = postgres،
# و RLS على order_items)، وبعدين 0021-TR (zell_checkout_track_order).
# بيغطي: شكل المعاملة · md5 الجسم · مفيش أكواد جديدة · ptest (قبل التطبيق) · رفض التطبيق من غير موافقة ومن متصل تاني ·
# التطبيق · رفض الإعادة · verify (TR · A1 · D · P1 · P2 · 0021-P · D2) · استعلام الأثر قبل/بعد · طلبات بالسبع حالات ·
# موعد مؤكد ومفضّل ومن غير موعد · سطور متر وقطعة وطلب من غير سطور · مفيش بيانات عميل في الرد · شكل غلط / مش موجود = null ·
# الصلاحيات (service_role بس) · الرجوع وإعادة التطبيق · حراس الـ preflight.
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
OLD19="$MIG/0019_coupons.sql"
A1="$MIG/0021a_a1_order_cycle.sql"
A1VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
DAPPLY="$MIG/0021d_preferred_delivery.sql"
DVERIFY="$MIG/0021d_preferred_delivery_verify.sql"
ENGINE="$MIG/0021p_erp_access.sql"
ADAPTER="$MIG/0021p_zell_erp_access.sql"
PVERIFY="$MIG/0021p_access_verify.sql"
P1APPLY="$MIG/0021a_p1_payments.sql"
P1VERIFY="$MIG/0021a_p1_payments_verify.sql"
P2APPLY="$MIG/0021a_p2_checkout_fee.sql"
P2VERIFY="$MIG/0021a_p2_checkout_fee_verify.sql"
D2APPLY="$MIG/0021d2_delivery_settings.sql"
D2VERIFY="$MIG/0021d2_delivery_settings_verify.sql"
APPLY="$MIG/0021tr_track_order.sql"
PTEST="$MIG/0021tr_track_order_ptest.sql"
VERIFY="$MIG/0021tr_track_order_verify.sql"
ROLLBACK="$MIG/0021tr_track_order_rollback.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
OLD_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text'
# شكل Production (08-HANDOFF-NOW): مالك zell_create_order = postgres.
CO_OWNER=postgres

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
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
apply_tr() { run_approved "$APPLY" 'ci-0021tr' "$TMP/apply.out"; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
vsum() { run_file "$1" "$TMP/v.out"; summary_of "$TMP/v.out"; }
# الأحكام: A1 · D · P1 · P2 · 0021-P (العمود 11) · D2
verdicts_old() { printf '%s|%s|%s|%s|%s|%s' "$(rf "$(vsum "$A1VERIFY")" 7)" "$(rf "$(vsum "$DVERIFY")" 7)" "$(rf "$(vsum "$P1VERIFY")" 7)" "$(rf "$(vsum "$P2VERIFY")" 7)" "$(rf "$(vsum "$PVERIFY")" 11)" "$(rf "$(vsum "$D2VERIFY")" 7)"; }
verify_tr() { run_file "$VERIFY" "$TMP/trv.out"; summary_of "$TMP/trv.out"; }
# الحالة: الدالة موجودة · عدد الـ policy على order_items · عدد أعمدة order_items اللي zell_order_definer يقدر يقراها
tr_state() { q "select (to_regprocedure('public.zell_checkout_track_order(text)') is not null)::int || '|' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_items' and p.policyname = 'zell_order_definer_select') || '|' || (select count(*) from pg_attribute a where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('zell_order_definer', 'public.order_items', a.attname::text, 'SELECT'))"; }

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

# شكل Production قبل TR: الـ shim (0021-P ← A1 ← D) + P1 + P2 (+ D2)، و RLS على order_items (0002).
prep() {
  reset_db || return 1
  run_approved "$P1APPLY" 'ci-0021a-p1' "$TMP/p1.out" || { echo "--- p1.out"; tail -n 20 "$TMP/p1.out"; return 1; }
  run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2.out" || { echo "--- p2.out"; tail -n 20 "$TMP/p2.out"; return 1; }
  if [ "$1" = "with_d2" ]; then
    run_approved "$D2APPLY" 'ci-0021d2' "$TMP/d2.out" || { echo "--- d2.out"; tail -n 20 "$TMP/d2.out"; return 1; }
  fi
  su_sql "$DB" "alter table public.order_items enable row level security"
}

# طلبات تجربة بالسبع حالات (من غير triggers: session_replication_role = replica). كل خانة بيانات عميل فيها PII_
# علشان نتأكد إن مفيش حاجة منها بتطلع في رد الدالة.
seed() {
  psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" > "$TMP/seed.out" 2>&1 <<'SQL'
begin;
set local session_replication_role = replica;
insert into public.orders (order_number, status, customer_name, customer_phone, governorate, address, notes, internal_notes,
  subtotal_piastres, shipping_piastres, total_piastres, idempotency_key, request_hash, checkout_session_hash, receipt_token_hash,
  shipping_area, coupon_code, created_at,
  preferred_delivery_date, preferred_delivery_period, preferred_delivery_note,
  delivery_confirmed_date, delivery_confirmed_period, delivery_confirmed_note)
values
  ('FLM-TRNEWA', 'new', 'PII_NAME_1', 'PII_PHONE_1', 'PII_GOV', 'PII_ADDR_1', 'PII_NOTES', 'PII_INTERNAL',
   186000, 5000, 191000, 'PII_IDEM_1', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:00+00',
   '2026-11-01', 'morning', 'PII_PREF_NOTE', null, null, null),
  ('FLM-TRCNFA', 'confirmed', 'PII_NAME_2', 'PII_PHONE_2', 'PII_GOV', 'PII_ADDR_2', 'PII_NOTES', 'PII_INTERNAL',
   60000, 5000, 65000, 'PII_IDEM_2', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:01+00',
   '2026-11-02', 'noon', 'PII_PREF_NOTE', '2026-11-03', 'evening', 'PII_CONF_NOTE'),
  ('FLM-TRPRPA', 'preparing', 'PII_NAME_3', 'PII_PHONE_3', 'PII_GOV', 'PII_ADDR_3', 'PII_NOTES', 'PII_INTERNAL',
   60000, 5000, 65000, 'PII_IDEM_3', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:02+00',
   null, null, null, '2026-11-04', null, null),
  ('FLM-TRSHPA', 'shipped', 'PII_NAME_4', 'PII_PHONE_4', 'PII_GOV', 'PII_ADDR_4', 'PII_NOTES', 'PII_INTERNAL',
   60000, 5000, 65000, 'PII_IDEM_4', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:03+00',
   '2026-11-05', null, null, null, null, null),
  ('FLM-TRDLVA', 'delivered', 'PII_NAME_5', 'PII_PHONE_5', 'PII_GOV', 'PII_ADDR_5', 'PII_NOTES', 'PII_INTERNAL',
   60000, 5000, 65000, 'PII_IDEM_5', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:04+00',
   null, null, null, null, null, null),
  ('FLM-TRRFSA', 'refused', 'PII_NAME_6', 'PII_PHONE_6', 'PII_GOV', 'PII_ADDR_6', 'PII_NOTES', 'PII_INTERNAL',
   60000, 5000, 65000, 'PII_IDEM_6', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:05+00',
   null, null, null, null, null, null),
  ('FLM-TRCNLA', 'cancelled', 'PII_NAME_7', 'PII_PHONE_7', 'PII_GOV', 'PII_ADDR_7', 'PII_NOTES', 'PII_INTERNAL',
   0, 0, 0, 'PII_IDEM_7', 'PII_RHASH', 'PII_CSH', 'PII_RTH', 'PII_AREA', 'PII_COUPON', '2026-10-13 10:06+00',
   null, null, null, null, null, null);
insert into public.order_items (order_id, product_id, product_name_ar, unit_price_piastres, length_cm, width_cm,
                                line_total_piastres, sale_unit, quantity)
select o.id, v.pid, v.pname, v.unit, v.len, v.wid, v.line, v.kind, v.qty
  from (values
    (1, 'FLM-TRNEWA', 1, 'فيلم عازل', 52000, 300, 100, 156000, 'meter', 1),
    (2, 'FLM-TRNEWA', 3, 'أداة تركيب', 15000, null, null, 30000, 'piece', 2),
    (3, 'FLM-TRCNFA', 1, 'فيلم عازل', 30000, 200, null, 60000, 'meter', 1),
    (4, 'FLM-TRPRPA', 1, 'فيلم عازل', 30000, 200, 50, 60000, 'meter', 1),
    (5, 'FLM-TRSHPA', 1, 'فيلم عازل', 30000, 200, null, 60000, 'meter', 1),
    (6, 'FLM-TRDLVA', 1, 'فيلم عازل', 30000, 200, null, 60000, 'meter', 1),
    (7, 'FLM-TRRFSA', 1, 'فيلم عازل', 30000, 200, null, 60000, 'meter', 1)
  ) v(ord, num, pid, pname, unit, len, wid, line, kind, qty)
  join public.orders o on o.order_number = v.num
 order by v.ord;
commit;
SQL
}

init_cluster

# ── S0: الشكل والملفات ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021TR BODY'); M2=$(body_md5 "$PTEST" '0021TR BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no
if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] \
   && [ "$(grep -c '^begin;$' "$ROLLBACK")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"
N=$(cat "$APPLY" "$ROLLBACK" | grep -c 'errcode')
ok=no; if [ "$N" = "0" ]; then ok=yes; fi
record "S04 no new error codes in the migration / rollback" "$ok" "errcode lines=$N"

# ── S1: ptest قبل التطبيق ──
if ! prep with_d2; then record "S10 prep" "no" "see output"; fi
if ! seed; then record "S10 seed" "no" "$(tail -n 5 "$TMP/seed.out" | tr '\n' ' ')"; fi
BEFORE=$(impact)
V0=$(verdicts_old)
ok=no; if [ "$V0" = "PASS|PASS|PASS|PASS|PASS|PASS" ] && [ "$(tr_state)" = "0|0|0" ] \
  && [ "$(q "select count(*) from public.orders")" = "7" ] && [ "$(q "select count(*) from public.order_items")" = "7" ]; then ok=yes; fi
record "S10 baseline = Production shape (A1 · D · P1 · P2 · 0021-P · D2 verify PASS), no TR objects, 7 seeded orders" "$ok" "V=$V0 state=$(tr_state) impact=$BEFORE"
run_file "$PTEST" "$TMP/ptest.out"; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "6" ] && [ "$(rf "$S" 8)" = "0" ]; then ok=yes; fi
record "S11 ptest -> PASS (6 pass, 0 fail)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
ok=no; if [ "$(tr_state)" = "0|0|0" ] && [ "$(impact)" = "$BEFORE" ]; then ok=yes; fi
record "S12 ptest leaves nothing behind (no TR objects, impact unchanged)" "$ok" "state=$(tr_state) before=$BEFORE after=$(impact)"

# ── S2: التطبيق ──
run_file "$APPLY" "$TMP/noapproval.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/noapproval.out" 'ZELL_0021TR_APPROVAL_MISSING' && [ "$(tr_state)" = "0|0|0" ]; then ok=yes; fi
record "S20 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f <(approved "$APPLY" 'ci-0021tr') > "$TMP/wrongcaller.out" 2>&1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/wrongcaller.out" 'ZELL_0021TR_WRONG_CALLER' && [ "$(tr_state)" = "0|0|0" ]; then ok=yes; fi
record "S21 apply by another role (not postgres) -> refused (WRONG_CALLER)" "$ok" "E=$E"
apply_tr; E=$?
AFTER=$(impact); TRV=$(verify_tr)
ok=no; if [ "$E" -eq 0 ] && [ "$(tr_state)" = "1|1|8" ] && [ "$AFTER" = "$BEFORE" ] && [ "$(rf "$TRV" 7)" = "PASS" ]; then ok=yes; fi
record "S22 apply -> function + 1 policy + 8 readable columns, TR verify PASS (7), impact unchanged" "$ok" "E=$E state=$(tr_state) before=$BEFORE after=$AFTER TR=$TRV fails=$(fails_of "$TMP/trv.out") $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
V1=$(verdicts_old)
ok=no; if [ "$V1" = "PASS|PASS|PASS|PASS|PASS|PASS" ]; then ok=yes; fi
record "S23 A1 · D · P1 · P2 · 0021-P · D2 verify still PASS after TR" "$ok" "V=$V1"
apply_tr; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR_ALREADY_APPLIED' && [ "$(impact)" = "$BEFORE" ] && [ "$(tr_state)" = "1|1|8" ]; then ok=yes; fi
record "S24 apply twice -> refused (ALREADY_APPLIED)" "$ok" "E=$E"
run_file "$PTEST" "$TMP/ptest.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021TR_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S25 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"

# ── S3: الرد (بدور service_role زي المتجر) ──
R=$(srq <<'SQL'
select bool_and(
         (select array_agg(k order by k collate "C") from jsonb_object_keys(t.r) k)
           = array['created_at', 'delivery', 'items', 'order_number', 'status', 'total_piastres']
         and t.r ->> 'order_number' = t.order_number
         and t.r ->> 'status' = t.status
         and (t.r ->> 'total_piastres')::integer = t.total_piastres
         and (t.r ->> 'created_at')::timestamptz = t.created_at)
       || '|' || count(*) || '|' || count(distinct t.status)
  from (select o.order_number, o.status, o.total_piastres, o.created_at,
               public.zell_checkout_track_order(o.order_number) as r
          from public.orders o) t;
SQL
)
ok=no; if [ "$R" = "true|7|7" ]; then ok=yes; fi
record "S30 all 7 statuses: exactly the 6 keys, order_number / status / total / created_at = the order" "$ok" "$R"
R=$(srq <<'SQL'
select bool_and(public.zell_checkout_track_order(e.n) -> 'delivery' = e.d) || '|' || count(*)
  from (values
    ('FLM-TRNEWA', '{"kind": "preferred", "date": "2026-11-01", "period": "morning"}'::jsonb),
    ('FLM-TRCNFA', '{"kind": "confirmed", "date": "2026-11-03", "period": "evening"}'),
    ('FLM-TRPRPA', '{"kind": "confirmed", "date": "2026-11-04", "period": null}'),
    ('FLM-TRSHPA', '{"kind": "preferred", "date": "2026-11-05", "period": null}'),
    ('FLM-TRDLVA', 'null'),
    ('FLM-TRRFSA', 'null'),
    ('FLM-TRCNLA', 'null')) e(n, d);
SQL
)
ok=no; if [ "$R" = "true|7" ]; then ok=yes; fi
record "S31 delivery: confirmed wins over preferred · preferred only · no period · none = null" "$ok" "$R"
R=$(srq <<'SQL'
select bool_and(public.zell_checkout_track_order(e.n) -> 'items' = e.i) || '|' || count(*)
  from (values
    ('FLM-TRNEWA', '[{"product_name_ar": "فيلم عازل", "length_cm": 300, "width_cm": 100, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 156000}, {"product_name_ar": "أداة تركيب", "length_cm": null, "width_cm": null, "quantity": 2, "sale_unit": "piece", "line_total_piastres": 30000}]'::jsonb),
    ('FLM-TRCNFA', '[{"product_name_ar": "فيلم عازل", "length_cm": 200, "width_cm": null, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 60000}]'),
    ('FLM-TRPRPA', '[{"product_name_ar": "فيلم عازل", "length_cm": 200, "width_cm": 50, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 60000}]'),
    ('FLM-TRSHPA', '[{"product_name_ar": "فيلم عازل", "length_cm": 200, "width_cm": null, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 60000}]'),
    ('FLM-TRDLVA', '[{"product_name_ar": "فيلم عازل", "length_cm": 200, "width_cm": null, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 60000}]'),
    ('FLM-TRRFSA', '[{"product_name_ar": "فيلم عازل", "length_cm": 200, "width_cm": null, "quantity": 1, "sale_unit": "meter", "line_total_piastres": 60000}]'),
    ('FLM-TRCNLA', '[]')) e(n, i);
SQL
)
ok=no; if [ "$R" = "true|7" ]; then ok=yes; fi
record "S32 items = the receipt projection in line order (meter with / without width · piece · no lines = [])" "$ok" "$R"
R=$(srq <<'SQL'
select (select count(*) from public.orders o
         where o.customer_name like 'PII%' and o.customer_phone like 'PII%' and o.address like 'PII%'
           and o.notes like 'PII%' and o.internal_notes like 'PII%' and o.coupon_code like 'PII%')
       || '|' || (select count(*) from public.orders o
                   where public.zell_checkout_track_order(o.order_number)::text like '%PII%');
SQL
)
ok=no; if [ "$R" = "7|0" ]; then ok=yes; fi
record "S33 no customer data in any response (name · phone · address · governorate · area · notes · delivery notes · coupon · hashes)" "$ok" "$R"
R=$(srq <<'SQL'
select bool_and(public.zell_checkout_track_order(v.x) is null) || '|' || count(*)
  from (values ('flm-trnewa'), ('FLM-trnewa'), ('TRNEWA'), ('FLMTRNEWA'), ('FLM TRNEWA'), ('FLM_TRNEWA'), (' FLM-TRNEWA'),
               ('FLM-TRNEWA '), ('FLM-TRNEW'), ('FLM-TRNEWAA'), ('FLM-TRNEWO'), ('FLM-TRNEW0'), ('FLM-TRNEWI'), ('FLM-TRNEW1'),
               ('FLM-TRNEW_'), ('FLM-TRNEW%'), ('FLM-ZZZZZZ'), (''), (null)) v(x);
SQL
)
ok=no; if [ "$R" = "true|19" ]; then ok=yes; fi
record "S34 wrong shape / not found -> SQL null (case · prefix · dash · spaces · O/0/I/1 · length · wildcards · empty · NULL)" "$ok" "$R"
RA=$(q "set role anon; select public.zell_checkout_track_order('FLM-TRNEWA')")
RU=$(q "set role authenticated; select public.zell_checkout_track_order('FLM-TRNEWA')")
ACL=$(q "select string_agg(x, ',' order by x) from (select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type as x from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.zell_checkout_track_order(text)'::regprocedure) s")
ok=no
if printf '%s' "$RA" | grep -q 'permission denied' && printf '%s' "$RU" | grep -q 'permission denied' \
   && [ "$ACL" = "service_role:EXECUTE,zell_order_definer:EXECUTE" ]; then ok=yes; fi
record "S35 EXECUTE: service_role only (anon / authenticated denied, no PUBLIC)" "$ok" "acl=$ACL anon=$(printf '%s' "$RA" | head -c 200) auth=$(printf '%s' "$RU" | head -c 200)"
R=$(q "select has_column_privilege('zell_order_definer', 'public.order_items', 'unit_price_piastres', 'SELECT') || '|' || has_column_privilege('zell_order_definer', 'public.order_items', 'product_id', 'SELECT') || '|' || has_table_privilege('zell_order_definer', 'public.order_items', 'SELECT') || '|' || has_any_column_privilege('zell_order_definer', 'public.order_items', 'INSERT,UPDATE,REFERENCES') || '|' || (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass)")
ok=no; if [ "$R" = "false|false|false|false|true" ]; then ok=yes; fi
record "S36 order_items: no other column / table / write privilege for zell_order_definer, RLS still on" "$ok" "$R"

# ── S4: الرجوع ──
PRE=$(impact)
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
V2=$(verdicts_old)
ok=no; if [ "$E" -eq 0 ] && [ "$(tr_state)" = "0|0|0" ] && [ "$(impact)" = "$PRE" ] && [ "$PRE" = "$BEFORE" ] && [ "$V2" = "PASS|PASS|PASS|PASS|PASS|PASS" ]; then ok=yes; fi
record "S40 rollback -> function, policy and column grants gone, impact = before, A1 · D · P1 · P2 · 0021-P · D2 PASS" "$ok" "E=$E state=$(tr_state) pre=$PRE now=$(impact) V=$V2 $(tail -n 3 "$TMP/rb.out" | tr '\n' ' ')"
apply_tr; E=$?; TRV=$(verify_tr)
ok=no; if [ "$E" -eq 0 ] && [ "$(tr_state)" = "1|1|8" ] && [ "$(rf "$TRV" 7)" = "PASS" ]; then ok=yes; fi
record "S41 re-apply after rollback -> TR verify PASS" "$ok" "E=$E TR=$TRV fails=$(fails_of "$TMP/trv.out")"
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
run_file "$ROLLBACK" "$TMP/rb2.out"; E2=$?
ok=no; if [ "$E" -eq 0 ] && [ "$E2" -ne 0 ] && has "$TMP/rb2.out" 'ZELL_0021TR_RB_NOT_APPLIED' && [ "$(tr_state)" = "0|0|0" ]; then ok=yes; fi
record "S42 rollback twice -> second refused (NOT_APPLIED)" "$ok" "E=$E E2=$E2"

# ── S5: حراس الـ preflight ──
su_sql "$DB" "grant select (unit_price_piastres) on table public.order_items to zell_order_definer"
apply_tr; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR_ALREADY_APPLIED' && [ "$(q "select (to_regprocedure('public.zell_checkout_track_order(text)') is null)::int")" = "1" ]; then ok=yes; fi
record "S50 zell_order_definer already has a privilege on order_items -> refused (ALREADY_APPLIED), nothing changed" "$ok" "E=$E"
su_sql "$DB" "revoke select (unit_price_piastres) on table public.order_items from zell_order_definer"
if ! prep p1_p2_only; then record "S51 prep" "no" "see output"; fi
apply_tr; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021TR_PREREQ_MISSING' && [ "$(tr_state)" = "0|0|0" ]; then ok=yes; fi
record "S51 apply before D2 -> refused (PREREQ_MISSING), nothing changed" "$ok" "E=$E"

echo "ZELL_0021TR_SQL_CI_RESULT pass=$PASS fail=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
