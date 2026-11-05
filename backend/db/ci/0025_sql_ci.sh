#!/usr/bin/env bash
# INSTALLER-SHIPPING B (0025) — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة كلها
# (backend/db/ci/build_from_scratch.list لحد 0024؛ postgres مش superuser زي Production)، وبعدين 0025 فوقها. مفيش أي اتصال بـ Supabase،
# ولا بيانات ولا مفاتيح من Production.
# بيغطي (العقد docs/contracts/INSTALLER-SHIPPING.md §٦): شكل المعاملة · md5 الجسم (ptest = apply) · سطر الموافقة برّه الملفات ·
# الفرق عن جسم 0021ex = التعديل الواحد بس، والرجوع = جسم 0021ex بالحرف · الـ 10 verify قبل التطبيق (التسعة + 0024) ·
# حراس الـ preflight (الموافقة · المتصل · بصمة مختلفة · search_path مختلف · overload · مالك مختلف) من غير أثر · ptest من غير أثر ·
# التطبيق: البصمة الجديدة والمالك والصلاحيات بالحرف وبصمة كل حاجة تانية زي ما هي · رفض الإعادة · verify 0025 ·
# بعد التطبيق: EX V09 و P1 V06 و 0024 V04 بس اللي بيفشلوا، والباقي PASS من غير أخطاء تنفيذ ولا فحوص ناقصة ·
# مقارنة القديم بالجديد والسيناريوهات (0025_flows.sql) · حساب المتجر (core) = الداتابيز بعد 0025 (0025_core_parity.mjs، المرحلة C) · اختبارات سالبة (منح anon · منح PUBLIC · سحب zell_order_writer · جسم حارس ·
# خاصية حارس · security definer للدالة · grant option · overload · توقيع ناقص) بتوقّع verify 0025 من غير أخطاء تنفيذ · الرجوع (من غير موافقة · بموافقة · مرة تانية) ثم ptest وإعادة التطبيق.
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
APPLY="$MIG/0025_installer_shipping.sql"
PTEST="$MIG/0025_installer_shipping_ptest.sql"
VERIFY="$MIG/0025_installer_shipping_verify.sql"
ROLLBACK="$MIG/0025_installer_shipping_rollback.sql"
IMPACT="$MIG/0025_installer_shipping_impact.sql"
EXAPPLY="$MIG/0021ex_express_shipping.sql"
FLOWS="$CIDIR/0025_flows.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || true)"
[ -n "$SUPER" ] || SUPER=supabase_admin
DB=zell_ci_0025
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
OLD_MD5=62924d0fe9b1563e76c54bbddfb628b4
NEW_MD5=03e839e30fe7d0c9354d1df4f21b71b3
CO="public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text)"
EXPECTED="S01 S02 S03 S04 B01 V01 M01 M02 M05 E01 E02 E03 E04 E05 E06 P01 M07 A01 A02 A03 V02 M03 V03 P02 F01 C01 N01 N02 N03 N04 N05 N06 N07 M04 N08 N09 RB1 RB2 M06 RB3 RB4 RA1"
VLIST="A1:0021a_a1_order_cycle_verify.sql:7 D:0021d_preferred_delivery_verify.sql:7 P1:0021a_p1_payments_verify.sql:7 P2:0021a_p2_checkout_fee_verify.sql:7 D2:0021d2_delivery_settings_verify.sql:7 TR:0021tr_track_order_verify.sql:7 TR2:0021tr2_track_order_v2_verify.sql:7 EX:0021ex_express_shipping_verify.sql:7 0021-P:0021p_access_verify.sql:11 0024:0024_order_delete_verify.sql:7"
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
  echo "ZELL_0025_SQL_CI_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
sq() { psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -c "$1" < /dev/null 2>&1; }
pg_in() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$1" 2>&1; }
su_in() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f - > "$1" 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
body_of() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1"; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
with_appr() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_appr() { with_appr "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
# تعريف zell_create_order من 0021ex بالحرف (CREATE FUNCTION ... $function$;) وجسمها بس (prosrc).
ex_def() { awk '/^CREATE FUNCTION public\.zell_create_order\(/ {f = 1} f {print} f && /^\$function\$;$/ {exit}' "$EXAPPLY"; }
fn_src() { awk 'f && /^\$function\$;$/ {exit} f {print} /^CREATE (OR REPLACE )?FUNCTION public\.zell_create_order\(/ {h = 1} h && /^AS \$function\$$/ {f = 1; h = 0}' "$1"; }
# حالة zell_create_order: العدد · md5 · المالك · secdef · search_path · الصلاحيات مترتبة.
co_state() {
  q "select pg_catalog.count(*)::text || '|' || coalesce(pg_catalog.string_agg(pg_catalog.md5(p.prosrc) || '|' || pg_catalog.pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '-') || '|' || coalesce((select pg_catalog.string_agg(x::text, ',' order by x::text) from pg_catalog.unnest(p.proacl) x), 'NULL'), ';'), '-') from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'"
}
FPQ=$(cat <<'SQL'
select pg_catalog.concat_ws(':',
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select p.oid::regprocedure::text || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner) || '=' || p.prosecdef::text
           || '=' || coalesce(p.proconfig::text, '-') || '=' || coalesce((select pg_catalog.string_agg(x::text, ',' order by x::text) from pg_catalog.unnest(p.proacl) x), 'NULL') as v
      from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'zell_create_order') z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select c.oid::regclass::text || '=' || c.relkind::text || '=' || pg_catalog.pg_get_userbyid(c.relowner) || '=' || c.relrowsecurity::text || '=' || c.relforcerowsecurity::text
           || '=' || coalesce((select pg_catalog.string_agg(x::text, ',' order by x::text) from pg_catalog.unnest(c.relacl) x), 'NULL') as v
      from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace) z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select a.attrelid::regclass::text || '.' || a.attname::text || '=' || coalesce((select pg_catalog.string_agg(x::text, ',' order by x::text) from pg_catalog.unnest(a.attacl) x), 'NULL') as v
      from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null) z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select c.conrelid::regclass::text || '/' || c.conname::text || '/' || pg_catalog.pg_get_constraintdef(c.oid) || '/' || c.convalidated::text as v
      from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace where n.nspname = 'public') z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select p.tablename::text || '/' || p.policyname::text || '/' || p.cmd || '/' || p.permissive || '/' || p.roles::text || '/' || coalesce(p.qual, '-') || '/' || coalesce(p.with_check, '-') as v
      from pg_catalog.pg_policies p where p.schemaname = 'public') z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select t.tgrelid::regclass::text || '/' || t.tgname::text || '/' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text as v
      from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(z.v, ',' order by z.v) from (
    select r.rolname::text || '/' || r.rolsuper::text || r.rolinherit::text || r.rolcreaterole::text || r.rolcanlogin::text || r.rolbypassrls::text as v
      from pg_catalog.pg_roles r
    union all
    select pg_catalog.pg_get_userbyid(m.roleid) || '>' || pg_catalog.pg_get_userbyid(m.member) || '/' || m.admin_option::text || m.inherit_option::text || m.set_option::text
      from pg_catalog.pg_auth_members m) z), '')),
  pg_catalog.md5(coalesce((select pg_catalog.string_agg(s.key::text || '=' || s.value::text, ',' order by s.key::text) from public.settings s), '')),
  (select pg_catalog.count(*) from public.orders)::text,
  (select pg_catalog.count(*) from public.products)::text)
SQL
)
fp() { q "$FPQ"; }
verifies() {
  local phase=$1 item tag f col out rc verdict nchk
  : > "$TMP/ver_$phase.txt"
  for item in $VLIST; do
    tag=$(printf '%s' "$item" | cut -d: -f1); f=$(printf '%s' "$item" | cut -d: -f2); col=$(printf '%s' "$item" | cut -d: -f3)
    out="$TMP/ver.$phase.$tag.out"
    psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$MIG/$f" < /dev/null > "$out" 2>&1; rc=$?
    verdict=$(awk -F "$US" -v c="$col" '$1 == "0" && $2 == "summary" {print $c}' "$out")
    [ -n "$verdict" ] || verdict=-
    nchk=$(awk -F "$US" '$1 ~ /^[0-9]+$/ && $1 != "0" && $2 == "check"' "$out" | grep -c .)
    printf '%s rc=%s verdict=%s checks=%s fails=%s\n' "$tag" "$rc" "$verdict" "$nchk" \
      "$(awk -F "$US" '$1 ~ /^[0-9]+$/ && $1 != "0" && $2 == "check" && ($5 == "f" || $5 == "false") {print $3}' "$out" | sort | tr '\n' ',')" >> "$TMP/ver_$phase.txt"
  done
}
verifies_detail() { tr '\n' ' ' < "$TMP/ver_$1.txt" | cut -c1-1200; }
# verify 0025: الحكم وقايمة الفحوص اللي فشلت.
v25() {
  local rc
  psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$VERIFY" < /dev/null > "$TMP/v25.$1.out" 2>&1; rc=$?
  printf '%s rc=%s checks=%s fails=%s' "$(awk -F "$US" '$1 == "0" && $2 == "summary" {print $7}' "$TMP/v25.$1.out")" "$rc" \
    "$(awk -F "$US" '$1 ~ /^[0-9]+$/ && $1 != "0" && $2 == "check"' "$TMP/v25.$1.out" | grep -c .)" \
    "$(awk -F "$US" '$1 ~ /^[0-9]+$/ && $1 != "0" && $2 == "check" && $5 == "f" {print $3}' "$TMP/v25.$1.out" | sort | tr '\n' ',')"
}
# ptest: الحكم وعدد النجاح والفشل.
ptest_line() { local rc; run_file "$PTEST" "$TMP/pt.$1.out"; rc=$?; echo "rc=$rc $(grep '^0|summary|' "$TMP/pt.$1.out" | cut -d'|' -f7-9)"; }

# استعلام الأثر (0025_installer_shipping_impact.sql) بالحرف زي Production (postgres مش superuser): صف واحد بـ 15 عمود مفصولة بـ US.
# postgres في CI مالوش pg_read_all_stats؛ القرايات المعتادة بتمنحه مؤقتًا حوالين النداء بس (زي 0024)، وM05 من غيرها.
impact() { psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$IMPACT" < /dev/null > "$TMP/imp_$1.out" 2>&1; echo "$?" > "$TMP/imp_$1.rc"; }
impact_v() { su_q "$DB" -c "grant pg_read_all_stats to postgres" > "$TMP/impv_$1.log" 2>&1; impact "$1"; su_q "$DB" -c "revoke pg_read_all_stats from postgres" >> "$TMP/impv_$1.log" 2>&1; }
imp_valid() { [ "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" = "0" ] && [ "$(grep -c . "$TMP/imp_$1.out")" = "1" ] && [ "$(awk -F "$US" 'NF {print NF}' "$TMP/imp_$1.out")" = "15" ]; }
imp_f() { grep -v '^$' "$TMP/imp_$1.out" | head -n 1 | cut -d "$US" -f "$2"; }
imp_detail() { printf 'rc=%s %s' "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" "$(tr "$US" '|' < "$TMP/imp_$1.out" | tr '\n' ' ' | cut -c1-900)"; }
# البوابة قبل أي خطوة Production: الصلاحيات بالظبط (5) · idle_tx = 0 (13) · الرؤية (14) · التوقيع (15) · المالك وsecdef وsearch_path (3).
imp_gate() { imp_valid "$1" && [ "$(imp_f "$1" 5)" = "t" ] && [ "$(imp_f "$1" 13)" = "0" ] && [ "$(imp_f "$1" 14)" = "t" ] && [ "$(imp_f "$1" 15)" = "t" ] && [ "$(imp_f "$1" 3)" = 'postgres|true|{"search_path=\"\""}' ]; }

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify / flows = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0025 BODY"); m_ptest=$(body_md5 "$PTEST" "0025 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -cx 'commit;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" "$ROLLBACK" | grep -qE 'zell\.approved_by ='; then ok=yes; fi
record "S03 apply + rollback: one begin + one commit (last), no approval line inside the files" "$ok" ""
ex_def | fn_src /dev/stdin > "$TMP/src_ex.txt"
fn_src "$APPLY" > "$TMP/src_apply.txt"
fn_src "$ROLLBACK" > "$TMP/src_rb.txt"
diff "$TMP/src_ex.txt" "$TMP/src_apply.txt" > "$TMP/src.diff"
d_minus=$(grep -c '^<' "$TMP/src.diff"); d_plus=$(grep -c '^>' "$TMP/src.diff")
ok=no
if [ "$(grep -c . "$TMP/src_ex.txt")" -gt 300 ] && [ "$d_minus" = "1" ] && [ "$d_plus" = "10" ] \
   && grep -qx "<   if v_method = 'express' then" "$TMP/src.diff" && grep -qx ">   if v_install then" "$TMP/src.diff" \
   && grep -qx ">   elsif v_method = 'express' then" "$TMP/src.diff" && cmp -s "$TMP/src_ex.txt" "$TMP/src_rb.txt" \
   && [ "$(grep -c 'zell_create_order(' "$APPLY")" -ge 1 ] && ! grep -qi 'drop function' "$APPLY" "$ROLLBACK"; then ok=yes; fi
record "S04 apply body = 0021ex body + the one replacement only (-1/+10 lines); rollback body = 0021ex body byte for byte; no drop function" "$ok" "lines_ex=$(grep -c . "$TMP/src_ex.txt") lines_rb=$(grep -c . "$TMP/src_rb.txt") minus=$d_minus plus=$d_plus $(head -c 600 "$TMP/src.diff" | tr '\n' ' ')"

ok=no
if python3 "$SHAPE" "$IMPACT" > "$TMP/shape_imp.out" 2>&1 && [ "$(grep -cx 'begin;' "$IMPACT")" = "1" ] && [ "$(grep -cx 'set transaction read only;' "$IMPACT")" = "1" ] && [ "$(grep -cx 'rollback;' "$IMPACT")" = "1" ] && ! grep -q '{{' "$IMPACT"; then ok=yes; fi
record "M01 impact query: transaction shape = begin ... one SELECT ... rollback, read only, no double braces (Retool)" "$ok" "$(tailof "$TMP/shape_imp.out")"

# ---- 2) بناء الداتابيز من القايمة الصريحة كلها (لحد 0024) ----
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')")
[ "$fresh" = "0" ] || stop "B01 fresh disposable cluster" "platform roles already present"
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$TMP/createdb.log" 2>&1 || stop "B01 create database" "$(tailof "$TMP/createdb.log")"
su_f "$DB" "$CIDIR/platform_shim.sql" > "$TMP/shim.log" 2>&1 || stop "B01 platform_shim.sql" "$(tailof "$TMP/shim.log")"
su_f "$DB" "$CIDIR/platform_default_privileges.sql" > "$TMP/dp.log" 2>&1 || stop "B01 platform_default_privileges.sql" "$(tailof "$TMP/dp.log")"
n=0
last=""
while IFS='|' read -r kind rel _reason; do
  case "$kind" in ''|'#'*|exclude) continue ;; apply|baseline|fixture|check) ;; *) stop "B01 build list" "unknown kind $kind" ;; esac
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list" "missing $rel"
  n=$((n + 1))
  last="$rel"
  runf="$f"
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/run_$n.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0025-build';/" "$f" > "$runf"
    if grep -q 'zell\.inv_expected' "$f"; then
      sed -i "0,/^begin;\$/s//begin;\nset local zell.inv_expected = 'locations=1 suppliers=0 purchase_docs=0 purchase_doc_lines=0 purchase_doc_charges=0 opening_docs=0 opening_lines=0 stock_lots=0 commands=0 audit=0';/" "$runf"
    fi
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
ST0=$(co_state)
ok=no
case "$ST0" in "1|$OLD_MD5|postgres|true|{\"search_path=\\\"\\\"\"}|"*) ok=yes ;; esac
[ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$last" = "migrations/0024_order_delete.sql" ] || ok=no
record "B01 database built from the whole build_from_scratch.list ($n steps, last $last), postgres not superuser, zell_create_order = 0021ex body owned by postgres" "$ok" "steps=$n last=$last postgres=$shape state=$ST0"
[ "$ok" = yes ] || finish
ACL0=$(printf '%s' "$ST0" | cut -d'|' -f6-)
FP0=$(fp)

verifies before
ok=no
[ "$(grep -c . "$TMP/ver_before.txt")" = "10" ] && ! grep -qvE ' rc=0 verdict=PASS checks=[1-9][0-9]* fails=$' "$TMP/ver_before.txt" && ok=yes
record "V01 before 0025: the nine verifies + 0024 verify = PASS (zell_create_order = 0021ex body)" "$ok" "$(verifies_detail before)"
impact_v b
ok=no
if imp_gate b && [ "$(imp_f b 2)" = "1:$OLD_MD5" ] && ! imp_f b 4 | grep -q '\*' && imp_f b 4 | grep -q 'service_role=X/' && imp_f b 4 | grep -q 'zell_order_writer=X/' \
   && [ "$(imp_f b 9)" = "0" ]; then ok=yes; fi
record "M02 impact before 0025 (step 1 gate): create_order 1:old md5, owner postgres + secdef + search_path empty, ACL exact (3 entries, no grant option), idle_tx 0, sessions visible" "$ok" "$(imp_detail b)"
impact n
ok=no
if imp_valid n && [ "$(imp_f n 14)" = "f" ] && [ -z "$(imp_f n 13)" ] && ! imp_gate n; then ok=yes; fi
record "M05 impact without pg_read_all_stats: sessions_visible = f, idle_tx NULL (not 0), the gate stops" "$ok" "$(imp_detail n)"

# ---- 3) حراس الـ preflight: كله بيترفض ومن غير أثر ----
run_file "$APPLY" "$TMP/e1.out"
ok=no; has "$TMP/e1.out" 'ZELL_0025_APPROVAL_MISSING' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E01 apply without the approval line -> ZELL_0025_APPROVAL_MISSING, nothing changed" "$ok" "$(tailof "$TMP/e1.out")"
with_appr "$APPLY" 'ci-0025-e2' | su_in "$TMP/e2.out"
ok=no; has "$TMP/e2.out" 'ZELL_0025_WRONG_CALLER' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E02 apply as another role (superuser) -> ZELL_0025_WRONG_CALLER, nothing changed" "$ok" "$(tailof "$TMP/e2.out")"
{ echo "begin;"; echo "set local zell.approved_by = 'ci-0025-e3';"; ex_def | sed '1s/^CREATE FUNCTION/CREATE OR REPLACE FUNCTION/' | sed '0,/^declare$/s//declare\n  -- ci drift/'; body_of "$APPLY" "0025 BODY"; echo "rollback;"; } | pg_in "$TMP/e3.out"
ok=no; has "$TMP/e3.out" 'ZELL_0025_CREATE_ORDER_DRIFT' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E03 body not 0021ex (one comment line added, same transaction) -> ZELL_0025_CREATE_ORDER_DRIFT, nothing changed" "$ok" "$(tailof "$TMP/e3.out")"
{ echo "begin;"; echo "set local zell.approved_by = 'ci-0025-e4';"; echo "alter function $CO set search_path = public;"; body_of "$APPLY" "0025 BODY"; echo "rollback;"; } | pg_in "$TMP/e4.out"
ok=no; has "$TMP/e4.out" 'ZELL_0025_CREATE_ORDER_DRIFT' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E04 search_path changed (same transaction) -> ZELL_0025_CREATE_ORDER_DRIFT, nothing changed" "$ok" "$(tailof "$TMP/e4.out")"
{ echo "begin;"; echo "set local zell.approved_by = 'ci-0025-e5';"; echo "create function public.zell_create_order(integer) returns integer language sql as 'select 1';"; body_of "$APPLY" "0025 BODY"; echo "rollback;"; } | pg_in "$TMP/e5.out"
ok=no; has "$TMP/e5.out" 'ZELL_0025_CREATE_ORDER_OVERLOADS' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E05 a second zell_create_order (overload) -> ZELL_0025_CREATE_ORDER_OVERLOADS, nothing changed" "$ok" "$(tailof "$TMP/e5.out")"
{ echo "begin;"; echo "alter function $CO owner to zell_order_writer;"; echo "set local role postgres;"; echo "set local zell.approved_by = 'ci-0025-e6';"; body_of "$APPLY" "0025 BODY"; echo "rollback;"; } | su_in "$TMP/e6.out"
ok=no; has "$TMP/e6.out" 'ZELL_0025_CREATE_ORDER_OWNER' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "E06 owner not postgres (same transaction) -> ZELL_0025_CREATE_ORDER_OWNER, nothing changed" "$ok" "$(tailof "$TMP/e6.out")"

# ---- 4) ptest قبل التطبيق ----
PT1=$(ptest_line p1)
ok=no; [ "$PT1" = "rc=0 PASS|4|0" ] && [ "$(co_state)" = "$ST0" ] && [ "$(fp)" = "$FP0" ] && ok=yes
record "P01 ptest before apply = PASS 4/0, and nothing left behind (zell_create_order and the full fingerprint unchanged)" "$ok" "$PT1 $(grep -E '^[0-9]+\|test\|' "$TMP/pt.p1.out" | grep '|fail|' | tr '\n' ' ' | cut -c1-600) $(tailof "$TMP/pt.p1.out")"

impact_v p
ok=no
if imp_gate p && [ "$(imp_f p 2-15)" = "$(imp_f b 2-15)" ]; then ok=yes; fi
record "M07 impact after the ptest = the step 1 read (columns 2-15), gate still open" "$ok" "$(imp_detail p)"

# ---- 5) التطبيق ----
run_appr "$APPLY" 'ci-0025-apply' "$TMP/a1.out"; rc=$?
ST1=$(co_state)
ok=no; [ "$rc" = "0" ] && [ "$ST1" = "1|$NEW_MD5|postgres|true|{\"search_path=\\\"\\\"\"}|$ACL0" ] && ok=yes
record "A01 apply with the approval line: md5 $NEW_MD5, owner postgres, security definer, search_path empty, ACL identical" "$ok" "rc=$rc before=$ST0 after=$ST1 $(tailof "$TMP/a1.out")"
FP1=$(fp)
ok=no; [ "$FP1" = "$FP0" ] && ok=yes
record "A02 fingerprint of everything else unchanged (other functions with ACL/owner, relations, column grants, constraints, policies, triggers, roles and memberships, settings, counts)" "$ok" "before=$FP0 after=$FP1"
run_appr "$APPLY" 'ci-0025-again' "$TMP/a3.out"
ok=no; has "$TMP/a3.out" 'ZELL_0025_ALREADY_APPLIED' && [ "$(co_state)" = "$ST1" ] && ok=yes
record "A03 second apply -> ZELL_0025_ALREADY_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/a3.out")"
V2=$(v25 v2)
ok=no; [ "$V2" = "PASS rc=0 checks=6 fails=" ] && ok=yes
record "V02 verify 0025 = PASS (6 checks)" "$ok" "$V2 $(tailof "$TMP/v25.v2.out" | tr "$US" '|')"
impact_v a
ok=no
if imp_gate a && [ "$(imp_f a 2)" = "1:$NEW_MD5" ] && [ "$(imp_f a 3-15)" = "$(imp_f b 3-15)" ]; then ok=yes; fi
record "M03 impact after apply: create_order 1:new md5 only; owner/secdef/search_path, full ACL, guards, payment functions, fee config, counts identical to step 1" "$ok" "$(imp_detail a)"
verifies after
sed -e 's/^EX rc=0 verdict=PASS \(checks=[0-9]*\) fails=$/EX rc=0 verdict=FAIL \1 fails=V09,/' \
    -e 's/^P1 rc=0 verdict=PASS \(checks=[0-9]*\) fails=$/P1 rc=0 verdict=FAIL \1 fails=V06,/' \
    -e 's/^0024 rc=0 verdict=PASS \(checks=[0-9]*\) fails=$/0024 rc=0 verdict=FAIL \1 fails=V04,/' "$TMP/ver_before.txt" > "$TMP/ver_expected.txt"
ok=no; cmp -s "$TMP/ver_expected.txt" "$TMP/ver_after.txt" && [ "$(grep -c 'verdict=FAIL' "$TMP/ver_after.txt")" = "3" ] && ok=yes
record "V03 after 0025: only EX V09, P1 V06 and 0024 V04 fail (they pin the old body); every other verify PASS, rc=0, same number of checks" "$ok" "$(verifies_detail after)"
P2=$(ptest_line p2)
ok=no; has "$TMP/pt.p2.out" 'ZELL_0025_ALREADY_APPLIED' && [ "$(co_state)" = "$ST1" ] && ok=yes
record "P02 ptest after apply -> refused (ZELL_0025_ALREADY_APPLIED), nothing changed" "$ok" "$P2 $(tailof "$TMP/pt.p2.out")"

# ---- 6) مقارنة القديم بالجديد والسيناريوهات ----
{ echo "begin;"; ex_def | sed '1s/^CREATE FUNCTION public\.zell_create_order(/CREATE FUNCTION pg_temp.ci_old_zell_create_order(/'; sed '1,/^begin;$/d' "$FLOWS"; } | pg_in "$TMP/flows.out"; rc=$?
FL=$(grep '^0|summary|' "$TMP/flows.out" | cut -d'|' -f7-9)
ok=no; [ "$rc" = "0" ] && [ "$FL" = "PASS|23|0" ] && [ "$(co_state)" = "$ST1" ] && [ "$(fp)" = "$FP0" ] && ok=yes
record "F01 flows: old/new parity matrix (6300 cases x 7 calls) + 15 hand-computed scenarios = PASS 23/0, rolled back without trace" "$ok" "rc=$rc $FL $(grep -E '^[0-9]+\|test\|' "$TMP/flows.out" | grep '|fail|' | tr '\n' ' ' | cut -c1-1500) $(tailof "$TMP/flows.out")"
grep -E '^[0-9]+\|test\|' "$TMP/flows.out" | cut -d'|' -f3,5,6 | cut -c1-700

# ---- 6ب) حساب المتجر (packages/core) = الداتابيز بعد 0025 (المرحلة C) ----
if node --experimental-strip-types "$CIDIR/0025_core_parity.mjs" > "$TMP/cp.sql" 2> "$TMP/cp.err"; then
  CP_N=$(sed -n 's/^-- cases: \([0-9]*\) .*/\1/p' "$TMP/cp.sql" | head -n 1)
  CP=$(psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f "$TMP/cp.sql" 2>&1 | tail -n 1)
else
  CP_N=0
  CP="node failed: $(tail -n 5 "$TMP/cp.err" | tr '\n' ' ')"
fi
ok=no
if [ -n "$CP_N" ] && [ "$CP_N" -ge 2000 ] 2> /dev/null && [ "$CP" = "$CP_N|0|" ] && [ "$(co_state)" = "$ST1" ] && [ "$(fp)" = "$FP0" ]; then ok=yes; fi
record "C01 storefront core (installerShipping + shipping, installation, coupon, deposit) = zell_create_order after 0025: $CP_N cases, 0 mismatches, rolled back without trace" "$ok" "$(head -n 1 "$TMP/cp.sql") result=$CP"

# ---- 7) اختبارات سالبة: verify 0025 لازم يمسك الخلل ----
q "grant execute on function $CO to anon" > "$TMP/n1a.log"; N1=$(v25 n1); q "revoke execute on function $CO from anon" > "$TMP/n1b.log"
ok=no; case "$N1" in "FAIL rc=0 checks=6 fails=V04,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N01 EXECUTE granted to anon -> verify 0025 FAIL on V04 only; restored" "$ok" "$N1 $(cat "$TMP/n1a.log" "$TMP/n1b.log" | tr '\n' ' ')"
q "grant execute on function $CO to public" > "$TMP/n2a.log"; N2=$(v25 n2); q "revoke execute on function $CO from public" > "$TMP/n2b.log"
ok=no; case "$N2" in "FAIL rc=0 checks=6 fails=V04,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N02 EXECUTE granted to PUBLIC -> verify 0025 FAIL on V04 only; restored" "$ok" "$N2 $(cat "$TMP/n2a.log" "$TMP/n2b.log" | tr '\n' ' ')"
q "revoke execute on function $CO from zell_order_writer" > "$TMP/n3a.log"; N3=$(v25 n3); q "grant execute on function $CO to zell_order_writer" > "$TMP/n3b.log"
ok=no; case "$N3" in "FAIL rc=0 checks=6 fails=V04,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N03 EXECUTE revoked from zell_order_writer (an existing grant) -> verify 0025 FAIL on V04 only; restored" "$ok" "$N3 state=$(co_state) $(cat "$TMP/n3a.log" "$TMP/n3b.log" | tr '\n' ' ')"
GDEF=$(sq "select pg_catalog.pg_get_functiondef('public.zell_order_trg_events_immutable()'::regprocedure)")
G0=$(sq "select pg_catalog.md5(prosrc) || '|' || pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid = 'public.zell_order_trg_events_immutable()'::regprocedure")
{ printf '%s\n' "$GDEF" | sed 's/^\$function\$$/-- ci tamper\n$function$/'; echo ";"; } | su_in "$TMP/n4a.log"
N4=$(v25 n4)
{ printf '%s\n' "$GDEF"; echo ";"; } | su_in "$TMP/n4b.log"
G1=$(sq "select pg_catalog.md5(prosrc) || '|' || pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid = 'public.zell_order_trg_events_immutable()'::regprocedure")
ok=no; case "$N4" in "FAIL rc=0 checks=6 fails=V06,") ok=yes ;; esac; [ "$G1" = "$G0" ] || ok=no
record "N04 events guard body changed -> verify 0025 FAIL on V06 only; restored (md5 and owner as before)" "$ok" "$N4 before=$G0 after=$G1 $(tailof "$TMP/n4a.log") $(tailof "$TMP/n4b.log")"
sq "alter function public.zell_shipment_trg_append_only() security definer" > "$TMP/n5a.log"; N5=$(v25 n5); sq "alter function public.zell_shipment_trg_append_only() security invoker" > "$TMP/n5b.log"
ok=no; case "$N5" in "FAIL rc=0 checks=6 fails=V06,") ok=yes ;; esac
record "N05 shipment guard made security definer -> verify 0025 FAIL on V06 only; restored" "$ok" "$N5 $(cat "$TMP/n5a.log" "$TMP/n5b.log" | tr '\n' ' ')"
q "alter function $CO security invoker" > "$TMP/n6a.log"; N6=$(v25 n6); q "alter function $CO security definer" > "$TMP/n6b.log"
ok=no; case "$N6" in "FAIL rc=0 checks=6 fails=V03,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N06 zell_create_order made security invoker -> verify 0025 FAIL on V03 only; restored with the same ACL" "$ok" "$N6 state=$(co_state) $(cat "$TMP/n6a.log" "$TMP/n6b.log" | tr '\n' ' ')"
q "grant execute on function $CO to service_role with grant option" > "$TMP/n7a.log"; N7=$(v25 n7); q "revoke grant option for execute on function $CO from service_role" > "$TMP/n7b.log"
ok=no; case "$N7" in "FAIL rc=0 checks=6 fails=V04,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N07 EXECUTE re-granted to service_role WITH GRANT OPTION (same grantee set) -> verify 0025 FAIL on V04 only; grant option revoked, ACL identical" "$ok" "$N7 state=$(co_state) $(cat "$TMP/n7a.log" "$TMP/n7b.log" | tr '\n' ' ')"
q "grant execute on function $CO to service_role with grant option" > "$TMP/m4a.log"; impact_v g1; q "revoke grant option for execute on function $CO from service_role" > "$TMP/m4b.log"; impact_v g2
ok=no
if imp_valid g1 && [ "$(imp_f g1 5)" = "f" ] && imp_f g1 4 | grep -q 'service_role=X\*/' && ! imp_gate g1 && imp_gate g2 && [ "$(imp_f g2 3-15)" = "$(imp_f a 3-15)" ]; then ok=yes; fi
record "M04 impact catches a grant option (EXECUTE ... WITH GRANT OPTION to service_role): co_acl shows X*, co_acl_ok = f, the gate stops; after revoking it the read is identical" "$ok" "$(imp_detail g1) || $(imp_detail g2)"
q "create function public.zell_create_order(integer) returns integer language sql as 'select 1'" > "$TMP/n8a.log"; N8=$(v25 n8); q "drop function public.zell_create_order(integer)" > "$TMP/n8b.log"
ok=no; case "$N8" in "FAIL rc=0 checks=6 fails=V01,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N08 a second zell_create_order (overload) -> verify 0025 returns rows (no execution error): FAIL on V01 only; removed" "$ok" "$N8 $(tailof "$TMP/v25.n8.out" | tr "$US" '|') $(cat "$TMP/n8a.log" "$TMP/n8b.log" | tr '\n' ' ')"
q "alter function $CO rename to zell_create_order_ci_renamed" > "$TMP/n9a.log"; N9=$(v25 n9); q "alter function public.zell_create_order_ci_renamed(jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text) rename to zell_create_order" > "$TMP/n9b.log"
ok=no; case "$N9" in "FAIL rc=0 checks=6 fails=V01,V02,V03,V04,") ok=yes ;; esac; [ "$(co_state)" = "$ST1" ] || ok=no
record "N09 no zell_create_order with the 15-argument signature (renamed) -> verify 0025 returns rows (no execution error): FAIL on V01-V04; renamed back, state identical" "$ok" "$N9 $(tailof "$TMP/v25.n9.out" | tr "$US" '|') $(cat "$TMP/n9a.log" "$TMP/n9b.log" | tr '\n' ' ')"
V2B=$(v25 v2b)
[ "$V2B" = "PASS rc=0 checks=6 fails=" ] || echo "NOTE verify 0025 after negative tests: $V2B"

# ---- 8) الرجوع ----
run_file "$ROLLBACK" "$TMP/rb1.out"
ok=no; has "$TMP/rb1.out" 'ZELL_0025R_APPROVAL_MISSING' && [ "$(co_state)" = "$ST1" ] && [ "$V2B" = "PASS rc=0 checks=6 fails=" ] && ok=yes
record "RB1 rollback without the approval line -> ZELL_0025R_APPROVAL_MISSING, nothing changed (verify 0025 PASS before it)" "$ok" "$V2B $(tailof "$TMP/rb1.out")"
run_appr "$ROLLBACK" 'ci-0025-rollback' "$TMP/rb2.out"; rc=$?
verifies rb
RBV=$(v25 rb)
ok=no; [ "$rc" = "0" ] && [ "$(co_state)" = "$ST0" ] && [ "$(fp)" = "$FP0" ] && cmp -s "$TMP/ver_before.txt" "$TMP/ver_rb.txt" && [ "$RBV" = "FAIL rc=0 checks=6 fails=V02," ] && ok=yes
record "RB2 rollback: 0021ex body back (md5, owner, ACL identical), everything else unchanged, the ten verifies PASS again, verify 0025 fails on V02 only" "$ok" "rc=$rc state=$(co_state) v25=$RBV $(verifies_detail rb) $(tailof "$TMP/rb2.out")"
impact_v r
ok=no
if imp_gate r && [ "$(imp_f r 2-15)" = "$(imp_f b 2-15)" ]; then ok=yes; fi
record "M06 impact after rollback = the step 1 read (columns 2-15)" "$ok" "$(imp_detail r)"
run_appr "$ROLLBACK" 'ci-0025-rollback-again' "$TMP/rb3.out"
ok=no; has "$TMP/rb3.out" 'ZELL_0025R_NOT_APPLIED' && [ "$(co_state)" = "$ST0" ] && ok=yes
record "RB3 second rollback -> ZELL_0025R_NOT_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/rb3.out")"
PT4=$(ptest_line p4)
ok=no; [ "$PT4" = "rc=0 PASS|4|0" ] && [ "$(co_state)" = "$ST0" ] && ok=yes
record "RB4 ptest after rollback = PASS 4/0 again, nothing left behind" "$ok" "$PT4"
run_appr "$APPLY" 'ci-0025-reapply' "$TMP/ra1.out"; rc=$?
RAV=$(v25 ra)
ok=no; [ "$rc" = "0" ] && [ "$(co_state)" = "$ST1" ] && [ "$RAV" = "PASS rc=0 checks=6 fails=" ] && ok=yes
record "RA1 apply again after the rollback: same state as the first apply, verify 0025 PASS" "$ok" "rc=$rc $RAV $(tailof "$TMP/ra1.out")"

finish
