#!/usr/bin/env bash
# DEFAULT-PRIVILEGES B (0027) — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة كلها
# (backend/db/ci/build_from_scratch.list؛ ولو سطر 0027 اتضاف لها بعد Production، البناء بيقف قبله)، ومحاكاة الصلاحيات الافتراضية
# بلقطة Production كاملة (platform_default_privileges.sql، 24 صف بالحرف)، وبعدين 0027 فوقها بالملف كما هو. مفيش أي اتصال بـ Supabase.
# بيغطي (العقد docs/contracts/DEFAULT-PRIVILEGES.md §٦): شكل المعاملة · md5 الجسم (ptest = apply) · سطر الموافقة برّه الملفات ·
# اللقطة بعد المحاكاة = §١ بالحرف (S04) · الحراس من غير أثر (من غير موافقة · متصل غلط · صف جوه النطاق مختلف · صف برّه النطاق مختلف ·
# صف عام موجود قبل التطبيق، كل واحدة في نسخة داتابيز لوحدها) · ptest قبل التطبيق بس · الأثر قبل وبعد كل خطوة (§٦-٢) · التطبيق ورفض
# الإعادة · verify · كائنات جديدة فعلًا قبل وبعد (public وschema تجربة جديدة للأثر العام §٥) · الرجوع (من غير موافقة · بموافقة غلط ·
# بموافقة) ثم اللقطة = §١ بالحرف والأثر = قبل التطبيق · ptest وإعادة التطبيق.
# ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
set -uo pipefail

if [ "$(printenv ZELL_CI_DISPOSABLE_DB)" != "yes" ]; then echo "refusing: disposable CI database only" >&2; exit 2; fi
case "$(printenv PGHOST)" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DBDIR="$ROOT/backend/db"
MIG="$DBDIR/migrations"
CIDIR="$DBDIR/ci"
LIST="$CIDIR/build_from_scratch.list"
APPLY="$MIG/0027_default_privileges.sql"
PTEST="$MIG/0027_default_privileges_ptest.sql"
VERIFY="$MIG/0027_default_privileges_verify.sql"
ROLLBACK="$MIG/0027_default_privileges_rollback.sql"
IMPACT="$MIG/0027_default_privileges_impact.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || true)"
[ -n "$SUPER" ] || SUPER=supabase_admin
DB=zell_ci_0027
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
EMPTY_MD5=d41d8cd98f00b204e9800998ecf8427e
EXPECTED="S01 S02 S03 S04 B01 M01 V00 E01 E02 E03 E04 E05 N00 P01 M02 A01 A02 M03 V01 N01 M04 P02 RB1 RB2 RB3 M05 V02 P03 RA1 V03"
US="$(printf '\037')"

record() {
  SEEN="$SEEN$(printf '%s' "$1" | cut -d' ' -f1) "
  if [ "$2" = "yes" ]; then echo "CASE PASS $1"; PASS=$((PASS + 1)); else echo "CASE FAIL $1 :: $3"; FAIL=$((FAIL + 1)); fi
}
finish() {
  local missing="" id
  for id in $EXPECTED; do
    [ "$(printf '%s' "$SEEN" | tr ' ' '\n' | grep -cx "$id")" = "1" ] || missing="$missing $id"
  done
  if [ -n "$missing" ]; then echo "CASE FAIL R00 incomplete run (mandatory cases missing or repeated):$missing"; FAIL=$((FAIL + 1)); fi
  echo "ZELL_0027_SQL_CI_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-700; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
pgq() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$db" -c "$1" < /dev/null 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
pipe_pg() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f - > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
with_appr() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
# صفوف pg_default_acl بنفس شكل العقد §١ (k = v)، مرتّبة بـ C
acl_rows() {
  pgq "$1" "select s.x from (select pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text || ' = ' || d.defaclacl::text as x
              from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace) as s order by s.x collate \"C\""
}
same_rows() { acl_rows "$1" > "$TMP/rows_now.txt"; cmp -s "$TMP/rows_now.txt" "$2"; }
summary_of() { local rc; run_file "$1" "$TMP/$2.out"; rc=$?; echo "rc=$rc $(grep '^0|summary|' "$TMP/$2.out" | cut -d'|' -f3-)"; }
impact() { psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$IMPACT" < /dev/null > "$TMP/imp_$1.out" 2>&1; echo "$?" > "$TMP/imp_$1.rc"; }
imp_ok() { [ "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" = "0" ] && [ "$(grep -c "^probe$US" "$TMP/imp_$1.out")" = "1" ] && grep -q "^probe$US.*${US}0\$" "$TMP/imp_$1.out" && grep -q "^session${US}current_user${US}postgres\$" "$TMP/imp_$1.out"; }
imp_sec() { grep "^$2$US" "$TMP/imp_$1.out"; }
imp_detail() { printf 'rc=%s %s' "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" "$(grep -v '^default_acl' "$TMP/imp_$1.out" | tr "$US" '|' | tr '\n' ' ' | cut -c1-900)"; }
# كائنات جديدة فعلًا (CI بس، جوه معاملة بترجع): schema تجربة جديدة + دالة وجدول فيها، ودالة في public.
probe_sql() {
  printf '%s\n' "begin;" \
    "create schema zell_dp_probe_schema;" \
    "create function zell_dp_probe_schema.f() returns integer language sql as 'select 1';" \
    "create table zell_dp_probe_schema.t (id integer);" \
    "create function public.zell_dp_probe_g() returns integer language sql as 'select 1';" \
    "select pg_catalog.has_function_privilege('anon', 'zell_dp_probe_schema.f()', 'EXECUTE')::text || ',' || pg_catalog.has_function_privilege('authenticated', 'zell_dp_probe_schema.f()', 'EXECUTE')::text || ',' || pg_catalog.has_function_privilege('service_role', 'zell_dp_probe_schema.f()', 'EXECUTE')::text || ',' || (exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) x where p.oid = 'zell_dp_probe_schema.f()'::regprocedure and x.grantee = 0))::text || ',' || pg_catalog.has_table_privilege('anon', 'zell_dp_probe_schema.t', 'SELECT')::text || ',' || pg_catalog.has_function_privilege('anon', 'public.zell_dp_probe_g()', 'EXECUTE')::text || ',' || pg_catalog.has_function_privilege('service_role', 'public.zell_dp_probe_g()', 'EXECUTE')::text;" \
    "rollback;"
}
mkcopy() { su_q postgres -c "drop database if exists $1" -c "create database $1 template $DB" > "$TMP/$1.log" 2>&1; }
dropcopy() { su_q postgres -c "drop database if exists $1" >> "$TMP/$1.log" 2>&1; }

cat > "$TMP/before.txt" <<'ROWS'
postgres | public | S = {postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}
postgres | public | f = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
postgres | public | r = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
postgres | storage | S = {postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}
postgres | storage | f = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
postgres | storage | r = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
supabase_admin | extensions | S = {postgres=r*w*U*/supabase_admin}
supabase_admin | extensions | f = {postgres=X*/supabase_admin}
supabase_admin | extensions | r = {postgres=a*r*w*d*D*x*t*m*/supabase_admin}
supabase_admin | graphql | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | graphql | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | graphql | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | graphql_public | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | graphql_public | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | graphql_public | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | public | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | public | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | public | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | realtime | S = {postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}
supabase_admin | realtime | f = {postgres=X/supabase_admin,dashboard_user=X/supabase_admin}
supabase_admin | realtime | r = {postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}
supabase_auth_admin | auth | S = {postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}
supabase_auth_admin | auth | f = {postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}
supabase_auth_admin | auth | r = {postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}
ROWS
cat > "$TMP/after.txt" <<'ROWS'
postgres | (all schemas) | f = {postgres=X/postgres}
postgres | public | S = {postgres=rwU/postgres,service_role=rwU/postgres}
postgres | public | f = {postgres=X/postgres,service_role=X/postgres}
postgres | public | r = {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
postgres | storage | S = {postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}
postgres | storage | f = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
postgres | storage | r = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
supabase_admin | extensions | S = {postgres=r*w*U*/supabase_admin}
supabase_admin | extensions | f = {postgres=X*/supabase_admin}
supabase_admin | extensions | r = {postgres=a*r*w*d*D*x*t*m*/supabase_admin}
supabase_admin | graphql | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | graphql | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | graphql | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | graphql_public | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | graphql_public | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | graphql_public | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | public | S = {postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}
supabase_admin | public | f = {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
supabase_admin | public | r = {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
supabase_admin | realtime | S = {postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}
supabase_admin | realtime | f = {postgres=X/supabase_admin,dashboard_user=X/supabase_admin}
supabase_admin | realtime | r = {postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}
supabase_auth_admin | auth | S = {postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}
supabase_auth_admin | auth | f = {postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}
supabase_auth_admin | auth | r = {postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}
ROWS

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$IMPACT" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify / impact = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0027 BODY"); m_ptest=$(body_md5 "$PTEST" "0027 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -cx 'commit;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" "$ROLLBACK" | grep -qE 'zell\.approved_by =' \
   && [ "$(grep -cx 'set transaction read only;' "$IMPACT")" = "1" ] && [ "$(grep -cx 'set transaction read only;' "$VERIFY")" = "1" ] \
   && ! grep -q '{{' "$APPLY" "$PTEST" "$VERIFY" "$ROLLBACK" "$IMPACT"; then ok=yes; fi
record "S03 apply + rollback: one begin + one commit (last), no approval line inside; impact + verify read only; no double braces (Retool)" "$ok" ""

# ---- 2) بناء الداتابيز من القايمة الصريحة ----
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')")
[ "$fresh" = "0" ] || stop "B01 fresh disposable cluster" "platform roles already present"
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$TMP/createdb.log" 2>&1 || stop "B01 create database" "$(tailof "$TMP/createdb.log")"
su_f "$DB" "$CIDIR/platform_shim.sql" > "$TMP/shim.log" 2>&1 || stop "B01 platform_shim.sql" "$(tailof "$TMP/shim.log")"
su_f "$DB" "$CIDIR/platform_default_privileges.sql" > "$TMP/dp.log" 2>&1 || stop "B01 platform_default_privileges.sql" "$(tailof "$TMP/dp.log")"
same_rows "$DB" "$TMP/before.txt"; rc=$?
ok=no; [ "$rc" -eq 0 ] && ok=yes
record "S04 simulated pg_default_acl after the platform files = contract §١ letter for letter (24 rows, grant options, no global row)" "$ok" "$(diff "$TMP/before.txt" "$TMP/rows_now.txt" | head -n 8 | tr '\n' ' ' | cut -c1-700)"
[ "$ok" = yes ] || finish
n=0
last=""
while IFS='|' read -r kind rel _reason; do
  case "$kind" in ''|'#'*|exclude) continue ;; apply|baseline|fixture|check) ;; *) stop "B01 build list" "unknown kind $kind" ;; esac
  [ "$rel" = "migrations/0027_default_privileges.sql" ] && { SKIPPED_0027=yes; break; }
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list" "missing $rel"
  n=$((n + 1))
  last="$rel"
  runf="$f"
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/run_$n.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0027-build';/" "$f" > "$runf"
    if grep -q 'zell\.inv_expected' "$f"; then
      sed -i "0,/^begin;\$/s//begin;\nset local zell.inv_expected = 'locations=1 suppliers=0 purchase_docs=0 purchase_doc_lines=0 purchase_doc_charges=0 opening_docs=0 opening_lines=0 stock_lots=0 commands=0 audit=0';/" "$runf"
    fi
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
same_rows "$DB" "$TMP/before.txt"; rc=$?
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$last" = "migrations/0026_image_delete.sql" ] && [ "$rc" -eq 0 ] && ok=yes
record "B01 database built from build_from_scratch.list ($n steps, last $last; 0027 line in the list: ${SKIPPED_0027:-no}), postgres not superuser, default ACL still = §١" "$ok" "steps=$n last=$last postgres=$shape rows_rc=$rc"
[ "$ok" = yes ] || finish

# ---- 3) قبل التطبيق ----
impact b
ok=no
if imp_ok b && [ "$(imp_sec b default_acl | wc -l)" = "24" ] && [ "$(imp_sec b fp | wc -l)" = "7" ] && grep -q "^session${US}idle_tx${US}0\$" "$TMP/imp_b.out"; then ok=yes; fi
record "M01 impact before 0027: 24 default ACL rows, 7 fingerprints, no probe objects, current_user postgres, idle_tx 0" "$ok" "$(imp_detail b)"
res=$(summary_of "$VERIFY" v0)
ok=no; case "$res" in "rc=0 FAIL|"*) ok=yes ;; esac
record "V00 verify before 0027 -> FAIL, no execution errors" "$ok" "$res $(tailof "$TMP/v0.out")"
run_file "$APPLY" "$TMP/e1.out"
ok=no; has "$TMP/e1.out" 'ZELL_0027_APPROVAL_MISSING' && same_rows "$DB" "$TMP/before.txt" && ok=yes
record "E01 apply without the approval line -> ZELL_0027_APPROVAL_MISSING, default ACL unchanged" "$ok" "$(tailof "$TMP/e1.out")"
# E02–E04: كل انحراف في نسخة داتابيز لوحدها؛ الرفض لازم يسيب النسخة بنفس حالتها المنحرفة.
neg() { # $1 id  $2 copy  $3 who(postgres|super)  $4 drift sql  $5 label
  mkcopy "$2" || { record "$1 $5" no "copy failed $(tailof "$TMP/$2.log")"; return; }
  if [ "$3" = super ]; then su_q "$2" -c "$4" > "$TMP/$2_drift.log" 2>&1; else pgq "$2" "$4" > "$TMP/$2_drift.log" 2>&1; fi
  acl_rows "$2" > "$TMP/$2_pre.txt"
  with_appr "$APPLY" "ci-0027-$1" | pipe_pg "$2" "$TMP/$2_apply.out"
  acl_rows "$2" > "$TMP/$2_post.txt"
  local ok=no
  if has "$TMP/$2_apply.out" 'ZELL_0027_BASELINE_DRIFT' && cmp -s "$TMP/$2_pre.txt" "$TMP/$2_post.txt" && ! cmp -s "$TMP/$2_pre.txt" "$TMP/before.txt"; then ok=yes; fi
  record "$1 $5 -> ZELL_0027_BASELINE_DRIFT, nothing changed" "$ok" "$(tailof "$TMP/$2_drift.log") $(tailof "$TMP/$2_apply.out")"
  dropcopy "$2"
}
neg E02 zell_ci_0027_e2 postgres "alter default privileges for role postgres in schema public revoke all on sequences from anon" "in-scope row differs (postgres | public | S without anon)"
neg E03 zell_ci_0027_e3 super "alter default privileges for role supabase_admin in schema graphql revoke all on sequences from anon" "out-of-scope row differs (supabase_admin | graphql | S without anon)"
neg E04 zell_ci_0027_e4 postgres "alter default privileges for role postgres grant execute on functions to authenticated" "a global row already present (postgres | (all schemas) | f)"
with_appr "$APPLY" 'ci-0027-e5' | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f - > "$TMP/e5.out" 2>&1
ok=no; has "$TMP/e5.out" 'ZELL_0027_WRONG_CALLER' && same_rows "$DB" "$TMP/before.txt" && ok=yes
record "E05 apply by another role (the CI superuser) -> ZELL_0027_WRONG_CALLER, nothing changed" "$ok" "$(tailof "$TMP/e5.out")"
probe_sql | pipe_pg "$DB" "$TMP/n0.out"
ok=no; [ "$(grep -v '^$' "$TMP/n0.out" | tail -n 1)" = "true,true,true,true,false,true,true" ] && ok=yes
record "N00 new objects before 0027 (rolled back): function in a new schema open via PUBLIC, table there closed; public function open" "$ok" "$(tailof "$TMP/n0.out")"

# ---- 4) ptest ثم التطبيق ----
res=$(summary_of "$PTEST" pt1)
ok=no; [ "$res" = "rc=0 PASS|pass=7 fail=0" ] && ok=yes
record "P01 ptest before 0027 -> PASS 7/0 (and rolled back)" "$ok" "$res $(grep -v '^0|' "$TMP/pt1.out" | tr '\n' ' ' | cut -c1-600)"
impact p
ok=no; imp_ok p && cmp -s "$TMP/imp_b.out" "$TMP/imp_p.out" && ok=yes
record "M02 impact after ptest = impact before, exactly (no probe left, nothing changed)" "$ok" "$(diff "$TMP/imp_b.out" "$TMP/imp_p.out" | tr "$US" '|' | head -n 6 | tr '\n' ' ' | cut -c1-600)"
with_appr "$APPLY" 'ci-0027-apply' | pipe_pg "$DB" "$TMP/a1.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "A01 apply with the approval line -> default ACL = expected after 0027 (25 rows, letter for letter)" "$ok" "rc=$rc $(tailof "$TMP/a1.out") $(diff "$TMP/after.txt" "$TMP/rows_now.txt" | head -n 6 | tr '\n' ' ' | cut -c1-500)"
with_appr "$APPLY" 'ci-0027-again' | pipe_pg "$DB" "$TMP/a2.out"
ok=no; has "$TMP/a2.out" 'ZELL_0027_BASELINE_DRIFT' && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "A02 apply again -> ZELL_0027_BASELINE_DRIFT, state unchanged" "$ok" "$(tailof "$TMP/a2.out")"
impact a
grep -v '^default_acl' "$TMP/imp_b.out" > "$TMP/imp_b_rest.txt"; grep -v '^default_acl' "$TMP/imp_a.out" > "$TMP/imp_a_rest.txt"
imp_sec a default_acl | awk -F "$US" '{print $2 " = " $3}' | LC_ALL=C sort > "$TMP/imp_a_acl.txt"
ok=no; imp_ok a && cmp -s "$TMP/imp_b_rest.txt" "$TMP/imp_a_rest.txt" && cmp -s "$TMP/imp_a_acl.txt" "$TMP/after.txt" && ok=yes
record "M03 impact after apply: default ACL = expected after; fingerprints of existing objects, probes and session = before" "$ok" "$(diff "$TMP/imp_b_rest.txt" "$TMP/imp_a_rest.txt" | tr "$US" '|' | head -n 6 | tr '\n' ' ' | cut -c1-500) $(diff "$TMP/imp_a_acl.txt" "$TMP/after.txt" | head -n 4 | tr '\n' ' ' | cut -c1-300)"
res=$(summary_of "$VERIFY" v1)
ok=no; [ "$res" = "rc=0 PASS|pass=5 fail=0" ] && ok=yes
record "V01 verify after 0027 -> PASS 5/0" "$ok" "$res $(tailof "$TMP/v1.out")"
probe_sql | pipe_pg "$DB" "$TMP/n1.out"
ok=no; [ "$(grep -v '^$' "$TMP/n1.out" | tail -n 1)" = "false,false,false,false,false,false,true" ] && ok=yes
record "N01 new objects after 0027 (rolled back): function in a new schema closed to all incl. service_role (global PUBLIC effect, contract §٥), table there closed; public function: anon closed, service_role kept" "$ok" "$(tailof "$TMP/n1.out")"
impact n
ok=no; imp_ok n && cmp -s "$TMP/imp_a.out" "$TMP/imp_n.out" && ok=yes
record "M04 impact after the probes = after apply, exactly (no probe objects left)" "$ok" "$(diff "$TMP/imp_a.out" "$TMP/imp_n.out" | tr "$US" '|' | head -n 4 | tr '\n' ' ' | cut -c1-400)"
run_file "$PTEST" "$TMP/pt2.out"
ok=no; has "$TMP/pt2.out" 'ZELL_0027_PTEST_PRE_APPLY_ONLY' && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "P02 ptest after 0027 -> ZELL_0027_PTEST_PRE_APPLY_ONLY" "$ok" "$(tailof "$TMP/pt2.out")"

# ---- 5) الرجوع ----
run_file "$ROLLBACK" "$TMP/rb1.out"
ok=no; has "$TMP/rb1.out" 'ZELL_0027_RB_APPROVAL_MISSING' && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "RB1 rollback without the approval line -> ZELL_0027_RB_APPROVAL_MISSING, unchanged" "$ok" "$(tailof "$TMP/rb1.out")"
with_appr "$ROLLBACK" 'ci-0027-apply' | pipe_pg "$DB" "$TMP/rb2.out"
ok=no; has "$TMP/rb2.out" 'ZELL_0027_RB_APPROVAL_MISSING' && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "RB2 rollback with an approval value not ending in -rollback -> refused, unchanged" "$ok" "$(tailof "$TMP/rb2.out")"
with_appr "$ROLLBACK" 'ci-0027-default-privileges-rollback' | pipe_pg "$DB" "$TMP/rb3.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && same_rows "$DB" "$TMP/before.txt" && ok=yes
record "RB3 rollback with approval -> default ACL = contract §١ letter for letter (ACL order restored, global row gone)" "$ok" "rc=$rc $(tailof "$TMP/rb3.out") $(diff "$TMP/before.txt" "$TMP/rows_now.txt" | head -n 6 | tr '\n' ' ' | cut -c1-500)"
impact r
ok=no; imp_ok r && cmp -s "$TMP/imp_b.out" "$TMP/imp_r.out" && ok=yes
record "M05 impact after rollback = impact before 0027, exactly" "$ok" "$(diff "$TMP/imp_b.out" "$TMP/imp_r.out" | tr "$US" '|' | head -n 6 | tr '\n' ' ' | cut -c1-600)"
res=$(summary_of "$VERIFY" v2)
ok=no; case "$res" in "rc=0 FAIL|"*) ok=yes ;; esac
record "V02 verify after rollback -> FAIL, no execution errors" "$ok" "$res"
res=$(summary_of "$PTEST" pt3)
ok=no; [ "$res" = "rc=0 PASS|pass=7 fail=0" ] && ok=yes
record "P03 ptest after rollback -> PASS 7/0" "$ok" "$res"
with_appr "$APPLY" 'ci-0027-reapply' | pipe_pg "$DB" "$TMP/ra1.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && same_rows "$DB" "$TMP/after.txt" && ok=yes
record "RA1 re-apply after rollback -> expected after 0027" "$ok" "rc=$rc $(tailof "$TMP/ra1.out")"
res=$(summary_of "$VERIFY" v3)
ok=no; [ "$res" = "rc=0 PASS|pass=5 fail=0" ] && ok=yes
record "V03 verify after re-apply -> PASS 5/0" "$ok" "$res"

finish
