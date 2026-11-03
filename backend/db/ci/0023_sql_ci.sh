#!/usr/bin/env bash
# 0023 INVENTORY-REMOVAL B — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة كلها
# (backend/db/ci/build_from_scratch.list، ومنها 0020 و0020-S و0022؛ postgres مش superuser زي Production)، وبعدين 0023 فوقها.
# بيغطي: شكل المعاملة · md5 الجسم · سطور الموافقة والأعداد برّه الملف · verify 0022 قبل (PASS) · حراس الـ preflight (موافقة · أعداد ·
# أعداد غلط · متصل غلط) والحالة مابتتغيّرش · رجوع المعاملة كلها لو حصل خطأ في آخرها · ptest قبل التطبيق ومابيسيبش أثر · التطبيق ·
# verify 0023 · ثبات كل حاجة برّه المخزون (بصمة + صفوف) · رد معاينة وحذف المنتج قبل = بعد بالحرف · verify 0022 بعد: الفاشل بس
# فحوص المخزون (تاريخية، مابتتعدّلش) · رفض الإعادة.
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
EXPECTED="S01 S02 S03 B01 B02 X01 P01 G01 G02 G03 G04 Z01 T01 T02 A01 A02 A03 A04 A05 R01"
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
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$st" = "$BEFORE_STATE" ] && ok=yes
record "B01 database built from the whole build_from_scratch.list ($n steps), postgres not superuser, inventory + 0022 present ($BEFORE_STATE)" "$ok" "steps=$n postgres=$shape state=$st"
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
failed=$(grep -E '^[0-9]+\|check\|[^|]*\|[^|]*\|f\|' "$TMP/v22_after.out" | cut -d'|' -f3,4)
ok=yes
if [ -z "$failed" ]; then ok=no; fi
while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | grep -qiE 'inv|stock' || ok=no
done <<< "$failed"
record "A05 verify 0022 after 0023: only its inventory checks fail (historical, not edited): $(printf '%s' "$failed" | tr '\n' ';' | cut -c1-500)" "$ok" "$(summary_of "$TMP/v22_after.out") $(tailof "$TMP/v22_after.out")"

# ---- 9) الإعادة ----
run_with "$APPLY" "ci-0023" "$EXP" "$TMP/r1.out"
ok=no; has "$TMP/r1.out" 'ZELL_0023_ALREADY_APPLIED' && [ "$(state)" = "$AFTER_STATE" ] && ok=yes
record "R01 apply twice -> ZELL_0023_ALREADY_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/r1.out")"

finish
