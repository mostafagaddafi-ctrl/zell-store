#!/usr/bin/env bash
# 0024 ORDER-DELETE B — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة كلها
# (backend/db/ci/build_from_scratch.list؛ postgres مش superuser زي Production)، وبعدين 0024 فوقها. مفيش أي اتصال بـ Supabase.
# بيغطي (العقد docs/contracts/ORDER-DELETE.md §٦): شكل المعاملة · md5 الجسم · سطر الموافقة برّه الملف · الـ 9 verify قبل وبعد ·
# ptest ومابيسيبش أثر · حراس الـ preflight · رجوع المعاملة كلها · التطبيق · verify 0024 · بصمة كل حاجة برّه الكائنات الجديدة والحراس التلاتة ·
# عقد الاستدعاء · الرجوع (فاضي) ثم إعادة التطبيق · رفض الإعادة · الصلاحيات · التذكرة (جلسة · نطاق · مدة · استعمال واحد) · اللقطة وبصمة المحتوى ·
# التابع مش المعتمد · المسح الناجح والسجل من غير بيانات شخصية · الحراس القايمة بالحرف · الكوبون · الحد · جلستين (دفعة · قفل رسالة وشحنة ·
# تعديل وقت المسح · تذكرة مرتين · طلب جديد بعد المعاينة) ومفيش deadlock · رفض الرجوع بعد مسح فعلي.
# ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
set -uo pipefail

if [ "${ZELL_CI_DISPOSABLE_DB:-}" != "yes" ]; then echo "refusing: disposable CI database only" >&2; exit 2; fi
case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DBDIR="$ROOT/backend/db"
MIG="$DBDIR/migrations"
CIDIR="$DBDIR/ci"
LIST="$CIDIR/build_from_scratch.list"
APPLY="$MIG/0024_order_delete.sql"
PTEST="$MIG/0024_order_delete_ptest.sql"
VERIFY="$MIG/0024_order_delete_verify.sql"
ROLLBACK="$MIG/0024_order_delete_rollback.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB=zell_ci_0024
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
OWNER_ID='00000000-0000-4000-8000-0000000000b1'
ADMIN_ID='00000000-0000-4000-8000-0000000000b2'
SESS='00000000-0000-4000-8000-00000000c001'
SESS2='00000000-0000-4000-8000-00000000c002'
EXPECTED="S01 S02 S03 B01 E01 T01 T02 G01 G02 Z01 A01 A02 A03 E02 K01 RB1 A04 R01 X01 F01 F02 F03 F04 F05 F06 F07 F08 F09 F10 F11 F12 F13 F14 F15 F16 F17 C01 C02 C03 C04 C05 C06 RB2 A05"
BEFORE_STATE='0|0|7bdc5a72585917ba4e27f7c902bd15ad|0'
AFTER_STATE='1|8|002afae51685f2ac8e4e718d33035997|1'

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
  echo "ZELL_0024_SQL_CI_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
su_sql() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f - 2>&1; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
with_appr() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_appr() { with_appr "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
state() {
  q "select (pg_catalog.to_regrole('zell_purge_definer') is not null)::int
       || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_purge\_%')
       || '|' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_payment_trg_append_only()')), '-')
       || '|' || (pg_catalog.to_regclass('public.zell_purge_log') is not null)::int"
}
# بصمة مستقلة لكل حاجة برّه الكائنات الجديدة والحراس التلاتة، md5 لكل جزء (الدوال · منح الجداول · منح الأعمدة · الأدوار · الـ policies · الـ triggers · القيود · الصفوف).
# ACL فاضي (NULL) = acldefault المالك، علشان GRANT ثم REVOKE مايبانش كأنه تغيير.
fp_out() {
  q "select pg_catalog.concat_ws(':', pg_catalog.md5(coalesce((select pg_catalog.string_agg(p.oid::regprocedure::text || '=' || coalesce((select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1) from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_purge_definer'), '-') || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner), ',' order by 1) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_purge\_%' and p.proname not in ('zell_payment_trg_append_only', 'zell_shipment_trg_append_only', 'zell_customer_update_trg_append_only')), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(c.relname || '=' || coalesce((select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1) from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault(case when c.relkind = 'S' then 's' else 'r' end::\"char\", c.relowner))) x where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_purge_definer'), '-'), ',' order by 1) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S') and c.relname not like 'zell\_purge\_%'), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(c.relname || '.' || a.attname || '=' || (select pg_catalog.string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end || ':' || x.privilege_type, ',' order by 1) from pg_catalog.aclexplode(a.attacl) x where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_purge_definer'), ',' order by 1) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null and exists (select 1 from pg_catalog.aclexplode(a.attacl) x where x.grantee = 0 or pg_catalog.pg_get_userbyid(x.grantee) <> 'zell_purge_definer')), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(r.rolname, ',' order by 1) from pg_catalog.pg_roles r where r.rolname <> 'zell_purge_definer'), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(po.polrelid::regclass::text || '/' || po.polname, ',' order by 1) from pg_catalog.pg_policy po where po.polname not like 'zell\_purge\_%'), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(g.tgrelid::regclass::text || '/' || g.tgname || '/' || g.tgenabled::text, ',' order by 1) from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname not like 'zell\_purge\_%'), '')),
       pg_catalog.md5(coalesce((select pg_catalog.string_agg(c.relname || '.' || co.conname || '=' || pg_catalog.pg_get_constraintdef(co.oid), ',' order by 1) from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid = co.conrelid where co.connamespace = 'public'::regnamespace and c.relname not like 'zell\_purge\_%'), '')),
       pg_catalog.md5(coalesce((select (select pg_catalog.count(*) from public.orders) || ',' || (select pg_catalog.count(*) from public.order_payments) || ',' || (select pg_catalog.count(*) from public.admin_users) || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.key || '=' || s.value::text, ',' order by s.key), '')) from public.settings s)), '')))"
}
# نداءات بجلسة مستخدم (claims + session_id) أو service_role؛ آخر سطر = النتيجة أو SQLSTATE الخطأ.
claims() { printf '{"sub":"%s","role":"authenticated","session_id":"%s"}' "$1" "$2"; }
as_user() {
  printf '%s\n' "begin;" "select pg_catalog.set_config('request.jwt.claims', '$(claims "$1" "$2")', true);" "set local role authenticated;" "$3;" "commit;" \
    | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U postgres -d "$DB" -f - 2>&1 | grep -v '^$' | tail -n 1
}
srv() {
  printf '%s\n' "begin;" "set local role service_role;" "$1;" "commit;" \
    | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U postgres -d "$DB" -f - 2>&1 | grep -v '^$' | tail -n 1
}
issue() {
  local a
  a=$(srv "select public.zell_purge_reauth_begin('$1'::uuid) ->> 'allowed'")
  [ "$a" = "true" ] || { printf 'BEGIN:%s' "$a"; return 0; }
  srv "select public.zell_purge_reauth_finish('$1'::uuid, '$2'::uuid, true, '$3', '$4', $5) ->> 'ticket'"
}
pv() { as_user "$OWNER_ID" "$SESS" "select (x.p ->> 'ids_hash') || '|' || (x.p ->> 'snapshot_hash') || '|' || (x.p ->> 'count') from (select public.zell_purge_preview($1) as p) x"; }
purge() { as_user "$OWNER_ID" "${5:-$SESS}" "select public.zell_purge_orders($1, '$2', $3, '$4'::uuid)::text"; }
oid_of() { q "select o.id from public.orders o where o.order_number = '$1'"; }
f1() { printf '%s' "$1" | cut -d'|' -f1; }
f2() { printf '%s' "$1" | cut -d'|' -f2; }
f3() { printf '%s' "$1" | cut -d'|' -f3; }
reset_attempts() { su_q "$DB" -c "delete from public.zell_purge_attempts" > /dev/null 2>&1; }
now_ms() { date +%s%3N; }
wait_app() {
  local i=0
  while [ "$i" -lt 50 ]; do
    [ "$(su_q "$DB" -c "select pg_catalog.count(*) from pg_catalog.pg_stat_activity a where a.application_name = '$1' and a.state = 'active' and a.query like '%pg_sleep%'")" = "1" ] && return 0
    sleep 0.2; i=$((i + 1))
  done
  return 1
}
# الـ 9 verify الموجودة (زي 0023): الوسم:الملف:عمود الـ verdict.
VLIST="A1:0021a_a1_order_cycle_verify.sql:7 D:0021d_preferred_delivery_verify.sql:7 P1:0021a_p1_payments_verify.sql:7 P2:0021a_p2_checkout_fee_verify.sql:7 D2:0021d2_delivery_settings_verify.sql:7 TR:0021tr_track_order_verify.sql:7 TR2:0021tr2_track_order_v2_verify.sql:7 EX:0021ex_express_shipping_verify.sql:7 0021-P:0021p_access_verify.sql:11"
US="$(printf '\037')"
verifies() {
  local phase=$1 item tag f col out rc verdict
  : > "$TMP/ver_$phase.txt"
  for item in $VLIST; do
    tag=${item%%:*}; f=$(printf '%s' "$item" | cut -d: -f2); col=${item##*:}; out="$TMP/ver_${phase}_$tag.out"
    psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$MIG/$f" < /dev/null > "$out" 2>&1; rc=$?
    verdict=$(awk -F "$US" -v c="$col" '$1 == "0" && $2 == "summary" {print $c}' "$out")
    awk -F "$US" '$1 ~ /^[0-9]+$/ && $1 != "0" && $2 == "check" {print $3 "=" $5}' "$out" > "$TMP/vec_${phase}_$tag"
    printf '%s rc=%s verdict=%s checks=%s\n' "$tag" "$rc" "${verdict:--}" "$(grep -c . "$TMP/vec_${phase}_$tag")" >> "$TMP/ver_$phase.txt"
  done
}
verifies_pass() { [ "$(grep -c . "$TMP/ver_$1.txt")" = "9" ] && ! grep -qvE ' rc=0 verdict=PASS checks=[1-9][0-9]*$' "$TMP/ver_$1.txt"; }
verifies_detail() {
  local t
  tr '\n' ' ' < "$TMP/ver_$1.txt"
  for t in $(grep -vE ' rc=0 verdict=PASS checks=[1-9][0-9]*$' "$TMP/ver_$1.txt" | cut -d' ' -f1); do
    printf '[%s fail: %s %s] ' "$t" "$(awk -F "$US" '$2 == "check" && ($5 == "f" || $5 == "fail") {print $3}' "$TMP/ver_${1}_$t.out" | tr '\n' ',')" "$(tailof "$TMP/ver_${1}_$t.out" | tr "$US" '|')"
  done
}

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0024 BODY"); m_ptest=$(body_md5 "$PTEST" "0024 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" "$ROLLBACK" | grep -qE 'zell\.approved_by ='; then ok=yes; fi
record "S03 apply + rollback: one begin + one commit (last), no approval line inside the files" "$ok" ""

# ---- 2) بناء الداتابيز من القايمة الصريحة كلها ----
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')")
[ "$fresh" = "0" ] || stop "B01 fresh disposable cluster" "platform roles already present"
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$TMP/createdb.log" 2>&1 || stop "B01 create database" "$(tailof "$TMP/createdb.log")"
su_f "$DB" "$CIDIR/platform_shim.sql" > "$TMP/shim.log" 2>&1 || stop "B01 platform_shim.sql" "$(tailof "$TMP/shim.log")"
su_f "$DB" "$CIDIR/platform_default_privileges.sql" > "$TMP/dp.log" 2>&1 || stop "B01 platform_default_privileges.sql" "$(tailof "$TMP/dp.log")"
n=0
while IFS='|' read -r kind rel _reason; do
  case "$kind" in ''|'#'*|exclude) continue ;; apply|baseline|fixture|check) ;; *) stop "B01 build list" "unknown kind $kind" ;; esac
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list" "missing $rel"
  n=$((n + 1))
  runf="$f"
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/run_$n.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0024-build';/" "$f" > "$runf"
    if grep -q 'zell\.inv_expected' "$f"; then
      sed -i "0,/^begin;\$/s//begin;\nset local zell.inv_expected = 'locations=1 suppliers=0 purchase_docs=0 purchase_doc_lines=0 purchase_doc_charges=0 opening_docs=0 opening_lines=0 stock_lots=0 commands=0 audit=0';/" "$runf"
    fi
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
st=$(state)
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$st" = "$BEFORE_STATE" ] && ok=yes
record "B01 database built from the whole build_from_scratch.list ($n steps), postgres not superuser, guards = Production read ($BEFORE_STATE)" "$ok" "steps=$n postgres=$shape state=$st"
[ "$ok" = yes ] || finish

# ---- 3) قبل التطبيق: الـ 9 verify · ptest · الحراس · الرجوع الكامل ----
verifies before
ok=no; verifies_pass before && ok=yes
record "E01 the 9 existing verifies before 0024 (A1 · D · P1 · P2 · D2 · TR · TR2 · EX · 0021-P strict) = PASS" "$ok" "$(verifies_detail before)"
FP0=$(fp_out)
run_file "$PTEST" "$TMP/ptest.out"
ok=no; [ "$(summary_of "$TMP/ptest.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "T01 ptest -> PASS (8 pass, 0 fail)" "$ok" "$(summary_of "$TMP/ptest.out") $(fails_of "$TMP/ptest.out") $(tailof "$TMP/ptest.out")"
ok=no; [ "$(state)" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "T02 ptest leaves nothing (state + outside fingerprint = before)" "$ok" "state=$(state)"
psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$APPLY" < /dev/null > "$TMP/g1.out" 2>&1
ok=no; has "$TMP/g1.out" 'ZELL_0024_APPROVAL_MISSING' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G01 apply without the approval line -> ZELL_0024_APPROVAL_MISSING, nothing changed" "$ok" "$(tailof "$TMP/g1.out")"
with_appr "$APPLY" "ci-0024" | sed "0,/^begin;\$/s//begin;\nset local role service_role;/" \
  | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/g2.out" 2>&1
ok=no; has "$TMP/g2.out" 'ZELL_0024_WRONG_CALLER' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G02 apply by another role -> ZELL_0024_WRONG_CALLER, nothing changed" "$ok" "$(tailof "$TMP/g2.out")"
sed "s/^commit;\$/do \$z24\$ begin raise exception 'ZELL_CI_ABORT_AFTER_BODY'; end \$z24\$;\ncommit;/" "$APPLY" > "$TMP/abort.sql"
run_appr "$TMP/abort.sql" "ci-0024" "$TMP/z1.out"
ok=no; has "$TMP/z1.out" 'ZELL_CI_ABORT_AFTER_BODY' && ! grep -q 'ZELL_0024_' "$TMP/z1.out" && [ "$(state)" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "Z01 body runs to the end (postflight included), then a forced error rolls everything back" "$ok" "state=$(state) $(tailof "$TMP/z1.out")"

# ---- 4) التطبيق ----
run_appr "$APPLY" "ci-0024" "$TMP/apply.out"
ok=no; ! grep -q 'ERROR' "$TMP/apply.out" && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "A01 apply -> commit ($AFTER_STATE)" "$ok" "state=$(state) $(tailof "$TMP/apply.out")"
run_file "$VERIFY" "$TMP/v24.out"
ok=no; [ "$(summary_of "$TMP/v24.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "A02 verify 0024 -> PASS (10 checks)" "$ok" "$(summary_of "$TMP/v24.out") $(fails_of "$TMP/v24.out")"
ok=no; [ "$(fp_out)" = "$FP0" ] && ok=yes
record "A03 everything outside the new objects and the 3 guards unchanged (functions · grants · roles · policies · triggers · constraints · rows)" "$ok" "before=$FP0 after=$(fp_out)"
verifies after
diffs=""
for item in $VLIST; do tag=${item%%:*}; cmp -s "$TMP/vec_before_$tag" "$TMP/vec_after_$tag" || diffs="$diffs $tag"; done
ok=no; verifies_pass after && [ -z "$diffs" ] && ok=yes
record "E02 the same 9 verifies after 0024 = PASS, and every check_id=ok vector = before" "$ok" "vectors changed:${diffs:- none} $(verifies_detail after)"
if node "$CIDIR/call_contract.mjs" --root "$ROOT" --policy "$CIDIR/call_contract_policy.json" --sql "$TMP/cc.sql" > "$TMP/cc_static.log" 2>&1; then
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f "$TMP/cc.sql" < /dev/null > "$TMP/cc_db.log" 2>&1; rc=$?
  fails=$(grep -c '^CALL FAIL ' "$TMP/cc_db.log" || true)
  passes=$(grep -c '^CALL PASS ' "$TMP/cc_db.log" || true)
  checks=$(grep -oE '"checks":[0-9]+' "$TMP/cc_static.log" | head -n 1 | cut -d: -f2)
  ok=no
  [ "$rc" -eq 0 ] && [ "$fails" = "0" ] && [ -n "$checks" ] && [ "$passes" = "$checks" ] && ! grep -qE '^(PENDING|STALE_PENDING) ' "$TMP/cc_static.log" && ok=yes
  record "K01 call contract of the apps on the database after 0024: $passes of ${checks:-?} checks, no CALL FAIL" "$ok" "rc=$rc fails=$fails $(grep '^CALL FAIL ' "$TMP/cc_db.log" | head -n 5 | tr '\n' ' ') $(tailof "$TMP/cc_db.log")"
else
  record "K01 call contract of the apps on the database after 0024 (static part failed)" no "$(tailof "$TMP/cc_static.log")"
fi
run_appr "$ROLLBACK" "ci-0024-rollback" "$TMP/rb1.out"
ok=no; ! grep -q 'ERROR' "$TMP/rb1.out" && [ "$(state)" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "RB1 rollback with an empty log -> state and outside fingerprint = before, guards back to the Production bodies" "$ok" "state=$(state) $(tailof "$TMP/rb1.out")"
run_appr "$APPLY" "ci-0024" "$TMP/a4.out"
run_file "$VERIFY" "$TMP/v24b.out"
ok=no; ! grep -q 'ERROR' "$TMP/a4.out" && [ "$(state)" = "$AFTER_STATE" ] && [ "$(summary_of "$TMP/v24b.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "A04 re-apply after rollback + verify PASS" "$ok" "state=$(state) $(summary_of "$TMP/v24b.out") $(tailof "$TMP/a4.out")"
run_appr "$APPLY" "ci-0024" "$TMP/r1.out"
ok=no; has "$TMP/r1.out" 'ZELL_0024_ALREADY_APPLIED' && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "R01 apply twice -> ZELL_0024_ALREADY_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/r1.out")"

# ---- 5) بيانات CI ----
su_sql > "$TMP/x1.log" <<SQL
insert into auth.users (id, email) values ('$OWNER_ID', 'ci-owner-0024@example.invalid'), ('$ADMIN_ID', 'ci-admin-0024@example.invalid');
insert into public.admin_users (user_id, role, is_active) values ('$OWNER_ID', 'owner', true), ('$ADMIN_ID', 'admin', true);
insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0024-product', 1000, false);
insert into public.coupons (code, kind, amount_off_piastres, max_uses) values ('CI0024A', 'fixed', 1000, 1);
insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres)
values ('FLM-CIAAAA', 'عميل أ', '01000002401', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000),
       ('FLM-CIBBBB', 'عميل ب', '01000002402', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000),
       ('FLM-CICCCC', 'عميل ج', '01000002403', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000),
       ('FLM-CIEEEE', 'عميل هـ', '01000002405', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000),
       ('FLM-CIFFFF', 'عميل و', '01000002406', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000);
insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres,
                           coupon_id, coupon_code, coupon_kind, coupon_amount_piastres, discount_piastres)
select 'FLM-CIDDDD', 'عميل د', '01000002404', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 34000, c.id, 'CI0024A', 'fixed', 1000, 1000
  from public.coupons c where c.code = 'CI0024A';
insert into public.order_items (order_id, product_id, product_name_ar, unit_price_piastres, length_cm, width_cm, line_total_piastres)
select o.id, (select p.id from public.products p where p.name_ar = 'ci-0024-product'), 'ci-0024-item', 100, 300, 50, 30000
  from public.orders o where o.order_number like 'FLM-CI%';
set session_replication_role = replica;
insert into public.zell_payment_commands (command_id, operation, order_id, actor, request_hash, result)
select x.cid, x.op, o.id, '$OWNER_ID', pg_catalog.md5(x.cid::text), '{}'::jsonb
  from public.orders o join (values ('FLM-CIAAAA', '00000000-0000-4000-8000-0000000000a1'::uuid, 'payment'), ('FLM-CIAAAA', '00000000-0000-4000-8000-0000000000a2'::uuid, 'refund'),
                                    ('FLM-CIBBBB', '00000000-0000-4000-8000-0000000000a3'::uuid, 'payment')) x(num, cid, op) on x.num = o.order_number;
insert into public.order_payments (order_id, kind, amount_piastres, purpose, method_name, method_is_other, actor, command_id, request_hash, paid_after_piastres)
select o.id, x.k, x.a, 'balance', 'CI', true, '$OWNER_ID', x.cid, pg_catalog.md5(x.cid::text), x.after
  from public.orders o join (values ('FLM-CIAAAA', 'payment', 10000, '00000000-0000-4000-8000-0000000000a1'::uuid, 10000),
                                    ('FLM-CIAAAA', 'refund', 2000, '00000000-0000-4000-8000-0000000000a2'::uuid, 8000),
                                    ('FLM-CIBBBB', 'payment', 5000, '00000000-0000-4000-8000-0000000000a3'::uuid, 5000)) x(num, k, a, cid, after) on x.num = o.order_number;
update public.orders o set paid_piastres = 8000 where o.order_number = 'FLM-CIAAAA';
update public.orders o set paid_piastres = 5000 where o.order_number = 'FLM-CIBBBB';
insert into public.zell_order_shipments (order_id, carrier, updated_by) select o.id, 'CI Carrier', '$OWNER_ID' from public.orders o where o.order_number = 'FLM-CIBBBB';
insert into public.zell_order_shipments_log (order_id, actor, new_value) select o.id, '$OWNER_ID', '{"carrier": "CI Carrier"}'::jsonb from public.orders o where o.order_number = 'FLM-CIBBBB';
insert into public.zell_order_customer_updates (order_id, text, created_by, updated_by) select o.id, 'رسالة CI', '$OWNER_ID', '$OWNER_ID' from public.orders o where o.order_number = 'FLM-CIBBBB';
insert into public.zell_order_customer_updates_log (update_id, order_id, action, actor, new_value)
select u.id, u.order_id, 'add', '$OWNER_ID', '{"text": "رسالة CI"}'::jsonb from public.zell_order_customer_updates u;
set session_replication_role = origin;
select 'X01_DONE';
SQL
OA=$(oid_of FLM-CIAAAA); OB=$(oid_of FLM-CIBBBB); OC=$(oid_of FLM-CICCCC); OD=$(oid_of FLM-CIDDDD); OE=$(oid_of FLM-CIEEEE); OF=$(oid_of FLM-CIFFFF)
cnt=$(q "select (select pg_catalog.count(*) from public.orders) || '|' || (select pg_catalog.count(*) from public.order_events e where e.order_id in ($OA, $OB)) || '|' || (select pg_catalog.count(*) from public.order_payments) || '|' || (select pg_catalog.count(*) from public.zell_order_customer_updates_log)")
ok=no; has "$TMP/x1.log" 'X01_DONE' && [ "$(printf '%s' "$cnt" | cut -d'|' -f1)" -ge 6 ] && [ "$(printf '%s' "$cnt" | cut -d'|' -f2)" -ge 2 ] && [ "$(printf '%s' "$cnt" | cut -d'|' -f3)" = "3" ] && [ "$(printf '%s' "$cnt" | cut -d'|' -f4)" = "1" ] && ok=yes
record "X01 CI data: owner + admin · 6 orders (A: payment + refund · B: payment + shipment + message · D: coupon) · created events" "$ok" "ids=$OA,$OB,$OC,$OD,$OE,$OF counts=$cnt $(tailof "$TMP/x1.log")"
FPD=$(fp_out)

# ---- 6) السيناريوهات ----
r1=$(as_user "$ADMIN_ID" "$SESS" "select public.zell_purge_preview(null)::text")
r2=$(srv "select public.zell_purge_preview(null)::text")
r3=$(as_user "$OWNER_ID" "$SESS" "select public.zell_purge_reauth_begin('$OWNER_ID'::uuid)::text")
r4=$(srv "select public.zell_purge_reauth_begin('$ADMIN_ID'::uuid)::text")
r5=$(srv "select public.zell_purge_orders(array[$OA], repeat('a', 32), 1, '$SESS'::uuid)::text")
ok=no; [ "$r1" != "${r1%45402*}" ] && [ "$r2" != "${r2%42501*}" ] && [ "$r3" != "${r3%42501*}" ] && [ "$r4" != "${r4%45603*}" ] && [ "$r5" != "${r5%42501*}" ] && ok=yes
record "F01 access: admin preview = 45402 · service_role preview = 42501 · authenticated reauth = 42501 · reauth for admin = 45603 · service_role purge = 42501" "$ok" "$r1 | $r2 | $r3 | $r4 | $r5"
reset_attempts
PA=$(pv "array[$OA]::integer[]")
r=$(as_user "$OWNER_ID" "$SESS" "select (x.p -> 'orders' -> 0 ->> 'customer_name') || '|' || (x.p ->> 'payments_count') || '|' || (x.p ->> 'received_piastres') || '|' || (x.p ->> 'refunded_piastres') from (select public.zell_purge_preview(array[$OA]::integer[]) as p) x")
ok=no; [ "$(f3 "$PA")" = "1" ] && [ "$r" = "عميل أ|2|10000|2000" ] && ok=yes
record "F02 owner preview: list with name and payments · received 10000 · refunded 2000 · DB hashes" "$ok" "pv=$PA r=$r"
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 1 '00000000-0000-4000-8000-0000000000ff')
ok=no; [ "$r" != "${r%45607*}" ] && [ "$(oid_of FLM-CIAAAA)" = "$OA" ] && ok=yes
record "F03 purge with an unknown ticket -> 45607, nothing changed" "$ok" "$r"
reset_attempts
T=$(issue "$OWNER_ID" "$SESS2" "$(f1 "$PA")" "$(f2 "$PA")" 1)
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 1 "$T")
ok=no; [ "$r" != "${r%45607*}" ] && [ "$(oid_of FLM-CIAAAA)" = "$OA" ] && ok=yes
record "F04 ticket from another session -> 45607, nothing changed" "$ok" "ticket=$T r=$r"
reset_attempts
PAC=$(pv "array[$OA, $OC]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PA")" "$(f2 "$PA")" 1)
r=$(purge "array[$OA, $OC]::integer[]" "$(f2 "$PAC")" 2 "$T")
ok=no; [ "$r" != "${r%45607*}" ] && [ "$(oid_of FLM-CIAAAA)" = "$OA" ] && [ "$(oid_of FLM-CICCCC)" = "$OC" ] && ok=yes
record "F05 ticket issued for one order used for two (scope) -> 45607, nothing changed" "$ok" "r=$r"
reset_attempts
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PA")" "$(f2 "$PA")" 1)
su_q "$DB" -c "update public.zell_purge_reauth r set issued_at = pg_catalog.now() - interval '10 minutes', expires_at = pg_catalog.now() - interval '5 minutes' where r.ticket = '$T'" > /dev/null 2>&1
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 1 "$T")
ok=no; [ "$r" != "${r%45607*}" ] && [ "$(oid_of FLM-CIAAAA)" = "$OA" ] && ok=yes
record "F06 expired ticket -> 45607, nothing changed" "$ok" "r=$r"
reset_attempts
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PA")" "$(f2 "$PA")" 1)
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 2 "$T")
ok=no; [ "$r" != "${r%45606*}" ] && [ "$(oid_of FLM-CIAAAA)" = "$OA" ] && ok=yes
record "F07 count different from the ids -> 45606, nothing changed" "$ok" "r=$r"
reset_attempts
PC=$(pv "array[$OC]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PC")" "$(f2 "$PC")" 1)
q "update public.orders o set notes = 'تعديل بعد المعاينة' where o.id = $OC" > /dev/null
r=$(purge "array[$OC]::integer[]" "$(f2 "$PC")" 1 "$T")
ok=no; [ "$r" != "${r%45605*}" ] && [ "$(oid_of FLM-CICCCC)" = "$OC" ] && ok=yes
record "F08 the order changed after the preview -> 45605, nothing changed" "$ok" "r=$r"
reset_attempts
PC=$(pv "array[$OC]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PC")" "$(f2 "$PC")" 1)
q "update public.order_items t set product_name_ar = 'ci-0024-item-renamed' where t.order_id = $OC" > /dev/null
r=$(purge "array[$OC]::integer[]" "$(f2 "$PC")" 1 "$T")
ok=no; [ "$r" != "${r%45605*}" ] && [ "$(oid_of FLM-CICCCC)" = "$OC" ] && ok=yes
record "F09 a dependent's content changed with the same count and ids (order_items.product_name_ar) -> 45605, nothing changed" "$ok" "r=$r"
reset_attempts
PC=$(pv "array[$OC]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PC")" "$(f2 "$PC")" 1)
q "create table public.ci_0024_dep (order_id integer references public.orders (id) on delete cascade)" > /dev/null
r=$(purge "array[$OC]::integer[]" "$(f2 "$PC")" 1 "$T")
q "drop table public.ci_0024_dep" > /dev/null
ok=no; [ "$r" != "${r%45604*}" ] && [ "$(oid_of FLM-CICCCC)" = "$OC" ] && ok=yes
record "F10 a table with an FK on orders outside the approved list -> 45604 (no uncounted cascade), nothing changed" "$ok" "r=$r"
reset_attempts
PA=$(pv "array[$OA]::integer[]")
before=$(q "select pg_catalog.count(*) from public.orders")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PA")" "$(f2 "$PA")" 1)
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 1 "$T")
left=$(q "select (select pg_catalog.count(*) from public.orders) || '|' || (select pg_catalog.count(*) from public.order_items t where t.order_id = $OA) || '|' || (select pg_catalog.count(*) from public.order_events t where t.order_id = $OA) || '|' || (select pg_catalog.count(*) from public.order_payments t where t.order_id = $OA) || '|' || (select pg_catalog.count(*) from public.zell_payment_commands t where t.order_id = $OA)")
log=$(q "select l.order_numbers::text || '|' || l.orders_count || '|' || l.payments_count || '|' || l.received_piastres || '|' || l.refunded_piastres || '|' || (l.actor = '$OWNER_ID')::text from public.zell_purge_log l order by l.id desc limit 1")
cols=$(q "select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid = 'public.zell_purge_log'::regclass and a.attnum > 0 and not a.attisdropped")
ok=no
[ "$left" = "$((before - 1))|0|0|0|0" ] && [ "$log" = "{FLM-CIAAAA}|1|2|10000|2000|true" ] \
  && [ "$cols" = "id,purged_at,actor,order_numbers,orders_count,payments_count,received_piastres,refunded_piastres" ] \
  && printf '%s' "$r" | grep -q '"deleted": 1' && ok=yes
record "F11 delete one order: order + items + events + payments + commands gone · others intact · log row without personal data" "$ok" "r=$r left=$left log=$log cols=$cols"
r=$(purge "array[$OA]::integer[]" "$(f2 "$PA")" 1 "$T")
ok=no; { [ "$r" != "${r%45605*}" ] || [ "$r" != "${r%45607*}" ]; } && [ "$(q "select pg_catalog.count(*) from public.zell_purge_log")" = "1" ] && ok=yes
record "F12 the same ticket again -> refused, no second log row" "$ok" "r=$r"
q "do \$f13\$
declare v text := ''; s text;
begin
  begin delete from public.order_payments t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'pay:' || s || ',';
  begin delete from public.zell_payment_commands t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'cmd:' || s || ',';
  begin delete from public.zell_order_shipments t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'shp:' || s || ',';
  begin delete from public.zell_order_shipments_log t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'shplog:' || s || ',';
  begin delete from public.zell_order_customer_updates t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'cu:' || s || ',';
  begin delete from public.zell_order_customer_updates_log t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'culog:' || s || ',';
  begin update public.order_payments t set note = 'x' where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'payupd:' || s || ',';
  begin update public.zell_order_shipments_log t set actor = t.actor where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'shplogupd:' || s || ',';
  begin truncate public.order_payments; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'paytrunc:' || s || ',';
  begin update public.zell_order_shipments t set carrier = 'CI Carrier 2' where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'shpupd:' || s || ',';
  begin update public.zell_order_customer_updates t set text = 'رسالة CI 2' where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; v := v || 'cuupd:' || s || ',';
  begin set local role zell_purge_definer; perform pg_catalog.set_config('zell.purge_order_ids', '{$OC}', true);
        delete from public.order_payments t where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; reset role; v := v || 'roleother:' || s || ',';
  begin set local role zell_purge_definer; perform pg_catalog.set_config('zell.purge_order_ids', '{$OB}', true);
        delete from public.zell_payment_config_log; s := 'ok'; exception when others then s := sqlstate; end; reset role; v := v || 'rolecfg:' || s || ',';
  begin set local role zell_purge_definer; perform 1 from public.order_payments t where t.order_id = $OB for update; s := 'ok'; exception when others then s := sqlstate; end; reset role; v := v || 'rolelock:' || s || ',';
  begin set local role zell_purge_definer; update public.order_payments t set note = 'x' where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; reset role; v := v || 'roleupd:' || s || ',';
  begin set local role zell_purge_definer; update public.zell_order_shipments t set carrier = 'x' where t.order_id = $OB; s := 'ok'; exception when others then s := sqlstate; end; reset role; v := v || 'roleshpupd:' || s;
  raise notice 'F13=%', v;
end
\$f13\$" > "$TMP/f13.out" 2>&1
got=$(grep -o 'F13=.*' "$TMP/f13.out" | head -n 1)
exp='F13=pay:45427,cmd:45427,shp:45413,shplog:45413,cu:45413,culog:45413,payupd:45427,shplogupd:45413,paytrunc:45427,shpupd:ok,cuupd:ok,roleother:45427,rolecfg:42501,rolelock:ok,roleupd:42501,roleshpupd:42501'
ok=no; [ "$got" = "$exp" ] && ok=yes
record "F13 existing guards byte for byte: direct DELETE/UPDATE/TRUNCATE refused with the same codes · shipment and message edits still allowed · the role: other orders refused, config log refused, lock works, real UPDATE refused" "$ok" "got=$got"
r1=$(q "update public.zell_purge_log l set payments_count = 0" | tr '\n' ' ')
r2=$(q "delete from public.zell_purge_log" | tr '\n' ' ')
r3=$(q "truncate public.zell_purge_log" | tr '\n' ' ')
ok=no; printf '%s' "$r1$r2$r3" | grep -o 'ZELL_PURGE_LOG_APPEND_ONLY' | wc -l | grep -qx 3 && [ "$(q "select pg_catalog.count(*) from public.zell_purge_log")" = "1" ] && ok=yes
record "F14 zell_purge_log: update / delete / truncate refused (append-only, no exception)" "$ok" "$r1 | $r2 | $r3"
reset_attempts
used0=$(q "select pg_catalog.count(*) from public.orders o join public.coupons c on c.id = o.coupon_id where c.code = 'CI0024A' and o.status <> 'cancelled'")
PD=$(pv "array[$OD]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PD")" "$(f2 "$PD")" 1)
r=$(purge "array[$OD]::integer[]" "$(f2 "$PD")" 1 "$T")
used1=$(q "select pg_catalog.count(*) from public.orders o join public.coupons c on c.id = o.coupon_id where c.code = 'CI0024A' and o.status <> 'cancelled'")
ok=no; [ "$used0" = "1" ] && [ "$used1" = "0" ] && [ "$(q "select pg_catalog.count(*) from public.coupons c where c.code = 'CI0024A'")" = "1" ] && printf '%s' "$r" | grep -q '"deleted": 1' && ok=yes
record "F15 coupon usage (counted from orders like zell_create_order) back from 1 to 0 · the coupon itself stays" "$ok" "used $used0 -> $used1 r=$r"
reset_attempts
seq=""
for i in 1 2 3 4 5 6; do seq="$seq$(srv "select public.zell_purge_reauth_begin('$OWNER_ID'::uuid) ->> 'allowed'"),"; done
fin=$(srv "select public.zell_purge_reauth_finish('$OWNER_ID'::uuid, '$SESS'::uuid, true, repeat('a', 32), repeat('b', 32), 1)::text")
lk=$(q "select (a.locked_until > pg_catalog.now())::text from public.zell_purge_attempts a where a.actor = '$OWNER_ID'")
reset_attempts
fin2=$(srv "select public.zell_purge_reauth_finish('$OWNER_ID'::uuid, '$SESS'::uuid, true, repeat('a', 32), repeat('b', 32), 1)::text")
for i in 1 2 3 4 5 6 7 8; do
  (srv "select public.zell_purge_reauth_begin('$OWNER_ID'::uuid) ->> 'allowed'" > "$TMP/par_$i.out") &
done
wait
par=$(cat "$TMP"/par_*.out | grep -c '^true$')
reset_attempts
ok=no; [ "$seq" = "true,true,true,true,true,false," ] && [ "$fin" != "${fin%45607*}" ] && [ "$lk" = "true" ] && [ "$fin2" != "${fin2%45607*}" ] && [ "$par" = "5" ] && ok=yes
record "F16 limit: 5 attempts then locked (15 min) · no ticket while locked · no ticket without an attempt · 8 parallel attempts -> exactly 5 allowed" "$ok" "seq=$seq fin=$fin locked=$lk fin2=$fin2 parallel_allowed=$par"
PE=$(pv "array[$OE]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PE")" "$(f2 "$PE")" 1)
su_q "$DB" -c "update public.admin_users a set is_active = false where a.user_id = '$OWNER_ID'" > /dev/null 2>&1
r=$(purge "array[$OE]::integer[]" "$(f2 "$PE")" 1 "$T")
su_q "$DB" -c "update public.admin_users a set is_active = true where a.user_id = '$OWNER_ID'" > /dev/null 2>&1
ok=no; { [ "$r" != "${r%45401*}" ] || [ "$r" != "${r%45400*}" ]; } && [ "$(oid_of FLM-CIEEEE)" = "$OE" ] && ok=yes
record "F17 owner deactivated between ticket and use -> refused (owner re-checked), nothing changed" "$ok" "r=$r"

# ---- 7) جلستين ----
bg_purge() { # $1 ids $2 snap $3 count $4 ticket $5 out $6 app
  printf '%s\n' "begin;" "select pg_catalog.set_config('request.jwt.claims', '$(claims "$OWNER_ID" "$SESS")', true);" "set local role authenticated;" \
    "select public.zell_purge_orders($1, '$2', $3, '$4'::uuid)::text;" "select pg_catalog.pg_sleep(3);" "commit;" \
    | PGAPPNAME="$6" psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U postgres -d "$DB" -f - > "$5" 2>&1
}
reset_attempts
PE=$(pv "array[$OE]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PE")" "$(f2 "$PE")" 1)
bg_purge "array[$OE]::integer[]" "$(f2 "$PE")" 1 "$T" "$TMP/c1p.out" ci0024_purge &
hp=$!
if wait_app ci0024_purge; then
  printf '%s\n' "set session_replication_role = origin;" \
    "insert into public.order_payments (order_id, kind, amount_piastres, purpose, method_name, method_is_other, actor, command_id, request_hash, paid_after_piastres) values ($OE, 'payment', 100, 'balance', 'CI', true, '$OWNER_ID', '00000000-0000-4000-8000-0000000000c1', pg_catalog.md5('c1'), 100);" \
    | psql -X -q -tA -v VERBOSITY=sqlstate -U "$SUPER" -d "$DB" -f - > "$TMP/c1i.out" 2>&1
  wait "$hp"
  ok=no; has "$TMP/c1p.out" '"deleted": 1' && has "$TMP/c1i.out" '23503' && ! grep -q '40P01' "$TMP/c1p.out" "$TMP/c1i.out" && [ -z "$(oid_of FLM-CIEEEE)" ] && ok=yes
  record "C01 a payment on a snapshot order during the purge waits, then fails on the FK (23503); purge done; no deadlock" "$ok" "purge=$(tailof "$TMP/c1p.out") insert=$(tailof "$TMP/c1i.out")"
else
  wait "$hp"; record "C01 a payment during the purge" no "purge session never reached its sleep: $(tailof "$TMP/c1p.out")"
fi
holder() { # $1 table $2 out $3 app
  printf '%s\n' "begin;" "select 1 from public.$1 t where t.order_id = $OB for update;" "select pg_catalog.pg_sleep(4);" "commit;" \
    | PGAPPNAME="$3" psql -X -q -tA -v VERBOSITY=sqlstate -U "$SUPER" -d "$DB" -f - > "$2" 2>&1
}
for pair in "C02:zell_order_customer_updates" "C03:zell_order_shipments"; do
  cid=${pair%%:*}; tbl=${pair##*:}
  reset_attempts
  PB=$(pv "array[$OB]::integer[]")
  T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PB")" "$(f2 "$PB")" 1)
  holder "$tbl" "$TMP/$cid.h.out" "ci0024_$cid" &
  hh=$!
  if wait_app "ci0024_$cid"; then
    t0=$(now_ms); r=$(purge "array[$OB]::integer[]" "$(f2 "$PB")" 1 "$T"); t1=$(now_ms)
    wait "$hh"
    ok=no; [ "$r" != "${r%45608*}" ] && [ $((t1 - t0)) -lt 2500 ] && [ "$(oid_of FLM-CIBBBB)" = "$OB" ] && ! grep -q '40P01' "$TMP/$cid.h.out" && ok=yes
    record "$cid a session holds a $tbl row -> purge returns 45608 at once ($((t1 - t0)) ms), nothing changed, no deadlock" "$ok" "r=$r holder=$(tailof "$TMP/$cid.h.out")"
  else
    wait "$hh"; record "$cid a session holds a $tbl row" no "holder never reached its sleep: $(tailof "$TMP/$cid.h.out")"
  fi
done
reset_attempts
PB=$(pv "array[$OB]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PB")" "$(f2 "$PB")" 1)
bg_purge "array[$OB]::integer[]" "$(f2 "$PB")" 1 "$T" "$TMP/c4p.out" ci0024_purge4 &
hp=$!
if wait_app ci0024_purge4; then
  t0=$(now_ms)
  psql -X -q -tA -v VERBOSITY=sqlstate -U "$SUPER" -d "$DB" -c "update public.zell_order_customer_updates t set text = 'تعديل وقت المسح' where t.order_id = $OB returning t.id" < /dev/null > "$TMP/c4u.out" 2>&1
  t1=$(now_ms)
  wait "$hp"
  ok=no; has "$TMP/c4p.out" '"deleted": 1' && [ ! -s "$TMP/c4u.out" ] && [ $((t1 - t0)) -ge 1000 ] && ! grep -q '40P01' "$TMP/c4p.out" "$TMP/c4u.out" && [ -z "$(oid_of FLM-CIBBBB)" ] && ok=yes
  record "C04 a message edit while the purge holds the locks waits ($((t1 - t0)) ms), then finds nothing (row deleted); purge done; no deadlock" "$ok" "purge=$(tailof "$TMP/c4p.out") edit=$(tailof "$TMP/c4u.out")"
else
  wait "$hp"; record "C04 a message edit during the purge" no "purge session never reached its sleep: $(tailof "$TMP/c4p.out")"
fi
reset_attempts
PF=$(pv "array[$OF]::integer[]")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PF")" "$(f2 "$PF")" 1)
for i in 1 2; do
  (printf '%s\n' "begin;" "select pg_catalog.set_config('request.jwt.claims', '$(claims "$OWNER_ID" "$SESS")', true);" "set local role authenticated;" \
     "select public.zell_purge_orders(array[$OF]::integer[], '$(f2 "$PF")', 1, '$T'::uuid)::text;" "commit;" \
     | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U postgres -d "$DB" -f - > "$TMP/c5_$i.out" 2>&1) &
done
wait
okc=$(cat "$TMP"/c5_*.out | grep -c '"deleted": 1')
ok=no; [ "$okc" = "1" ] && ! grep -q '40P01' "$TMP"/c5_*.out && [ -z "$(oid_of FLM-CIFFFF)" ] && ok=yes
record "C05 two sessions with the same ticket at the same time -> exactly one purge succeeds, no deadlock" "$ok" "1=$(tailof "$TMP/c5_1.out") 2=$(tailof "$TMP/c5_2.out")"
reset_attempts
PALL=$(pv "null")
IDS=$(as_user "$OWNER_ID" "$SESS" "select pg_catalog.array_to_string(array(select pg_catalog.jsonb_array_elements_text(public.zell_purge_preview(null) -> 'ids')), ',')")
T=$(issue "$OWNER_ID" "$SESS" "$(f1 "$PALL")" "$(f2 "$PALL")" "$(f3 "$PALL")")
q "insert into public.orders (order_number, customer_name, customer_phone, governorate, address, subtotal_piastres, shipping_piastres, total_piastres) values ('FLM-CIGGGG', 'عميل ز', '01000002407', 'القاهرة', 'عنوان CI طويل كفاية', 30000, 5000, 35000)" > /dev/null
r=$(purge "array[$IDS]::integer[]" "$(f2 "$PALL")" "$(f3 "$PALL")" "$T")
ok=no; printf '%s' "$r" | grep -q '"remaining_orders": 1' && [ -n "$(oid_of FLM-CIGGGG)" ] && [ "$(q "select pg_catalog.count(*) from public.orders")" = "1" ] && ok=yes
record "C06 delete-all from the preview: an order added after the preview stays (remaining 1), everything in the snapshot gone" "$ok" "ids=$IDS r=$r"

# ---- 8) الرجوع بعد مسح فعلي · verify ----
run_appr "$ROLLBACK" "ci-0024-rollback" "$TMP/rb2.out"
ok=no; has "$TMP/rb2.out" 'ZELL_0024_ROLLBACK_PURGES_EXIST' && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "RB2 rollback after real purges -> ZELL_0024_ROLLBACK_PURGES_EXIST, nothing changed" "$ok" "$(tailof "$TMP/rb2.out")"
run_file "$VERIFY" "$TMP/v24c.out"
ok=no; [ "$(summary_of "$TMP/v24c.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "A05 verify 0024 after all scenarios -> PASS" "$ok" "$(summary_of "$TMP/v24c.out") $(fails_of "$TMP/v24c.out")"

finish
