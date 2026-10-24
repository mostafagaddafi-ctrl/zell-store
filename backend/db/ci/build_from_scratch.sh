#!/usr/bin/env bash
# =====================================================================
# backend/db/ci/build_from_scratch.sh — BASELINE-OUTSIDE §4 / §5. CI ONLY.
# Builds the whole database from scratch on a DISPOSABLE PostgreSQL 17, from the explicit list
# backend/db/ci/build_from_scratch.list, then: compares with the step-0 / columns-read snapshots (§4-5),
# tests the baseline guards (§4-6), runs the smoke calls and the call-contract guard (§5).
# Platform: CI_SUPERUSER (default supabase_admin) runs platform_shim.sql + platform_default_privileges.sql only.
# Every listed file runs as postgres, which is NOT a superuser (CREATEROLE + BYPASSRLS, like Production).
# Isolation proof: ZELL_CI_DISPOSABLE_DB=yes, PGHOST=localhost, a cluster with no platform roles yet, a database
# created here, and zell.ci_scratch=on on it. zell.ci_scratch is a guard against mistakes, not a security boundary.
# NEVER run against Supabase / Production. Stops at the FIRST failure of the build.
# =====================================================================
set -uo pipefail

if [ "${ZELL_CI_DISPOSABLE_DB:-}" != "yes" ]; then echo "refusing: disposable CI database only" >&2; exit 2; fi
case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DBDIR="$ROOT/backend/db"
CI="$DBDIR/ci"
LIST="$CI/build_from_scratch.list"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB=zell_baseline_ci
APPROVED_LABEL=ci-baseline-build
TMP="$(mktemp -d)"
LOG="${ZELL_CI_LOG_DIR:-$TMP}"
mkdir -p "$LOG"
PASS=0
FAIL=0
SEEN=" "

record() {
  SEEN="$SEEN$(printf '%s' "$1" | cut -d' ' -f1) "
  if [ "$2" = "yes" ]; then echo "CASE PASS $1"; PASS=$((PASS + 1)); else echo "CASE FAIL $1 :: $3"; FAIL=$((FAIL + 1)); fi
}
# A run counts as successful ONLY if every mandatory check ran: no silent skip can turn into a pass.
seen_count() { printf '%s' "$SEEN" | tr ' ' '\n' | grep -cx "$1" || true; }
finish() {
  if [ "$FAIL" -eq 0 ]; then
    missing=""
    for id in P01 P02 P03 C01 F01 F02 F03 F04 S01 K01 K02; do [ "$(seen_count "$id")" = "1" ] || missing="$missing $id"; done
    nb=$(printf '%s' "$SEEN" | tr ' ' '\n' | grep -cE '^B[0-9]+$' || true)
    [ "$nb" = "${EXPECTED_STEPS:-x}" ] || missing="$missing B($nb/${EXPECTED_STEPS:-?})"
    for g in G2 G3 G4; do [ "$(seen_count "$g")" = "${EXPECTED_BASELINE:-x}" ] || missing="$missing $g($(seen_count "$g")/${EXPECTED_BASELINE:-?})"; done
    if [ -n "$missing" ]; then echo "CASE FAIL R01 incomplete run (mandatory checks missing):$missing"; FAIL=$((FAIL + 1)); fi
  fi
  echo "ZELL_BASELINE_BUILD_RESULT pass=$PASS fail=$FAIL"
  # A fingerprint self-test (F01/F02) runs this script's functions in a subshell: it must never delete the parent's TMP.
  [ -n "${ZELL_FP_SELFTEST:-}" ] || rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED at the first failure: $1"; finish; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
su_t() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
# Fingerprint (§4-6). fp DB LABEL sets FPV. Accepted ONLY when psql exits 0, its error stream is empty and its output is
# exactly ONE line of 32 hex characters. Output and errors are kept apart in the log folder. Anything else STOPS the whole run
# as FAILED (it can never be read as "unchanged"). FP_SQL can be pointed at a broken copy by the F01/F02 self-tests only.
FP_SQL="$CI/baseline_fingerprint.sql"
FPV=""
fp() {
  local out="$LOG/fp_$2.out" err="$LOG/fp_$2.err" rc lines
  FPV=""
  psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$1" -f "$FP_SQL" < /dev/null > "$out" 2> "$err"; rc=$?
  lines=$(grep -c '' "$out" || true)
  if [ "$rc" -ne 0 ] || [ -s "$err" ] || [ "$lines" != "1" ] || ! grep -Eqx '[0-9a-f]{32}' "$out"; then
    stop "F00 fingerprint $2 could not be computed" "rc=$rc lines=$lines out=$(head -c 200 "$out" | tr '\n' ' ') err=$(tailof "$err")"
  fi
  FPV=$(cat "$out")
}
tailof() { tail -n 6 "$1" | tr '\n' ' ' | cut -c1-600; }

# ---- 0) fresh disposable cluster + build database ----
# The list itself is checked first: kinds known, every path exactly once, files present.
EXPECTED_STEPS=$(awk -F'|' '$1 ~ /^(apply|baseline|fixture|check)$/' "$LIST" | wc -l | tr -d ' ')
EXPECTED_BASELINE=$(awk -F'|' '$1 == "baseline"' "$LIST" | wc -l | tr -d ' ')
dups=$(awk -F'|' '$1 !~ /^#/ && NF >= 2 {print $2}' "$LIST" | sort | uniq -d | tr '\n' ' ')
badkind=$(awk -F'|' '$1 !~ /^#/ && NF >= 1 && $1 != "" && $1 !~ /^(apply|baseline|fixture|check|exclude)$/ {print $1}' "$LIST" | tr '\n' ' ')
if [ -n "$dups" ] || [ -n "$badkind" ] || [ "$EXPECTED_STEPS" -lt 1 ] || [ "$EXPECTED_BASELINE" -lt 1 ]; then
  echo "refusing: invalid build list (duplicates: $dups / unknown kinds: $badkind / steps=$EXPECTED_STEPS baseline=$EXPECTED_BASELINE)" >&2; exit 2
fi
echo "LIST steps=$EXPECTED_STEPS baseline=$EXPECTED_BASELINE excluded=$(awk -F'|' '$1 == "exclude"' "$LIST" | wc -l | tr -d ' ')"
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','pgbouncer')")
if [ "$fresh" != "0" ]; then echo "refusing: cluster already has platform roles (not a fresh disposable cluster)" >&2; exit 2; fi
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$LOG/createdb.log" 2>&1 || stop "B00 create build database" "$(tailof "$LOG/createdb.log")"
su_f "$DB" "$CI/platform_shim.sql" > "$LOG/platform_shim.log" 2>&1 || stop "P01 platform_shim.sql" "$(tailof "$LOG/platform_shim.log")"
record "P01 platform shim (extensions before pgcrypto, roles, auth/storage minimum)" yes ""
su_f "$DB" "$CI/platform_default_privileges.sql" > "$LOG/platform_default_privileges.log" 2>&1 || stop "P02 platform_default_privileges.sql" "$(tailof "$LOG/platform_default_privileges.log")"
record "P02 current default privileges of public (simulation, §9-2)" yes ""
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolcreaterole::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
ok=no; [ "$shape" = "false,true,true" ] && ok=yes
record "P03 build role postgres is NOT superuser (CREATEROLE + BYPASSRLS)" "$ok" "$shape"
[ "$ok" = yes ] || finish

# ---- 1) build from the explicit list, as postgres ----
n=0
while IFS='|' read -r kind rel reason; do
  case "$kind" in ''|'#'*) continue ;; esac
  if [ "$kind" = "exclude" ]; then echo "EXCLUDED $rel :: $reason"; continue; fi
  case "$kind" in apply|baseline|fixture|check) ;; *) stop "B01 build list kind" "unknown kind '$kind' for $rel" ;; esac
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list file" "missing $rel"
  n=$((n + 1))
  tag=$(printf '%02d' "$n")
  log="$LOG/build_$tag.log"
  runf="$f"
  note=""
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/runtext_$tag.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$APPROVED_LABEL';/" "$f" > "$runf"
    grep -qx "set local zell.approved_by = '$APPROVED_LABEL';" "$runf" || stop "B $tag $rel" "approved_by run-text line not inserted"
    note=" (approved_by run text)"
  fi
  if pg_f "$DB" "$runf" > "$log" 2>&1; then
    record "B$tag $kind $rel$note" yes ""
  else
    stop "B$tag $kind $rel$note" "$(tailof "$log")"
  fi
done < "$LIST"

# ---- 2) comparisons with the snapshots (§4-5) ----
su_t "$DB" "$CI/baseline_compare.sql" > "$LOG/compare.log" 2>&1; rc=$?
grep -E '^CMP (PASS|FAIL|DIFF) ' "$LOG/compare.log" | sed 's/^CMP /COMPARE /' | cut -c1-900
fails=$(grep -c '^CMP FAIL ' "$LOG/compare.log" || true)
passes=$(grep -c '^CMP PASS ' "$LOG/compare.log" || true)
expected=$(grep -E '^CMP EXPECTED [0-9]+$' "$LOG/compare.log" | awk '{print $3}' | tail -n 1)
ok=no; [ "$rc" -eq 0 ] && [ "$fails" = "0" ] && [ -n "$expected" ] && [ "$expected" -gt 0 ] && [ "$passes" = "$expected" ] && ok=yes
record "C01 built database = step-0 / columns / orders snapshots ($passes of ${expected:-?} checks)" "$ok" "rc=$rc fails=$fails $(tailof "$LOG/compare.log")"

# ---- 3) guard tests (§4-6) ----
# 3a) MANDATORY fingerprint self-tests, before any guard test relies on the fingerprint.
su_q postgres -c "create database zell_fp_selftest" -c "alter database zell_fp_selftest set zell.ci_scratch = 'on'" > "$LOG/fp_selftest_db.log" 2>&1 \
  || stop "F00 create fingerprint self-test database" "$(tailof "$LOG/fp_selftest_db.log")"
# F01: a fingerprint computation that ERRORS must end the run as FAILED (not "unchanged").
sed 's/pg_catalog\.md5(coalesce/pg_catalog.md5_does_not_exist(coalesce/' "$CI/baseline_fingerprint.sql" > "$TMP/fp_broken_error.sql"
( export ZELL_FP_SELFTEST=1; FP_SQL="$TMP/fp_broken_error.sql"; LOG="$TMP/f01"; mkdir -p "$LOG"; PASS=0; FAIL=0; fp zell_fp_selftest f01; echo "F01_NOT_STOPPED value=$FPV"; exit 0 ) > "$LOG/selftest_f01.log" 2>&1; rc=$?
ok=no; [ "$rc" -ne 0 ] && grep -q 'STOPPED at the first failure: F00 fingerprint f01' "$LOG/selftest_f01.log" && ! grep -q 'F01_NOT_STOPPED' "$LOG/selftest_f01.log" && ok=yes
record "F01 deliberately broken fingerprint (SQL error) is refused and ends the run as FAILED" "$ok" "rc=$rc $(tailof "$LOG/selftest_f01.log")"
# F02: a fingerprint that returns more than one line (even valid-looking hex) must also end the run as FAILED.
{ cat "$CI/baseline_fingerprint.sql"; printf '%s\n' "select pg_catalog.md5('second line');"; } > "$TMP/fp_broken_lines.sql"
( export ZELL_FP_SELFTEST=1; FP_SQL="$TMP/fp_broken_lines.sql"; LOG="$TMP/f02"; mkdir -p "$LOG"; PASS=0; FAIL=0; fp zell_fp_selftest f02; echo "F02_NOT_STOPPED value=$FPV"; exit 0 ) > "$LOG/selftest_f02.log" 2>&1; rc=$?
ok=no; [ "$rc" -ne 0 ] && grep -q 'STOPPED at the first failure: F00 fingerprint f02' "$LOG/selftest_f02.log" && ! grep -q 'F02_NOT_STOPPED' "$LOG/selftest_f02.log" && ok=yes
record "F02 deliberately broken fingerprint (two output lines) is refused and ends the run as FAILED" "$ok" "rc=$rc $(tailof "$LOG/selftest_f02.log")"
# F03: a known DESIGN change in the isolated self-test database must change the fingerprint.
fp zell_fp_selftest f03_before; a0=$FPV
su_q zell_fp_selftest -c "create table public.zell_fp_probe (id integer)" > "$LOG/selftest_f03.log" 2>&1 || stop "F03 known design change" "$(tailof "$LOG/selftest_f03.log")"
fp zell_fp_selftest f03_after; a1=$FPV
ok=no; [ "$a0" != "$a1" ] && ok=yes
record "F03 known design change (create table) changes the fingerprint" "$ok" "fp=$a0/$a1"
# F04: a known ROW-COUNT change in the same isolated database must change the fingerprint.
su_q zell_fp_selftest -c "insert into public.zell_fp_probe values (1)" > "$LOG/selftest_f04.log" 2>&1 || stop "F04 known row-count change" "$(tailof "$LOG/selftest_f04.log")"
fp zell_fp_selftest f04_after; a2=$FPV
ok=no; [ "$a1" != "$a2" ] && ok=yes
record "F04 known row-count change (one insert) changes the fingerprint" "$ok" "fp=$a1/$a2"

# 3b) guard tests, using the verified fingerprint.
fp "$DB" g2_before; before=$FPV
for b in $(awk -F'|' '$1=="baseline"{print $2}' "$LIST"); do
  name=$(basename "$b" .sql)
  pg_f "$DB" "$DBDIR/$b" > "$LOG/guard_rerun_$name.log" 2>&1; rc=$?
  fp "$DB" "g2_after_$name"; after=$FPV
  ok=no; [ "$rc" -ne 0 ] && grep -q 'ZELL_BASELINE_[A-Z0-9_]*_ALREADY_PRESENT' "$LOG/guard_rerun_$name.log" && [ "$before" = "$after" ] && ok=yes
  record "G2 re-running completed stage $name is refused, design fingerprint unchanged" "$ok" "rc=$rc fp=$before/$after $(tailof "$LOG/guard_rerun_$name.log")"
done
su_q postgres -c "create database zell_guard_noscratch" > "$LOG/guard_db.log" 2>&1 || stop "G0 create guard database zell_guard_noscratch" "$(tailof "$LOG/guard_db.log")"
su_q postgres -c "create database zell_guard_empty" -c "alter database zell_guard_empty set zell.ci_scratch = 'on'" >> "$LOG/guard_db.log" 2>&1 || stop "G0 create guard database zell_guard_empty" "$(tailof "$LOG/guard_db.log")"
for b in $(awk -F'|' '$1=="baseline"{print $2}' "$LIST"); do
  name=$(basename "$b" .sql)
  fp zell_guard_noscratch "g3_before_$name"; f0=$FPV
  pg_f zell_guard_noscratch "$DBDIR/$b" > "$LOG/guard_noscratch_$name.log" 2>&1; rc=$?
  fp zell_guard_noscratch "g3_after_$name"; f1=$FPV
  ok=no; [ "$rc" -ne 0 ] && grep -q 'ZELL_BASELINE_NOT_SCRATCH' "$LOG/guard_noscratch_$name.log" && [ "$f0" = "$f1" ] && ok=yes
  record "G3 $name without zell.ci_scratch=on is refused before any change" "$ok" "rc=$rc fp=$f0/$f1 $(tailof "$LOG/guard_noscratch_$name.log")"
  fp zell_guard_empty "g4_before_$name"; e0=$FPV
  pg_f zell_guard_empty "$DBDIR/$b" > "$LOG/guard_empty_$name.log" 2>&1; rc=$?
  fp zell_guard_empty "g4_after_$name"; e1=$FPV
  ok=no; [ "$rc" -ne 0 ] && grep -q 'ZELL_BASELINE_[A-Z0-9_]*_REQUIRED_MISSING' "$LOG/guard_empty_$name.log" && [ "$e0" = "$e1" ] && ok=yes
  record "G4 $name without its earlier stages is refused before any change" "$ok" "rc=$rc fp=$e0/$e1 $(tailof "$LOG/guard_empty_$name.log")"
done

# ---- 4) smoke calls of the six functions, rolled back (§5) ----
pg_f "$DB" "$CI/baseline_smoke.sql" > "$LOG/smoke.log" 2>&1; rc=$?
line=$(grep -E '^ZELL_SMOKE ' "$LOG/smoke.log" | tail -n 1)
echo "$line"
ok=no
if [ "$rc" -eq 0 ] && printf '%s\n' "$line" | grep -Eq 'valid_benefits=t reorder_products=([0-9]+)/\1 reorder_images=2/2 set_primary=t save_identity=t save_shipping=t ship_keys=4 synthetic_ship_row=[tf] synthetic_row_rolled_back=t'; then ok=yes; fi
record "S01 smoke calls of the six functions as service_role (rolled back)" "$ok" "rc=$rc $line $(tailof "$LOG/smoke.log")"

# ---- 5) call-contract guard (§5) ----
if node "$CI/call_contract.mjs" --root "$ROOT" --policy "$CI/call_contract_policy.json" --sql "$LOG/call_contract_check.sql" > "$LOG/call_contract_static.log" 2>&1; then
  record "K01 call sites extracted; every non-parseable site is in the reviewed exceptions" yes "$(grep -E '^ZELL_CALLS ' "$LOG/call_contract_static.log")"
  su_t "$DB" "$LOG/call_contract_check.sql" > "$LOG/call_contract_db.log" 2>&1; rc=$?
  grep -E '^CALL FAIL ' "$LOG/call_contract_db.log" | head -n 40
  fails=$(grep -c '^CALL FAIL ' "$LOG/call_contract_db.log" || true)
  passes=$(grep -c '^CALL PASS ' "$LOG/call_contract_db.log" || true)
  checks=$(grep -oE '"checks":[0-9]+' "$LOG/call_contract_static.log" | head -n 1 | cut -d: -f2)
  ok=no; [ "$rc" -eq 0 ] && [ "$fails" = "0" ] && [ -n "$checks" ] && [ "$checks" -gt 0 ] && [ "$passes" = "$checks" ] && ok=yes
  record "K02 called functions exist, signatures fit the sent names, role has EXECUTE, forbidden roles refused ($passes of ${checks:-?} checks)" "$ok" "rc=$rc fails=$fails $(tailof "$LOG/call_contract_db.log")"
else
  record "K01 call sites extracted; every non-parseable site is in the reviewed exceptions" no "$(tailof "$LOG/call_contract_static.log")"
  record "K02 call contract on the built database (not run: K01 failed)" no "skipped because K01 failed"
fi

finish
