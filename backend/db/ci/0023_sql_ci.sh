#!/usr/bin/env bash
# 0023 INVENTORY-REMOVAL B — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة لحد قبل 0023
# (backend/db/ci/build_from_scratch.list، ومنها 0020 و0020-S و0022؛ سطر 0023 بيتخطّى؛ postgres مش superuser زي Production)، وبعدين 0023 فوقها.
# بيغطي: شكل المعاملة · md5 الجسم · سطور الموافقة والأعداد برّه الملف · verify 0022 قبل (PASS) · حراس الـ preflight (موافقة · أعداد ·
# أعداد غلط · متصل غلط) والحالة مابتتغيّرش · رجوع المعاملة كلها لو حصل خطأ في آخرها · ptest قبل التطبيق ومابيسيبش أثر · التطبيق ·
# verify 0023 · ثبات كل حاجة برّه المخزون (بصمة + صفوف) · رد معاينة وحذف المنتج قبل = بعد بالحرف · verify 0022 بعد: الفاشل بس
# فحوص المخزون (تاريخية، مابتتعدّلش) · رفض الإعادة.
# ومراجعة #195: التزامن (C01 كتابة بتخلص وإحنا مستنيين القفل = DATA_CHANGED والصف بيفضل · C02 قفل أطول من lock_timeout = خطأ ومفيش
# تغيير) · دالة برّه المخزون بتنادي zell_inv_* = SHAPE (G05) · الـ 9 verify الموجودة قبل وبعد (E01 · E02: PASS ونفس متجه check_id=ok) ·
# عقد استدعاء التطبيقات على الداتابيز بعد 0023 (K01).
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
APPLY="$MIG/0023_inventory_removal.sql"
PTEST="$MIG/0023_inventory_removal_ptest.sql"
VERIFY="$MIG/0023_inventory_removal_verify.sql"
V22="$MIG/0022_product_delete_verify.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB=zell_ci_0023
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
OWNER_ID='00000000-0000-4000-8000-0000000000b1'
EXPECTED="S01 S02 S03 B01 B02 X01 P01 E01 G01 G02 G03 G04 G05 C01 C02 Z01 T01 T02 A01 A02 A03 A04 A05 E02 K01 R01"
BEFORE_STATE='1|68|10|4aa0deeeb83feb653b9e363c2d418330|1'
AFTER_STATE='0|0|0|84b80a92c3c413433a71d80300bd5418|0'

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
  echo "ZELL_0023_SQL_CI_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
# سطور التشغيل بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي Production بالظبط. أي قيمة فاضية = السطر مابيتحطش.
with_lines() {
  local f=$1 appr=$2 exp=$3 pre=${4:-} ins=""
  [ -n "$pre" ] && ins="$ins\n$pre"
  [ -n "$appr" ] && ins="$ins\nset local zell.approved_by = '$appr';"
  [ -n "$exp" ] && ins="$ins\nset local zell.inv_expected = '$exp';"
  sed "0,/^begin;\$/s//begin;$ins/" "$f"
}
run_with() { with_lines "$1" "$2" "$3" "${5:-}" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$4" 2>&1; }
state() {
  q "select (pg_catalog.to_regrole('zell_inventory_definer') is not null)::int
       || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
       || '|' || (select pg_catalog.count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('inventory_locations','suppliers','purchase_docs','purchase_doc_lines','purchase_doc_charges','opening_stock_docs','opening_stock_lines','stock_lots','inventory_commands','inventory_audit_log'))
       || '|' || coalesce((select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)')), '-')
       || '|' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t where t.tgname = 'zinv_products_sale_unit')"
}
data_line() {
  su_q "$DB" -c "select 'locations=' || (select pg_catalog.count(*) from public.inventory_locations)
          || ' suppliers=' || (select pg_catalog.count(*) from public.suppliers)
          || ' purchase_docs=' || (select pg_catalog.count(*) from public.purchase_docs)
          || ' purchase_doc_lines=' || (select pg_catalog.count(*) from public.purchase_doc_lines)
          || ' purchase_doc_charges=' || (select pg_catalog.count(*) from public.purchase_doc_charges)
          || ' opening_docs=' || (select pg_catalog.count(*) from public.opening_stock_docs)
          || ' opening_lines=' || (select pg_catalog.count(*) from public.opening_stock_lines)
          || ' stock_lots=' || (select pg_catalog.count(*) from public.stock_lots)
          || ' commands=' || (select pg_catalog.count(*) from public.inventory_commands)
          || ' audit=' || (select pg_catalog.count(*) from public.inventory_audit_log)"
}
# بصمة مستقلة عن الـ migration لكل حاجة برّه المخزون: الدوال (غير zell_inv_* ودالتين الحذف) بصلاحياتها وأجسامها، والجداول بصلاحياتها، والأدوار، والقيود، والصفوف.
fp_out() {
  q "select pg_catalog.md5(pg_catalog.concat_ws('|',
       (select pg_catalog.string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '-') || '=' || pg_catalog.md5(p.prosrc) || '=' || pg_catalog.pg_get_userbyid(p.proowner), ',' order by 1)
          from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'zell\_inv\_%'
           and p.proname not in ('zell_product_delete', 'zell_product_delete_preview')),
       (select pg_catalog.string_agg(c.relname || '=' || coalesce(c.relacl::text, '-'), ',' order by 1) from pg_catalog.pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S') and c.relname not in ('inventory_locations','suppliers','purchase_docs','purchase_doc_lines','purchase_doc_charges','opening_stock_docs','opening_stock_lines','stock_lots','inventory_commands','inventory_audit_log', 'purchase_doc_no_seq','opening_doc_no_seq','roll_lot_seq','batch_lot_seq')
           and not exists (select 1 from pg_catalog.pg_depend d join pg_catalog.pg_class t on t.oid = d.refobjid
                            where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
                              and t.relnamespace = 'public'::regnamespace and t.relname in ('inventory_locations','suppliers','purchase_docs','purchase_doc_lines','purchase_doc_charges','opening_stock_docs','opening_stock_lines','stock_lots','inventory_commands','inventory_audit_log'))),
       (select pg_catalog.string_agg(r.rolname, ',' order by 1) from pg_catalog.pg_roles r where r.rolname <> 'zell_inventory_definer'),
       (select pg_catalog.string_agg(c.relname || '.' || co.conname, ',' order by 1) from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid = co.conrelid
         where co.connamespace = 'public'::regnamespace and c.relname not in ('inventory_locations','suppliers','purchase_docs','purchase_doc_lines','purchase_doc_charges','opening_stock_docs','opening_stock_lines','stock_lots','inventory_commands','inventory_audit_log'))))
       || '|' || (select pg_catalog.count(*) from public.products) || ',' || (select pg_catalog.count(*) from public.orders)
       || ',' || (select pg_catalog.count(*) from public.order_items) || ',' || (select pg_catalog.count(*) from public.admin_users)
       || ',' || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.key || '=' || s.value::text, ',' order by s.key), '')) from public.settings s)"
}
# نداء بجلسة المالك (authenticated + claims) جوه معاملة بترجع؛ آخر سطر = النتيجة.
owner_call() {
  printf '%s\n' "begin;" \
    "select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$OWNER_ID\",\"role\":\"authenticated\"}', true);" \
    "set local role authenticated;" "$1;" "rollback;" \
    | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1 | grep -v '^$' | tail -n 1
}

# ---- مساعدات مراجعة #195 ----
# B3: الـ 9 verify الموجودة. الوسم:الملف:عمود الـ verdict في صف الملخص (0021-P: العمود 11 والفحص pass/fail؛ الباقي العمود 7 و t/f).
VLIST="A1:0021a_a1_order_cycle_verify.sql:7 D:0021d_preferred_delivery_verify.sql:7 P1:0021a_p1_payments_verify.sql:7 P2:0021a_p2_checkout_fee_verify.sql:7 D2:0021d2_delivery_settings_verify.sql:7 TR:0021tr_track_order_verify.sql:7 TR2:0021tr2_track_order_v2_verify.sql:7 EX:0021ex_express_shipping_verify.sql:7 0021-P:0021p_access_verify.sql:11"
US="$(printf '\037')"
# بيشغّلهم بـ postgres زي Production (فاصل الأعمدة \037 لأن الأسماء والتفاصيل ممكن يبقى فيها |). لكل واحد سطر: الوسم · rc · verdict · عدد
# الفحوص، ومتجه check_id=ok (العمود 3 = العمود 5) بالترتيب في $TMP/vec_<المرحلة>_<الوسم>.
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
# B1: جلسة كتابة تانية في الخلفية (superuser بـ replica زي X01): بتضيف مورد ($1)، تستنى ($2 ثانية)، وبعدين $3 (commit أو rollback).
holder() {
  printf '%s\n' "set session_replication_role = replica;" "begin;" \
    "insert into public.suppliers (name, name_key, created_by, updated_by) values ('$1', '$(printf '%s' "$1" | tr 'A-Z' 'a-z')', '$OWNER_ID', '$OWNER_ID');" \
    "select pg_catalog.pg_sleep($2);" "$3;" \
    | PGAPPNAME=ci0023_holder psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f - > "$4" 2>&1
}
# لحد ما الجلسة التانية تمسك قفل الكتابة بتاعها على suppliers (أقصى 10 ثواني).
wait_holder() {
  local i=0
  while [ "$i" -lt 50 ]; do
    [ "$(su_q "$DB" -c "select pg_catalog.count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid = l.pid
                         where a.application_name = 'ci0023_holder' and l.relation = 'public.suppliers'::regclass and l.mode = 'RowExclusiveLock' and l.granted")" = "1" ] && return 0
    sleep 0.2; i=$((i + 1))
  done
  return 1
}
now_ms() { date +%s%3N; }

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0023 BODY"); m_ptest=$(body_md5 "$PTEST" "0023 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" | grep -qE 'zell\.(approved_by|inv_expected) ='; then ok=yes; fi
record "S03 apply: one begin + one commit (last), no approval or expected-data line inside the file" "$ok" ""

# ---- 2) بناء الداتابيز من القايمة الصريحة كلها (زي build_from_scratch.sh) ----
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')")
[ "$fresh" = "0" ] || stop "B01 fresh disposable cluster" "platform roles already present"
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$TMP/createdb.log" 2>&1 || stop "B01 create database" "$(tailof "$TMP/createdb.log")"
su_f "$DB" "$CIDIR/platform_shim.sql" > "$TMP/shim.log" 2>&1 || stop "B01 platform_shim.sql" "$(tailof "$TMP/shim.log")"
su_f "$DB" "$CIDIR/platform_default_privileges.sql" > "$TMP/dp.log" 2>&1 || stop "B01 platform_default_privileges.sql" "$(tailof "$TMP/dp.log")"
n=0
while IFS='|' read -r kind rel _reason; do
  case "$kind" in ''|'#'*|exclude) continue ;; apply|baseline|fixture|check) ;; *) stop "B01 build list" "unknown kind $kind" ;; esac
  # 0023 نفسها في القايمة من المرحلة C (آخر سطر): هنا البناء لحد قبلها، والملف بيتطبّق ويتختبر تحت.
  [ "$rel" = "migrations/0023_inventory_removal.sql" ] && { SKIPPED_0023=yes; break; }
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list" "missing $rel"
  n=$((n + 1))
  runf="$f"
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/run_$n.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0023-build';/" "$f" > "$runf"
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
st=$(state)
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$st" = "$BEFORE_STATE" ] && [ "${SKIPPED_0023:-no}" = "yes" ] && ok=yes
record "B01 database built from build_from_scratch.list up to before 0023 ($n steps, 0023 line skipped), postgres not superuser, inventory + 0022 present ($BEFORE_STATE)" "$ok" "steps=$n postgres=$shape state=$st skipped_0023=${SKIPPED_0023:-no}"
[ "$ok" = yes ] || finish
run_file "$V22" "$TMP/v22_before.out"
ok=no; [ "$(summary_of "$TMP/v22_before.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "B02 verify 0022 before 0023 = PASS" "$ok" "$(summary_of "$TMP/v22_before.out") $(fails_of "$TMP/v22_before.out")"

# ---- 3) بيانات CI ----
q "insert into auth.users (id, email) values ('$OWNER_ID', 'ci-owner-0023@example.invalid')" > "$TMP/x1.log"
q "insert into public.admin_users (user_id, role, is_active) values ('$OWNER_ID', 'owner', true)" >> "$TMP/x1.log"
P_PLAIN=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0023-plain', 1000, false) returning id")
P_HOME=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0023-home', 1000, false) returning id")
q "insert into public.settings (key, value) values ('home_products', '{\"mode\": \"selected\", \"ids\": [$P_HOME], \"allLabel\": \"\"}')
   on conflict (key) do update set value = excluded.value" >> "$TMP/x1.log"
su_q "$DB" -c "set session_replication_role = replica" \
  -c "insert into public.suppliers (name, name_key, created_by, updated_by) values ('CI supplier 0023', 'ci supplier 0023', '$OWNER_ID', '$OWNER_ID')" >> "$TMP/x1.log" 2>&1
EXP=$(data_line)
chk=$(q "select (select pg_catalog.count(*) from public.admin_users where user_id = '$OWNER_ID' and role = 'owner' and is_active)
         || '|' || (select pg_catalog.count(*) from public.products where name_ar like 'ci-0023-%')")
ok=no; [ "$chk" = "1|2" ] && printf '%s' "$EXP" | grep -q ' suppliers=1 ' && ok=yes
record "X01 CI data: owner ...b1, products $P_PLAIN (plain) and $P_HOME (in home), one supplier; expected data line = [$EXP]" "$ok" "$chk $(tailof "$TMP/x1.log")"

# ---- 4) رد معاينة وحذف المنتج قبل التطبيق (الحذف جوه معاملة بترجع) ----
upd_plain=$(q "select updated_at::text from public.products where id = $P_PLAIN")
upd_home=$(q "select updated_at::text from public.products where id = $P_HOME")
PV1=$(owner_call "select public.zell_product_delete_preview($P_PLAIN)::text")
PV2=$(owner_call "select public.zell_product_delete_preview($P_HOME)::text")
DL1=$(owner_call "select public.zell_product_delete($P_PLAIN, '$upd_plain'::timestamptz)::text")
DL2=$(owner_call "select public.zell_product_delete($P_HOME, '$upd_home'::timestamptz)::text")
ok=no
printf '%s' "$PV1" | grep -q '"has_stock": false' && printf '%s' "$PV2" | grep -q '"in_home": true' \
  && printf '%s' "$DL1" | grep -q '"deleted": true' && printf '%s' "$DL2" | grep -q '"removed_from_home": true' && ok=yes
record "P01 owner preview + delete (rolled back) before 0023: has_stock false, in_home, deleted, removed_from_home" "$ok" "pv1=$PV1 pv2=$PV2 dl1=$DL1 dl2=$DL2"
FP0=$(fp_out)

# ---- 4ب) الـ 9 verify الموجودة قبل 0023 (مراجعة #195 B3) ----
verifies before
ok=no; verifies_pass before && ok=yes
record "E01 the 9 existing verifies before 0023 (A1 · D · P1 · P2 · D2 · TR · TR2 · EX · 0021-P strict) = PASS" "$ok" "$(verifies_detail before)"

# ---- 5) حراس الـ preflight (كلهم قبل التطبيق، والحالة مابتتغيّرش) ----
run_with "$APPLY" "" "$EXP" "$TMP/g1.out"
ok=no; has "$TMP/g1.out" 'ZELL_0023_APPROVAL_MISSING' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G01 apply without the approval line -> ZELL_0023_APPROVAL_MISSING, nothing changed" "$ok" "$(tailof "$TMP/g1.out")"
run_with "$APPLY" "ci-0023" "" "$TMP/g2.out"
ok=no; has "$TMP/g2.out" 'ZELL_0023_DATA_CHANGED' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G02 apply without the expected-data line -> ZELL_0023_DATA_CHANGED, nothing changed" "$ok" "$(tailof "$TMP/g2.out")"
run_with "$APPLY" "ci-0023" "$EXP x" "$TMP/g3.out"
ok=no; has "$TMP/g3.out" 'ZELL_0023_DATA_CHANGED' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G03 apply with a different expected-data line -> ZELL_0023_DATA_CHANGED, nothing changed" "$ok" "$(tailof "$TMP/g3.out")"
run_with "$APPLY" "ci-0023" "$EXP" "$TMP/g4.out" "set local role service_role;"
ok=no; has "$TMP/g4.out" 'ZELL_0023_WRONG_CALLER' && [ "$(state)" = "$BEFORE_STATE" ] && ok=yes
record "G04 apply by another role -> ZELL_0023_WRONG_CALLER, nothing changed" "$ok" "$(tailof "$TMP/g4.out")"

# ---- 5ب) نداء zell_inv_* من دالة برّه المخزون (مراجعة #195 B2) ----
su_q "$DB" -c "create function public.ci_0023_calls_inv() returns boolean language plpgsql as \$g5\$ begin return public.zell_inv_product_stock_ref_exists(1); end \$g5\$" > "$TMP/g5c.log" 2>&1
run_with "$APPLY" "ci-0023" "$EXP" "$TMP/g5.out"
st=$(state)
su_q "$DB" -c "drop function public.ci_0023_calls_inv()" >> "$TMP/g5c.log" 2>&1
ok=no; has "$TMP/g5.out" 'ZELL_0023_SHAPE' && [ "$st" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "G05 a plpgsql function outside inventory calls zell_inv_* (no dependency recorded) -> ZELL_0023_SHAPE, nothing changed; then dropped" "$ok" "state=$st $(tailof "$TMP/g5c.log") $(tailof "$TMP/g5.out")"

# ---- 5ج) التزامن (مراجعة #195 B1): قفل الجداول العشرة قبل أول قراية بيانات ----
holder "CI supplier 0023 C01" 3 commit "$TMP/c1h.out" &
hp=$!
if wait_holder; then
  t0=$(now_ms); run_with "$APPLY" "ci-0023" "$EXP" "$TMP/c1.out"; t1=$(now_ms)
  wait "$hp"; hrc=$?
  st=$(state); fp=$(fp_out)
  kept=$(su_q "$DB" -c "select pg_catalog.count(*) from public.suppliers where name_key = 'ci supplier 0023 c01'")
  su_q "$DB" -c "set session_replication_role = replica" -c "delete from public.suppliers where name_key = 'ci supplier 0023 c01'" > "$TMP/c1c.log" 2>&1
  ok=no
  has "$TMP/c1.out" 'ZELL_0023_DATA_CHANGED' && has "$TMP/c1.out" ' suppliers=2 ' && [ "$hrc" -eq 0 ] && [ "$kept" = "1" ] && [ $((t1 - t0)) -ge 1500 ] \
    && [ "$st" = "$BEFORE_STATE" ] && [ "$fp" = "$FP0" ] && [ "$(data_line)" = "$EXP" ] && ok=yes
  record "C01 a supplier insert in flight commits while apply waits on the preflight lock ($((t1 - t0)) ms) -> ZELL_0023_DATA_CHANGED (suppliers=2); the supplier is kept, nothing changed" "$ok" "holder_rc=$hrc kept=$kept state=$st $(tailof "$TMP/c1.out") $(tailof "$TMP/c1h.out") $(tailof "$TMP/c1c.log")"
else
  wait "$hp"; record "C01 a supplier insert in flight" no "the second session never took its lock: $(tailof "$TMP/c1h.out")"
fi
holder "CI supplier 0023 C02" 8 rollback "$TMP/c2h.out" &
hp=$!
if wait_holder; then
  t0=$(now_ms); run_with "$APPLY" "ci-0023" "$EXP" "$TMP/c2.out"; t1=$(now_ms)
  st=$(state); fp=$(fp_out)
  wait "$hp"; hrc=$?
  ok=no
  has "$TMP/c2.out" '55P03' && has "$TMP/c2.out" 'lock timeout' && has "$TMP/c2.out" 'lock table public.inventory_locations' && ! grep -q 'ZELL_0023_' "$TMP/c2.out" \
    && [ $((t1 - t0)) -ge 4500 ] && [ "$hrc" -eq 0 ] && [ "$st" = "$BEFORE_STATE" ] && [ "$fp" = "$FP0" ] && [ "$(data_line)" = "$EXP" ] && ok=yes
  record "C02 a writer holds suppliers longer than lock_timeout -> apply stops on the preflight lock after $((t1 - t0)) ms (55P03), nothing changed, the writer's row rolled back" "$ok" "holder_rc=$hrc state=$st $(tailof "$TMP/c2.out") $(tailof "$TMP/c2h.out")"
else
  wait "$hp"; record "C02 a writer holds suppliers longer than lock_timeout" no "the second session never took its lock: $(tailof "$TMP/c2h.out")"
fi

# ---- 6) المعاملة بترجع كلها: نفس الملف بخطأ مقصود بعد آخر خطوة وقبل commit ----
sed "s/^commit;\$/do \$z23\$ begin raise exception 'ZELL_CI_ABORT_AFTER_BODY'; end \$z23\$;\ncommit;/" "$APPLY" > "$TMP/abort.sql"
run_with "$TMP/abort.sql" "ci-0023" "$EXP" "$TMP/z1.out"
ok=no; has "$TMP/z1.out" 'ZELL_CI_ABORT_AFTER_BODY' && ! grep -q 'ZELL_0023_' "$TMP/z1.out" && [ "$(state)" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "Z01 body runs to the end, then a forced error rolls everything back (state + outside fingerprint = before)" "$ok" "state=$(state) $(tailof "$TMP/z1.out")"

# ---- 7) ptest قبل التطبيق ----
run_with "$PTEST" "" "$EXP" "$TMP/ptest.out"
ok=no; [ "$(summary_of "$TMP/ptest.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "T01 ptest -> PASS (5 pass, 0 fail)" "$ok" "$(summary_of "$TMP/ptest.out") $(fails_of "$TMP/ptest.out") $(tailof "$TMP/ptest.out")"
ok=no; [ "$(state)" = "$BEFORE_STATE" ] && [ "$(fp_out)" = "$FP0" ] && ok=yes
record "T02 ptest leaves nothing (state + outside fingerprint = before)" "$ok" "state=$(state)"

# ---- 8) التطبيق ----
run_with "$APPLY" "ci-0023" "$EXP" "$TMP/apply.out"
ok=no; ! grep -q 'ERROR' "$TMP/apply.out" && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "A01 apply -> commit; inventory gone and product delete replaced ($AFTER_STATE)" "$ok" "state=$(state) $(tailof "$TMP/apply.out")"
run_file "$VERIFY" "$TMP/v23.out"
ok=no; [ "$(summary_of "$TMP/v23.out" | cut -d'|' -f7)" = "PASS" ] && ok=yes
record "A02 verify 0023 -> PASS (4 checks)" "$ok" "$(summary_of "$TMP/v23.out") $(fails_of "$TMP/v23.out")"
ok=no; [ "$(fp_out)" = "$FP0" ] && ok=yes
record "A03 everything outside inventory unchanged (independent fingerprint: functions · tables · roles · constraints · rows)" "$ok" "before=$FP0 after=$(fp_out)"
PA1=$(owner_call "select public.zell_product_delete_preview($P_PLAIN)::text")
PA2=$(owner_call "select public.zell_product_delete_preview($P_HOME)::text")
DA1=$(owner_call "select public.zell_product_delete($P_PLAIN, '$upd_plain'::timestamptz)::text")
DA2=$(owner_call "select public.zell_product_delete($P_HOME, '$upd_home'::timestamptz)::text")
ok=no; [ "$PA1" = "$PV1" ] && [ "$PA2" = "$PV2" ] && [ "$DA1" = "$DL1" ] && [ "$DA2" = "$DL2" ] && ok=yes
record "A04 product delete preview + delete responses after 0023 = before, byte for byte (has_stock false, same keys)" "$ok" "pv1=$PA1 pv2=$PA2 dl1=$DA1 dl2=$DA2"
run_file "$V22" "$TMP/v22_after.out"
# verify 0022 تاريخي ومابيتعدّلش (قرار المراجعة): بعد 0023 بيقف عند أول إشارة للدور اللي اتشال، ومن غير أي صف ملخص.
# خصائص دالتين الحذف بعد 0023 بيغطيها V02 في verify 0023 (المالك · security definer · config · EXECUTE · البصمة).
ok=no; has "$TMP/v22_after.out" 'role "zell_inventory_definer" does not exist' && [ -z "$(summary_of "$TMP/v22_after.out")" ] && ok=yes
record "A05 verify 0022 after 0023 stops on the removed role zell_inventory_definer (historical file, not edited); delete functions covered by 0023 V02" "$ok" "$(tailof "$TMP/v22_after.out")"

# ---- 8ب) بعد 0023: الـ 9 verify الموجودة (نفس المتجه) وعقد استدعاء التطبيقات (مراجعة #195 B3) ----
verifies after
diffs=""
for item in $VLIST; do tag=${item%%:*}; cmp -s "$TMP/vec_before_$tag" "$TMP/vec_after_$tag" || diffs="$diffs $tag"; done
ok=no; verifies_pass after && [ -z "$diffs" ] && ok=yes
record "E02 the same 9 verifies after 0023 = PASS, and every check_id=ok vector = before" "$ok" "vectors changed:${diffs:- none} $(verifies_detail after)"
# نفس حارس BASELINE K02 (call_contract.mjs) على الداتابيز بعد 0023: كل دالة بتناديها التطبيقات موجودة بأسماء معاملاتها وصلاحياتها.
if node "$CIDIR/call_contract.mjs" --root "$ROOT" --policy "$CIDIR/call_contract_policy.json" --sql "$TMP/cc.sql" > "$TMP/cc_static.log" 2>&1; then
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f "$TMP/cc.sql" < /dev/null > "$TMP/cc_db.log" 2>&1; rc=$?
  fails=$(grep -c '^CALL FAIL ' "$TMP/cc_db.log" || true)
  passes=$(grep -c '^CALL PASS ' "$TMP/cc_db.log" || true)
  checks=$(grep -oE '"checks":[0-9]+' "$TMP/cc_static.log" | head -n 1 | cut -d: -f2)
  ok=no
  [ "$rc" -eq 0 ] && [ "$fails" = "0" ] && [ -n "$checks" ] && [ "$passes" = "$checks" ] && ! grep -qE '^(PENDING|STALE_PENDING) ' "$TMP/cc_static.log" && ok=yes
  record "K01 call contract of the apps on the database after 0023: $passes of ${checks:-?} checks, no CALL FAIL" "$ok" "rc=$rc fails=$fails $(grep '^CALL FAIL ' "$TMP/cc_db.log" | head -n 5 | tr '\n' ' ') $(tailof "$TMP/cc_db.log")"
else
  record "K01 call contract of the apps on the database after 0023 (static part failed)" no "$(tailof "$TMP/cc_static.log")"
fi

# ---- 9) الإعادة ----
run_with "$APPLY" "ci-0023" "$EXP" "$TMP/r1.out"
ok=no; has "$TMP/r1.out" 'ZELL_0023_ALREADY_APPLIED' && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "R01 apply twice -> ZELL_0023_ALREADY_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/r1.out")"

finish
