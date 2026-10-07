#!/usr/bin/env bash
# 0021-P — اختبار SQL الدائم في CI: Postgres 17 مؤقت + shim شبه Supabase (postgres مش superuser وعنده CREATEROLE،
# service_role/anon/authenticated/authenticator، وdefault privileges بتدّي كل حاجة لـ anon/authenticated/service_role).
# بيغطي: md5 الجسمين في الـ ptest · ptest (ci + production) · التطبيق · verify · رفض إعادة التطبيق · المحوّل من غير موافقة
# أو من غير محرك · rollback (من غير تأكيد / نضيف / بعد استخدام حقيقي) · freeze · التزامن باتصالين.
# ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
set -uo pipefail

if [ "${ZELL_CI_DISPOSABLE_DB:-}" != "yes" ]; then
  echo "refusing: disposable CI database only" >&2
  exit 2
fi
case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIG="$ROOT/backend/db/migrations"
ENGINE="$MIG/0021p_erp_access.sql"
ADAPTER="$MIG/0021p_zell_erp_access.sql"
ROLLBACK="$MIG/0021p_access_rollback.sql"
PTEST="$MIG/0021p_access_ptest.sql"
VERIFY="$MIG/0021p_access_verify.sql"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
A='00000000-0000-0000-0000-00000000000a'
B='00000000-0000-0000-0000-00000000000b'
X='00000000-0000-0000-0000-00000000000c'
Y='00000000-0000-0000-0000-00000000000d'
ISOLATIONS=("READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE")

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
run_pg() { { printf '\\set VERBOSITY verbose\n'; cat; } | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" > "$2" 2>&1; }
sqlstate() { grep -o 'ERROR:  [0-9A-Z]\{5\}' "$1" | head -n 1 | awk '{print $2}'; }
has() { grep -q -- "$2" "$1"; }

init_cluster() {
  psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d postgres > /dev/null <<'SQL'
do $r$
begin
  if pg_catalog.to_regrole('postgres') is null then
    create role postgres login createrole nosuperuser password 'ci';
  end if;
  if pg_catalog.to_regrole('service_role') is null then
    create role service_role nologin noinherit bypassrls;
  end if;
  if pg_catalog.to_regrole('anon') is null then
    create role anon nologin noinherit;
  end if;
  if pg_catalog.to_regrole('authenticated') is null then
    create role authenticated nologin noinherit;
  end if;
  if pg_catalog.to_regrole('authenticator') is null then
    create role authenticator login noinherit password 'ci';
  end if;
end
$r$;
grant anon, authenticated, service_role to authenticator;
grant service_role to postgres;
SQL
}

# reset_db "uuid:role:active" ...
reset_db() {
  local spec id role active n=0
  su_sql postgres "drop database if exists $DB with (force)"
  su_sql postgres "drop role if exists zell_erp_definer"
  su_sql postgres "drop role if exists erp_definer"
  su_sql postgres "create database $DB owner postgres"
  su_sql "$DB" "alter schema public owner to postgres"
  su_sql "$DB" "revoke create on schema public from public"
  su_sql "$DB" "grant usage on schema public to anon, authenticated, service_role"
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > /dev/null <<'SQL'
create table public.admin_users (
  user_id    uuid primary key,
  role       text not null constraint admin_users_role_check check (role in ('owner', 'admin')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
grant select on public.admin_users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
  for spec in "$@"; do
    n=$((n + 1))
    IFS=: read -r id role active <<< "$spec"
    q "insert into public.admin_users (user_id, role, is_active, created_at) values ('$id', '$role', $active, timestamptz '2026-01-01' + interval '$n minute')" > /dev/null
  done
}

apply_engine() { run_file "$ENGINE" "$TMP/engine.out"; }
apply_adapter() {
  { printf "select pg_catalog.set_config('zell.approved_by', 'ci-0021p', false);\n"; cat "$ADAPTER"; } \
    | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/adapter.out" 2>&1
}
apply_all() {
  if ! apply_engine; then echo "--- engine.out"; cat "$TMP/engine.out"; return 1; fi
  if ! apply_adapter; then echo "--- adapter.out"; cat "$TMP/adapter.out"; return 1; fi
  return 0
}

body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"

consistent() { q "select (select active_owner_count from public.zell_erp_owner_guard where id = 1) = (select count(*) from public.admin_users where role = 'owner' and is_active)"; }
owners() { q "select coalesce(string_agg(user_id::text, ',' order by user_id), '') from public.admin_users where role = 'owner' and is_active"; }

# اتصالين: الأول بيعمل تغييره ويمسك القفل 5 ثواني قبل COMMIT، والتاني بيبدأ بعد ثانية.
# إثبات الانتظار: بنراقب الاتصال التاني بالاسم (application_name) لحد ما يظهر مستني قفل (حتى ~4 ثواني).
pair() {
  local iso="$1" first="$2" second="$3" p1 p2 i w
  printf 'BEGIN ISOLATION LEVEL %s;\n%s\nSELECT pg_sleep(5);\nCOMMIT;\n' "$iso" "$first" | PGAPPNAME=zell_ci_t1 run_pg > "$TMP/t1.out" &
  p1=$!
  sleep 1
  printf 'BEGIN ISOLATION LEVEL %s;\n%s\nCOMMIT;\n' "$iso" "$second" | PGAPPNAME=zell_ci_t2 run_pg > "$TMP/t2.out" &
  p2=$!
  WAITERS=0
  for i in $(seq 1 40); do
    w=$(q "select count(*) from pg_stat_activity where application_name = 'zell_ci_t2' and wait_event_type = 'Lock'")
    if [ "$w" -ge 1 ] 2> /dev/null; then
      WAITERS=$w
      break
    fi
    sleep 0.1
  done
  wait "$p1"; E1=$?
  wait "$p2"; E2=$?
  S1=$(sqlstate "$TMP/t1.out")
  S2=$(sqlstate "$TMP/t2.out")
}

in_list() {
  local value="$1" v
  shift
  for v in "$@"; do
    if [ "$value" = "$v" ]; then return 0; fi
  done
  return 1
}

echo "server_version: $(psql -X -tA -U "$SUPER" -d postgres -c 'show server_version')"
echo "client: $(psql --version)"
init_cluster

# ── S1: الـ ptest فيه نفس جسمين الـ migration بالحرف ──
e1=$(body_md5 "$ENGINE" "0021P ENGINE BODY"); e2=$(body_md5 "$PTEST" "0021P ENGINE BODY")
a1=$(body_md5 "$ADAPTER" "0021P ADAPTER BODY"); a2=$(body_md5 "$PTEST" "0021P ADAPTER BODY")
ok=no; if [ "$e1" = "$e2" ] && [ "$e1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S1a ptest engine body md5 = migration ($e1)" "$ok" "migration=$e1 ptest=$e2"
ok=no; if [ "$a1" = "$a2" ] && [ "$a1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S1b ptest adapter body md5 = migration ($a1)" "$ok" "migration=$a1 ptest=$a2"

# ── S2: ptest (ci) قبل التطبيق، ومفيش حاجة بتفضل بعده ──
reset_db "$A:owner:true" "$B:owner:true" "$X:admin:true" "$Y:admin:false"
sed "s/set_config('zell.ptest_profile', 'production', true)/set_config('zell.ptest_profile', 'ci', true)/" "$PTEST" > "$TMP/ptest_ci.sql"
run_file "$TMP/ptest_ci.sql" "$TMP/ptest_ci.out"
line=$(grep -o 'ZELL_0021P_PTEST_RESULT.*' "$TMP/ptest_ci.out" | head -n 1)
echo "$line"
ok=no; if printf '%s' "$line" | grep -q 'profile=ci ' && printf '%s' "$line" | grep -q ' fail=0 ' && printf '%s' "$line" | grep -q ' skip=0 '; then ok=yes; fi
record "S2a ptest profile=ci: fail=0 skip=0" "$ok" "$(tail -n 5 "$TMP/ptest_ci.out")"
left=$(q "select pg_catalog.to_regrole('erp_definer') is null and pg_catalog.to_regrole('zell_erp_definer') is null and pg_catalog.to_regclass('public.zell_erp_owner_guard') is null and pg_catalog.to_regclass('public.erp_access_audit') is null and (select count(*) from public.admin_users) = 4 and not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.admin_users'::regclass and not tgisinternal)")
record "S2b ptest leaves nothing behind" "$( [ "$left" = "t" ] && echo yes || echo no )" "$left"

# ── S3: ptest (production) بمالك واحد وأدمن واحد: المحتاج مالك تاني بيتعدّى ──
reset_db "$A:owner:true" "$X:admin:true"
run_file "$PTEST" "$TMP/ptest_prod.out"
line=$(grep -o 'ZELL_0021P_PTEST_RESULT.*' "$TMP/ptest_prod.out" | head -n 1)
echo "$line"
ok=no; if printf '%s' "$line" | grep -q 'profile=production ' && printf '%s' "$line" | grep -q ' fail=0 '; then ok=yes; fi
record "S3 ptest profile=production (single owner): fail=0" "$ok" "$(tail -n 5 "$TMP/ptest_prod.out")"

# ── S4: التطبيق + verify ──
reset_db "$A:owner:true" "$B:owner:true" "$X:admin:true" "$Y:admin:false"
ok=no; if apply_all; then ok=yes; fi
record "S4a apply engine + adapter" "$ok" "see output above"
run_file "$VERIFY" "$TMP/verify.out"
line=$(grep -o 'ZELL_0021P_VERIFY_RESULT.*' "$TMP/verify.out" | head -n 1)
echo "$line"
ok=no; if printf '%s' "$line" | grep -q 'ZELL_0021P_VERIFY_RESULT ok '; then ok=yes; fi
record "S4b verify ok after apply" "$ok" "$(tail -n 5 "$TMP/verify.out")"
grants=$(q "select count(*) from public.erp_user_grants where user_id = '$X'")
record "S4c active admin got 22 explicit grants, inactive admin none" "$( [ "$grants" = "22" ] && [ "$(q "select count(*) from public.erp_user_grants where user_id = '$Y'")" = "0" ] && echo yes || echo no )" "X=$grants"

# ── S5: إعادة التطبيق مرفوضة ──
run_file "$ENGINE" "$TMP/re_engine.out"
record "S5a engine re-apply refused" "$(has "$TMP/re_engine.out" 'ERP_0021P_ALREADY_PRESENT' && echo yes || echo no)" "$(tail -n 3 "$TMP/re_engine.out")"
apply_adapter
record "S5b adapter re-apply refused" "$(has "$TMP/adapter.out" 'ZELL_0021P_ALREADY_PRESENT' && echo yes || echo no)" "$(tail -n 3 "$TMP/adapter.out")"

# ── S6: المحوّل من غير موافقة / من غير محرك ──
reset_db "$A:owner:true"
apply_engine
run_file "$ADAPTER" "$TMP/adapter_noapprover.out"
record "S6a adapter without approver refused" "$(has "$TMP/adapter_noapprover.out" 'ZELL_0021P_APPROVER_REQUIRED' && echo yes || echo no)" "$(tail -n 3 "$TMP/adapter_noapprover.out")"
reset_db "$A:owner:true"
apply_adapter
record "S6b adapter without engine refused" "$(has "$TMP/adapter.out" 'ZELL_0021P_ENGINE_MISSING' && echo yes || echo no)" "$(tail -n 3 "$TMP/adapter.out")"

# ── S7: rollback ──
sed "s/^-- select pg_catalog.set_config('zell.rollback_attest'/select pg_catalog.set_config('zell.rollback_attest'/" "$ROLLBACK" > "$TMP/rollback_attested.sql"
sed "s/set_config('zell.rollback_mode', 'rollback', true)/set_config('zell.rollback_mode', 'freeze', true)/" "$ROLLBACK" > "$TMP/freeze.sql"

reset_db "$A:owner:true" "$X:admin:true"
apply_all > /dev/null
run_file "$ROLLBACK" "$TMP/rb_noattest.out"
record "S7a rollback without attestation refused" "$(has "$TMP/rb_noattest.out" 'ZELL_0021P_ROLLBACK_ATTEST_REQUIRED' && echo yes || echo no)" "$(tail -n 3 "$TMP/rb_noattest.out")"
ok=no
if run_file "$TMP/rollback_attested.sql" "$TMP/rb_clean.out"; then
  r1=$(q "select pg_catalog.to_regprocedure('public.erp_access_grant(uuid,uuid,uuid,text,integer)') is null and pg_catalog.to_regprocedure('public.zell_erp_set_user_active(uuid,uuid,uuid,boolean,text)') is null")
  r2=$(q "select count(*) from public.erp_user_grants")
  r3=$(q "select count(*) from pg_catalog.pg_trigger where tgrelid = 'public.admin_users'::regclass and tgname like 'zell\_erp\_%'")
  r4=$(q "set role erp_definer; select s.is_active::text || ',' || s.is_owner::text from public.erp_actor_status_v1('$A') s")
  r5=$(q "select count(*) from public.erp_access_audit")
  if [ "$r1" = "t" ] && [ "$r2" = "22" ] && [ "$r3" = "0" ] && [ "$r4" = "false,false" ] && [ "$r5" = "1" ]; then ok=yes; fi
fi
record "S7b clean rollback: functions + triggers gone, tables/rows/interface kept, interface deny" "$ok" "fn=$r1 grants=$r2 triggers=$r3 iface=$r4 audit=$r5 $(tail -n 3 "$TMP/rb_clean.out")"

reset_db "$A:owner:true" "$X:admin:true"
apply_all > /dev/null
q "set role service_role; select public.erp_access_revoke('$A', gen_random_uuid(), '$X', 'zell.telegram.test', 1, 'ci') ->> 'ok'" > /dev/null
run_file "$TMP/rollback_attested.sql" "$TMP/rb_used.out"
ok=no; if has "$TMP/rb_used.out" 'ZELL_0021P_ROLLBACK_REAL_USE' && [ "$(q "select pg_catalog.to_regprocedure('public.erp_access_grant(uuid,uuid,uuid,text,integer)') is not null")" = "t" ]; then ok=yes; fi
record "S7c rollback refused after real use (rpc), nothing dropped" "$ok" "$(tail -n 3 "$TMP/rb_used.out")"
ok=no
if run_file "$TMP/freeze.sql" "$TMP/freeze.out"; then
  f1=$(q "select pg_catalog.has_function_privilege('service_role', 'public.erp_access_grant(uuid,uuid,uuid,text,integer)', 'EXECUTE') or pg_catalog.has_function_privilege('service_role', 'public.zell_erp_set_user_active(uuid,uuid,uuid,boolean,text)', 'EXECUTE')")
  f2=$(q "set role service_role; select (public.erp_effective_capabilities('$A') ->> 'owner')")
  if [ "$f1" = "f" ] && [ "$f2" = "true" ]; then ok=yes; fi
fi
record "S7d freeze: management EXECUTE revoked, reads still work" "$ok" "mgmt=$f1 read=$f2 $(tail -n 3 "$TMP/freeze.out")"

reset_db "$A:owner:true" "$X:admin:true"
apply_all > /dev/null
q "update public.admin_users set is_active = false where user_id = '$X'" > /dev/null
logrow=$(q "select operation || ',' || db_user || ',' || coalesce(app_actor::text, 'null') || ',' || new_is_active::text from public.zell_erp_admin_users_log where user_id = '$X'")
run_file "$TMP/rollback_attested.sql" "$TMP/rb_manual.out"
ok=no; if has "$TMP/rb_manual.out" 'ZELL_0021P_ROLLBACK_REAL_USE' && [ "$logrow" = "UPDATE,postgres,null,false" ]; then ok=yes; fi
record "S7e manual admin_users change is logged and counts as real use" "$ok" "log=$logrow $(tail -n 3 "$TMP/rb_manual.out")"

# ── S8: التزامن باتصالين على الـ migration الحقيقي ──
for ISO in "${ISOLATIONS[@]}"; do
  reset_db "$A:owner:true" "$B:owner:true"
  apply_all > /dev/null
  pair "$ISO" "UPDATE public.admin_users SET is_active = false WHERE user_id = '$A';" "UPDATE public.admin_users SET is_active = false WHERE user_id = '$B';"
  if [ "$ISO" = "READ COMMITTED" ]; then accepted="45303"; else accepted="45303 40001"; fi
  ok=no
  # shellcheck disable=SC2086
  if [ "$E1" -eq 0 ] && [ "$E2" -ne 0 ] && in_list "$S2" $accepted && [ "$WAITERS" -ge 1 ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$B" ]; then ok=yes; fi
  record "C1 two owners deactivated concurrently [$ISO] -> second=$S2 waiters=$WAITERS" "$ok" "E1=$E1 S1=$S1 E2=$E2 S2=$S2 waiters=$WAITERS owners=$(owners)"
done

for ISO in "${ISOLATIONS[@]}"; do
  reset_db "$A:owner:true" "$B:admin:true"
  apply_all > /dev/null
  pair "$ISO" "UPDATE public.admin_users SET role = 'owner' WHERE user_id = '$B';" "UPDATE public.admin_users SET is_active = false WHERE user_id = '$A';"
  if [ "$ISO" = "READ COMMITTED" ]; then
    ok=no
    if [ "$E1" -eq 0 ] && [ "$E2" -eq 0 ] && [ "$WAITERS" -ge 1 ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$B" ]; then ok=yes; fi
    record "C2 promote + demote concurrently, both succeed [$ISO]" "$ok" "E1=$E1 E2=$E2 S2=$S2 waiters=$WAITERS owners=$(owners)"
  else
    second="$S2"
    printf 'UPDATE public.admin_users SET is_active = false WHERE user_id = %s;\n' "'$A'" | run_pg > "$TMP/retry.out"
    er=$?
    ok=no
    if [ "$E1" -eq 0 ] && [ "$E2" -ne 0 ] && [ "$second" = "40001" ] && [ "$er" -eq 0 ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$B" ]; then ok=yes; fi
    record "C2 promote + demote concurrently, second 40001 then retry succeeds [$ISO]" "$ok" "E1=$E1 E2=$E2 S2=$second retry=$er owners=$(owners)"
  fi
done

reset_db "$A:owner:true" "$B:owner:true"
apply_all > /dev/null
pair "READ COMMITTED" "DELETE FROM public.admin_users WHERE user_id = '$A';" "UPDATE public.admin_users SET is_active = false WHERE user_id = '$B';"
ok=no; if [ "$E1" -eq 0 ] && [ "$E2" -ne 0 ] && [ "$S2" = "45303" ] && [ "$WAITERS" -ge 1 ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$B" ]; then ok=yes; fi
record "C3 delete vs deactivate concurrently [READ COMMITTED]" "$ok" "E1=$E1 E2=$E2 S2=$S2 waiters=$WAITERS owners=$(owners)"

for ISO in "READ COMMITTED" "REPEATABLE READ"; do
  reset_db "$A:owner:true" "$B:owner:true"
  apply_all > /dev/null
  pair "$ISO" \
    "SET LOCAL ROLE service_role; SELECT public.zell_erp_set_user_active('$A', gen_random_uuid(), '$B', false, 'ci') ->> 'ok';" \
    "SET LOCAL ROLE service_role; SELECT public.zell_erp_set_user_active('$B', gen_random_uuid(), '$A', false, 'ci') ->> 'code';"
  denied=$(q "select count(*) from public.erp_access_audit where code = '45303' and outcome = 'denied'")
  ok=no
  if [ "$ISO" = "READ COMMITTED" ]; then
    if [ "$E1" -eq 0 ] && [ "$E2" -eq 0 ] && grep -qx '45303' "$TMP/t2.out" && [ "$denied" = "1" ] && [ "$WAITERS" -ge 1 ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$A" ]; then ok=yes; fi
    record "C4 owners suspend each other via function [$ISO] -> second denied 45303 (audited)" "$ok" "E1=$E1 E2=$E2 S2=$S2 denied=$denied waiters=$WAITERS owners=$(owners) t2=$(tr '\n' ' ' < "$TMP/t2.out")"
  else
    if [ "$E1" -eq 0 ] && [ "$E2" -ne 0 ] && [ "$S2" = "40001" ] && [ "$(consistent)" = "t" ] && [ "$(owners)" = "$A" ]; then ok=yes; fi
    record "C4 owners suspend each other via function [$ISO] -> second 40001 (retry with same command_id)" "$ok" "E1=$E1 E2=$E2 S2=$S2 owners=$(owners)"
  fi
done

su_sql postgres "drop database if exists $DB with (force)"
rm -rf "$TMP"
echo "ZELL_0021P_SQL_CI_RESULT pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ] || [ "$PASS" -eq 0 ]; then exit 1; fi
