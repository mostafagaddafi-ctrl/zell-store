#!/usr/bin/env bash
# 0021-D2 W1 — اختبار SQL في CI: Postgres 17 مؤقت + shim الـ CI بتاع P1 بالحرف (init_cluster و reset_db من
# backend/db/ci/0021p1_sql_ci.sh: 0021-P ← A1 ← D)، وفوقه P1 و P2 (شكل Production، ومالك zell_create_order = postgres)،
# وبعدين 0021-D2.
# بيغطي: شكل المعاملة · md5 الجسم · الأكواد · ptest (قبل التطبيق) · رفض التطبيق من غير موافقة · التطبيق · رفض الإعادة ·
# verify (D2 · A1 · D · P1 · P2 · 0021-P) · استعلام الأثر قبل/بعد · سيناريوهات الإعداد (0021d2_flows.sql) · حفظ حقيقي ·
# الرجوع (رفض بسطر سجل، ونضيف) وإعادة التطبيق · حراس الـ preflight (المتصل · المتطلبات · الكود 45430).
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
APPLY="$MIG/0021d2_delivery_settings.sql"
PTEST="$MIG/0021d2_delivery_settings_ptest.sql"
VERIFY="$MIG/0021d2_delivery_settings_verify.sql"
ROLLBACK="$MIG/0021d2_delivery_settings_rollback.sql"
FLOWS="$CIDIR/0021d2_flows.sql"
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
D2_NAMES="'zell_delivery_settings_get','zell_delivery_settings_save','zell_checkout_delivery_settings'"

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
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
apply_d2() { run_approved "$APPLY" 'ci-0021d2' "$TMP/apply.out"; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
vsum() { run_file "$1" "$TMP/v.out"; summary_of "$TMP/v.out"; }
# الأحكام: A1 · D · P1 · P2 · 0021-P (العمود 11) · D2
verdicts_old() { printf '%s|%s|%s|%s|%s' "$(rf "$(vsum "$A1VERIFY")" 7)" "$(rf "$(vsum "$DVERIFY")" 7)" "$(rf "$(vsum "$P1VERIFY")" 7)" "$(rf "$(vsum "$P2VERIFY")" 7)" "$(rf "$(vsum "$PVERIFY")" 11)"; }
verify_d2() { run_file "$VERIFY" "$TMP/d2v.out"; summary_of "$TMP/d2v.out"; }
d2_state() { q "select (to_regclass('public.zell_delivery_settings') is not null)::int || '|' || (to_regclass('public.zell_delivery_settings_log') is not null)::int || '|' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ($D2_NAMES)) || '|' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_delivery_settings_trg_append_only')"; }

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

# شكل Production قبل D2: الـ shim (0021-P ← A1 ← D) + P1 + P2 (أو P1 بس لاختبار المتطلبات).
prep() {
  reset_db || return 1
  run_approved "$P1APPLY" 'ci-0021a-p1' "$TMP/p1.out" || { echo "--- p1.out"; tail -n 20 "$TMP/p1.out"; return 1; }
  if [ "$1" = "with_p2" ]; then
    run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2.out" || { echo "--- p2.out"; tail -n 20 "$TMP/p2.out"; return 1; }
  fi
}

init_cluster

# ── S0: الشكل والملفات ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify + flows" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021D2 BODY'); M2=$(body_md5 "$PTEST" '0021D2 BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no
if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] \
   && [ "$(grep -c '^begin;$' "$ROLLBACK")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"
CODES=$(grep -o "errcode = '[0-9]*'" "$APPLY" | grep -o '[0-9]\+' | sort -u | tr '\n' ' ')
ok=no; if [ "$CODES" = "45404 45413 45430 " ]; then ok=yes; fi
record "S04 error codes in the migration: 45430 (new) + 45404 / 45413 from A1 only" "$ok" "$CODES"
OTHER=$(grep -rl '45430' "$ROOT/backend" "$ROOT/apps" "$ROOT/packages" 2> /dev/null | grep -v '/0021d2_' | tr '\n' ' ')
ok=no; if [ -z "$OTHER" ]; then ok=yes; fi
record "S05 45430 unused anywhere else in backend / apps / packages" "$ok" "$OTHER"

# ── S1: ptest قبل التطبيق ──
if ! prep with_p2; then record "S10 prep" "no" "see output"; fi
BEFORE=$(impact)
V0=$(verdicts_old)
ok=no; if [ "$V0" = "PASS|PASS|PASS|PASS|PASS" ] && [ "$(d2_state)" = "0|0|0|0" ] \
  && [ "$(q "select count(*) from pg_proc where prosrc like '%45430%'")" = "0" ]; then ok=yes; fi
record "S10 baseline = Production shape (A1 · D · P1 · P2 · 0021-P verify PASS), no D2 objects, 45430 unused" "$ok" "V=$V0 state=$(d2_state) impact=$BEFORE"
run_file "$PTEST" "$TMP/ptest.out"; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "6" ] && [ "$(rf "$S" 8)" = "0" ]; then ok=yes; fi
record "S11 ptest -> PASS (6 pass, 0 fail)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
ok=no; if [ "$(d2_state)" = "0|0|0|0" ] && [ "$(impact)" = "$BEFORE" ]; then ok=yes; fi
record "S12 ptest leaves nothing behind (no D2 objects, impact unchanged)" "$ok" "state=$(d2_state) before=$BEFORE after=$(impact)"

# ── S2: التطبيق ──
run_file "$APPLY" "$TMP/noapproval.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/noapproval.out" 'ZELL_0021D2_APPROVAL_MISSING' && [ "$(d2_state)" = "0|0|0|0" ]; then ok=yes; fi
record "S20 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f <(approved "$APPLY" 'ci-0021d2') > "$TMP/wrongcaller.out" 2>&1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/wrongcaller.out" 'ZELL_0021D2_WRONG_CALLER' && [ "$(d2_state)" = "0|0|0|0" ]; then ok=yes; fi
record "S21 apply by another role (not postgres) -> refused (WRONG_CALLER)" "$ok" "E=$E"
apply_d2; E=$?
AFTER=$(impact); D2V=$(verify_d2)
ok=no; if [ "$E" -eq 0 ] && [ "$(d2_state)" = "1|1|3|1" ] && [ "$AFTER" = "$BEFORE" ] && [ "$(rf "$D2V" 7)" = "PASS" ]; then ok=yes; fi
record "S22 apply -> 2 tables + 3 functions + guard, D2 verify PASS (8), impact unchanged" "$ok" "E=$E state=$(d2_state) before=$BEFORE after=$AFTER D2=$D2V fails=$(fails_of "$TMP/d2v.out") $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
V1=$(verdicts_old)
ok=no; if [ "$V1" = "PASS|PASS|PASS|PASS|PASS" ]; then ok=yes; fi
record "S23 A1 · D · P1 · P2 · 0021-P verify still PASS after D2" "$ok" "V=$V1"
apply_d2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021D2_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S24 re-apply refused (ALREADY_APPLIED)" "$ok" "E=$E"
run_file "$PTEST" "$TMP/ptest.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021D2_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S25 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"

# ── S3: السيناريوهات (معاملة بترجع) ثم حفظ حقيقي ──
run_file "$FLOWS" "$TMP/flows.out"; E=$?; S=$(summary_of "$TMP/flows.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "24" ] && [ "$(rf "$S" 8)" = "0" ]; then ok=yes; fi
record "S30 flows (F01–F32) -> PASS (24 pass, 0 fail)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/flows.out") tail=$(tail -n 3 "$TMP/flows.out" | tr '\n' ' ' | cut -c1-600)"
ROW=$(q "select customer_choice_enabled || '|' || note_enabled || '|' || coalesce(note_text, '-') || '|' || (select count(*) from public.zell_delivery_settings_log) from public.zell_delivery_settings")
ok=no; if [ "$ROW" = "true|false|-|0" ]; then ok=yes; fi
record "S31 flows left nothing (row = current behaviour, log empty)" "$ok" "row=$ROW"
psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/save.out" 2>&1 <<SQL
begin;
select pg_catalog.set_config('request.jwt.claims', '{"sub": "$OWNER_ID", "role": "authenticated"}', true);
set local role authenticated;
select public.zell_delivery_settings_save((public.zell_delivery_settings_get() ->> 'updated_at')::timestamptz, false, true, 'هنتواصل معاك نحدد ميعاد التسليم');
commit;
SQL
E=$?
CHK=$(q "set role service_role; select public.zell_checkout_delivery_settings()::text")
D2V=$(verify_d2)
ok=no; if [ "$E" -eq 0 ] && [ "$CHK" = '{"note": "هنتواصل معاك نحدد ميعاد التسليم", "customer_choice_enabled": false}' ] \
  && [ "$(q "select count(*) from public.zell_delivery_settings_log")" = "1" ] && [ "$(rf "$D2V" 7)" = "PASS" ]; then ok=yes; fi
record "S32 committed owner save (session as authenticated) -> checkout reads it, 1 log row, D2 verify PASS (V07 = last log)" "$ok" "E=$E chk=$CHK D2=$D2V fails=$(fails_of "$TMP/d2v.out") $(tr '\n' ' ' < "$TMP/save.out" | cut -c1-400)"

# ── S4: الرجوع ──
PRE=$(impact); ST=$(d2_state)
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021D2_RB_HAS_CONFIG_DATA' && [ "$(d2_state)" = "$ST" ] && [ "$(impact)" = "$PRE" ] \
  && [ "$(q "select count(*) from public.zell_delivery_settings_log")" = "1" ]; then ok=yes; fi
record "S40 rollback after an owner save -> refused (HAS_CONFIG_DATA), nothing changed" "$ok" "E=$E $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"
if ! prep with_p2; then record "S41 prep" "no" "see output"; fi
PRE=$(impact)
apply_d2; E1=$?
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
V2=$(verdicts_old)
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -eq 0 ] && [ "$(d2_state)" = "0|0|0|0" ] && [ "$(impact)" = "$PRE" ] && [ "$V2" = "PASS|PASS|PASS|PASS|PASS" ]; then ok=yes; fi
record "S41 clean rollback (no save) -> D2 objects gone, impact = before, A1 · D · P1 · P2 · 0021-P PASS" "$ok" "E1=$E1 E=$E state=$(d2_state) pre=$PRE now=$(impact) V=$V2 $(tail -n 3 "$TMP/rb.out" | tr '\n' ' ')"
apply_d2; E=$?; D2V=$(verify_d2)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$D2V" 7)" = "PASS" ]; then ok=yes; fi
record "S42 re-apply after a clean rollback -> D2 verify PASS" "$ok" "E=$E D2=$D2V"
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
run_file "$ROLLBACK" "$TMP/rb2.out"; E2=$?
ok=no; if [ "$E" -eq 0 ] && [ "$E2" -ne 0 ] && has "$TMP/rb2.out" 'ZELL_0021D2_RB_NOT_APPLIED'; then ok=yes; fi
record "S43 rollback twice -> second refused (NOT_APPLIED)" "$ok" "E=$E E2=$E2"

# ── S5: حراس الـ preflight ──
q "create function public.ci_code_taken() returns text language sql as \$c\$ select 'ZELL_X 45430' \$c\$" > /dev/null
apply_d2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021D2_CODE_TAKEN' && [ "$(d2_state)" = "0|0|0|0" ]; then ok=yes; fi
record "S50 45430 already used by another function -> refused (CODE_TAKEN), nothing changed" "$ok" "E=$E"
q "drop function public.ci_code_taken()" > /dev/null
if ! prep p1_only; then record "S51 prep" "no" "see output"; fi
apply_d2; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021D2_PREREQ_MISSING' && [ "$(d2_state)" = "0|0|0|0" ]; then ok=yes; fi
record "S51 apply before P2 -> refused (PREREQ_MISSING), nothing changed" "$ok" "E=$E"

echo "ZELL_0021D2_SQL_CI_RESULT pass=$PASS fail=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
