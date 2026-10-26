#!/usr/bin/env bash
# 0022 PRODUCT-DELETE — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بنفس القايمة الصريحة
# (backend/db/ci/build_from_scratch.list، و postgres مش superuser زي Production)، وبعدين 0022.
# بيغطي: شكل المعاملة · md5 الجسم · حراس الـ preflight (الموافقة · المتصل · الأكواد · منحة المخزون) · ptest قبل التطبيق ·
# التطبيق · رفض الإعادة · verify · الرجوع قبل أي حذف وإعادة التطبيق · السيناريوهات (0022_flows.sql: الهوية · كل كود رفض ·
# النجاح · الصور اليتيمة · قايمة الرئيسية · المعاينة · أقل صلاحيات) · التزامن بجلستين في الاتجاهين (مقاسات · إضافات ·
# مجموعات · صور · أول إدراج وتعديل لقايمة الرئيسية · حذفين · ترتيب · نسخة · انتهاء الانتظار) · رفض الرجوع بعد حذف.
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
APPLY="$MIG/0022_product_delete.sql"
PTEST="$MIG/0022_product_delete_ptest.sql"
VERIFY="$MIG/0022_product_delete_verify.sql"
ROLLBACK="$MIG/0022_product_delete_rollback.sql"
FLOWS="$CIDIR/0022_flows.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB=zell_ci_0022
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
OWNER_ID='00000000-0000-4000-8000-0000000000a1'
ADMIN_ID='00000000-0000-4000-8000-0000000000a2'
EXPECTED="S01 S02 S03 B01 X01 G01 G02 G03 G04 T01 A01 A02 A03 V01 R01 R02 A04 F00 C01 C02 C03 C04 C05 C06 C07 C08 C09 C10 C11 C12 C13 C14 C15 C16 C17 C18 C19 R03 V02"
APPLIED='1|4|1|17|1|1'
CLEAN='0|0|0|0|0|0'

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
  echo "ZELL_0022_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
run_sql() { printf '%s' "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "${4:-postgres}" -d "$DB" -f - > "$3" 2>&1; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
state() {
  q "select (pg_catalog.to_regrole('zell_catalog_definer') is not null)::int
     || '|' || (select pg_catalog.count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
                  and p.proname in ('zell_product_delete', 'zell_product_delete_preview', 'zell_catalog_trg_home_products_guard',
                                    'zell_inv_product_stock_ref_exists'))
     || '|' || (select pg_catalog.count(*) from pg_catalog.pg_trigger t where t.tgname = 'zell_catalog_home_products_guard')
     || '|' || (select pg_catalog.count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\_catalog\_definer\_%')
     || '|' || pg_catalog.has_function_privilege('zell_inventory_definer', 'public.zell_inv_product_has_stock_refs(integer)', 'EXECUTE')::int
     || '|' || (select (pg_catalog.pg_get_constraintdef(c.oid) like '%product_deleted%')::int from pg_catalog.pg_constraint c
                 where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')"
}
verify_ok() { run_file "$VERIFY" "$TMP/v.out"; [ "$(summary_of "$TMP/v.out" | cut -d'|' -f7)" = "PASS" ]; }

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify / flows = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0022 BODY"); m_ptest=$(body_md5 "$PTEST" "0022 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -cx 'commit;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" | grep -q 'zell\.approved_by ='; then ok=yes; fi
record "S03 apply / rollback: one begin + one commit (last), no approval line inside the file" "$ok" ""

# ---- 2) بناء الداتابيز من القايمة الصريحة (زي build_from_scratch.sh) ----
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
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0022-build';/" "$f" > "$runf"
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && ok=yes
record "B01 database built from build_from_scratch.list ($n steps), postgres not superuser" "$ok" "steps=$n postgres=$shape"
[ "$ok" = yes ] || finish

# ---- 3) بيانات CI (committed): أدمن مش مالك · منتج عليه طلب · منتج عليه رصيد افتتاحي ----
q "insert into auth.users (id, email) values ('$ADMIN_ID', 'ci-admin-0022@example.invalid')" > "$TMP/x1.log"
q "insert into public.admin_users (user_id, role, is_active) values ('$ADMIN_ID', 'admin', true)" >> "$TMP/x1.log"
P_ORD=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-orders', 1000, false) returning id")
P_STK=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-stock', 1000, false) returning id")
# صفوف مباشرة من غير triggers (session_replication_role = replica بدور الـ CI superuser): القيود CHECK شغّالة.
su_q "$DB" -c "set session_replication_role = replica" \
  -c "insert into public.order_items (order_id, product_id, product_name_ar, unit_price_piastres, length_cm, width_cm, line_total_piastres) values (2147480000, $P_ORD, 'ci-0022-orders', 100, 300, 50, 300)" >> "$TMP/x1.log" 2>&1
su_q "$DB" -c "set session_replication_role = replica" \
  -c "with d as (insert into public.opening_stock_docs (doc_no, status, location_id, as_of_date, draft_payload, created_by, updated_by) select 'OPN-900001', 'draft', l.id, current_date, '{}'::jsonb, '$OWNER_ID', '$OWNER_ID' from public.inventory_locations l where l.code = 'MAIN' returning id) insert into public.opening_stock_lines (line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot, quantity, line_total_piastres, doc_id, cost_is_estimated) select 1, 'batch', $P_STK, 'ci-0022-stock', 'piece', 1, 100, d.id, false from d" >> "$TMP/x1.log" 2>&1
chk=$(q "select (select count(*) from public.admin_users where user_id = '$ADMIN_ID' and role = 'admin' and is_active)
         || '|' || (select count(*) from public.order_items where product_id = $P_ORD)
         || '|' || (select count(*) from public.opening_stock_lines where product_id = $P_STK)")
ok=no; [ "$chk" = "1|1|1" ] && ok=yes
record "X01 CI data: active admin ...a2, product $P_ORD in order_items, product $P_STK in opening_stock_lines" "$ok" "$chk $(tailof "$TMP/x1.log")"

# ---- 4) حراس الـ preflight (قبل التطبيق) ----
run_file "$APPLY" "$TMP/g1.out"
ok=no; has "$TMP/g1.out" 'ZELL_0022_APPROVAL_MISSING' && [ "$(state)" = "$CLEAN" ] && ok=yes
record "G01 apply without the approval line -> ZELL_0022_APPROVAL_MISSING, nothing created" "$ok" "$(state) $(tailof "$TMP/g1.out")"
run_approved "$APPLY" 'ci-0022' "$TMP/g2.out" "$SUPER"
ok=no; has "$TMP/g2.out" 'ZELL_0022_WRONG_CALLER' && [ "$(state)" = "$CLEAN" ] && ok=yes
record "G02 apply as another role (CI superuser) -> ZELL_0022_WRONG_CALLER, nothing created" "$ok" "$(state) $(tailof "$TMP/g2.out")"
q "create function public.zz_ci_0022_code() returns text language sql as 'select ''45503''::text'" > /dev/null
run_approved "$APPLY" 'ci-0022' "$TMP/g3.out"
ok=no; has "$TMP/g3.out" 'ZELL_0022_CODE_TAKEN' && [ "$(state)" = "$CLEAN" ] && ok=yes
q "drop function public.zz_ci_0022_code()" > /dev/null
record "G03 a code 45501..45508 already used by a function -> ZELL_0022_CODE_TAKEN" "$ok" "$(state) $(tailof "$TMP/g3.out")"
q "grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_inventory_definer" > /dev/null
run_approved "$APPLY" 'ci-0022' "$TMP/g4.out"
ok=no; has "$TMP/g4.out" 'ZELL_0022_PRE_INV_GRANT_EXISTS' && ok=yes
q "revoke execute on function public.zell_inv_product_has_stock_refs(integer) from zell_inventory_definer" > /dev/null
[ "$(state)" = "$CLEAN" ] || ok=no
record "G04 stock helper grant already present -> ZELL_0022_PRE_INV_GRANT_EXISTS" "$ok" "$(state) $(tailof "$TMP/g4.out")"

# ---- 5) ptest قبل التطبيق ----
run_file "$PTEST" "$TMP/pt.out"; rc=$?
s=$(summary_of "$TMP/pt.out")
ok=no; [ "$rc" -eq 0 ] && [ "$(printf '%s' "$s" | cut -d'|' -f9)" = "PASS" ] && [ "$(state)" = "$CLEAN" ] && ok=yes
record "T01 ptest before apply: PASS 6/0 and fully rolled back" "$ok" "$s $(fails_of "$TMP/pt.out") $(tailof "$TMP/pt.out")"

# ---- 6) التطبيق ----
run_approved "$APPLY" 'ci-0022' "$TMP/a1.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && [ "$(state)" = "$APPLIED" ] && ok=yes
record "A01 apply with the approval line" "$ok" "$(state) $(tailof "$TMP/a1.out")"
[ "$ok" = yes ] || finish
run_approved "$APPLY" 'ci-0022' "$TMP/a2.out"
ok=no; has "$TMP/a2.out" 'ZELL_0022_ALREADY_APPLIED' && [ "$(state)" = "$APPLIED" ] && ok=yes
record "A02 second apply -> ZELL_0022_ALREADY_APPLIED" "$ok" "$(tailof "$TMP/a2.out")"
run_file "$PTEST" "$TMP/a3.out"
ok=no; has "$TMP/a3.out" 'ZELL_0022_PTEST_PRE_APPLY_ONLY' && ok=yes
record "A03 ptest after apply -> ZELL_0022_PTEST_PRE_APPLY_ONLY" "$ok" "$(tailof "$TMP/a3.out")"
ok=no; verify_ok && ok=yes
record "V01 verify after apply: PASS 8" "$ok" "$(summary_of "$TMP/v.out") $(fails_of "$TMP/v.out") $(tailof "$TMP/v.out")"

# ---- 7) الرجوع قبل أي حذف، وإعادة التطبيق ----
run_file "$ROLLBACK" "$TMP/r1.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && [ "$(state)" = "$CLEAN" ] && [ "$(q "select count(*) from pg_catalog.pg_roles where rolname = 'zell_catalog_definer'")" = "0" ] && ok=yes
record "R01 rollback before any delete: everything removed (role, functions, trigger, policies, helper grant, reason)" "$ok" "$(state) $(tailof "$TMP/r1.out")"
run_file "$ROLLBACK" "$TMP/r2.out"
ok=no; has "$TMP/r2.out" 'ZELL_0022_RB_NOT_APPLIED' && ok=yes
record "R02 rollback when not applied -> ZELL_0022_RB_NOT_APPLIED" "$ok" "$(tailof "$TMP/r2.out")"
run_approved "$APPLY" 'ci-0022-again' "$TMP/a4.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && [ "$(state)" = "$APPLIED" ] && verify_ok && ok=yes
record "A04 re-apply after rollback + verify PASS" "$ok" "$(state) $(summary_of "$TMP/v.out") $(tailof "$TMP/a4.out")"

# ---- 8) السيناريوهات (معاملة بترجع) ----
run_file "$FLOWS" "$TMP/fl.out"; rc=$?
s=$(summary_of "$TMP/fl.out")
ok=no; [ "$rc" -eq 0 ] && [ "$(printf '%s' "$s" | cut -d'|' -f9)" = "PASS" ] && ok=yes
grep -E '^[0-9]+\|test\|' "$TMP/fl.out" | cut -d'|' -f3,5 | tr '\n' ' '; echo
record "F00 flows: PASS 18/0 (identity, every rejection code, success, orphans, home list guard, preview, least privilege)" "$ok" "$s $(fails_of "$TMP/fl.out") $(tailof "$TMP/fl.out")"

# ---- 9) التزامن بجلستين (committed) ----
ver() { q "select updated_at from public.products where id = $1"; }
exists_p() { q "select count(*) from public.products where id = $1"; }
mkp() {
  q "with p as (insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-c-$1', 1000, false) returning id),
          i as (insert into public.product_images (product_id, object_path)
                select p.id, 'products/' || p.id || '/c-' || g || '.jpg' from p, pg_catalog.generate_series(1, $2) g returning 1),
          w as (insert into public.product_widths (product_id, width_cm, price_per_meter_piastres) select p.id, 60, 1200 from p returning 1)
     select id from p"
}
mkvis() { q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-v-$1', 1000, true) returning id"; }
del_txt() {
  local slp=""
  [ -n "${3:-}" ] && slp="select pg_catalog.pg_sleep($3);"
  printf '%s\n' "set statement_timeout = '20s';" "begin;" \
    "select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$OWNER_ID\",\"role\":\"authenticated\"}', true);" \
    "set local role authenticated;" \
    "select public.zell_product_delete($1, '$2'::timestamptz)::text;" \
    "$slp" "commit;"
}
hold_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "$1;" "select pg_catalog.pg_sleep($2);" "commit;"; }
other_txt() { printf '%s\n' "set statement_timeout = '20s';" "$1;"; }
# الجلسة التانية ماسكة الأول ($1 لمدة $2 ثانية)، والحذف بعدها ($3 بالنسخة $4).
other_first() {
  run_sql "$(hold_txt "$1" "$2")" "$TMP/h.out" &
  local hp=$!
  sleep 0.6
  run_sql "$(del_txt "$3" "$4")" "$TMP/d.out"
  wait "$hp"
}
# الحذف ماسك الأول (ثانيتين قبل commit)، والجلسة التانية بعده ($3).
delete_first() {
  run_sql "$(del_txt "$1" "$2" 2)" "$TMP/d.out" &
  local dp=$!
  sleep 0.6
  run_sql "$(other_txt "$3")" "$TMP/o.out"
  wait "$dp"
}
deleted() { has "$TMP/d.out" '"deleted": true'; }
dd() { printf 'd=[%s] o=[%s] h=[%s]' "$(tailof "$TMP/d.out")" "$(tailof "$TMP/o.out" 2> /dev/null)" "$(tailof "$TMP/h.out" 2> /dev/null)"; }
: > "$TMP/o.out"; : > "$TMP/h.out"

COL=$(q "insert into public.collections (slug, title_ar) values ('ci-0022-conc', 'CI 0022') returning id")
AV=$(mkvis addon-owner)
X=$(mkvis home-x)

# مقاسات
P=$(mkp w1 1); V=$(ver "$P")
other_first "update public.product_widths set sort_order = sort_order where product_id = $P" 2 "$P" "$V"
ok=no
if has "$TMP/d.out" '45508' && [ "$(exists_p "$P")" = "1" ]; then
  run_sql "$(del_txt "$P" "$(ver "$P")")" "$TMP/d.out"; deleted && [ "$(exists_p "$P")" = "0" ] && ok=yes
fi
record "C01 widths row locked by another session -> 45508 at once (nothing changed); delete works after it commits" "$ok" "$(dd)"
P=$(mkp w2 1)
delete_first "$P" "$(ver "$P")" "insert into public.product_widths (product_id, width_cm, price_per_meter_piastres) values ($P, 70, 1300)"
ok=no; deleted && has "$TMP/o.out" '23503' && [ "$(q "select count(*) from public.product_widths where product_id = $P")" = "0" ] && ok=yes
record "C02 width added while the delete holds -> waits, then FK 23503; no orphan width" "$ok" "$(dd)"

# إضافات (المنتج مستخدم كإضافة لمنتج تاني)
P=$(mkp a1 0); q "insert into public.product_addons (product_id, addon_id) values ($AV, $P)" > /dev/null
other_first "update public.product_addons set sort_order = sort_order where addon_id = $P" 2 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && [ "$(exists_p "$P")" = "1" ] && [ "$(q "select count(*) from public.product_addons where addon_id = $P")" = "1" ] && ok=yes
record "C03 addon link locked by another session -> 45508 at once, nothing changed" "$ok" "$(dd)"
P=$(mkp a2 0)
delete_first "$P" "$(ver "$P")" "insert into public.product_addons (product_id, addon_id) values ($AV, $P)"
ok=no; deleted && has "$TMP/o.out" '23503' && [ "$(q "select count(*) from public.product_addons where addon_id = $P or product_id = $P")" = "0" ] && ok=yes
record "C04 addon link added while the delete holds -> FK 23503; no orphan link" "$ok" "$(dd)"

# مجموعات
P=$(mkp k1 0); q "insert into public.product_collections (collection_id, product_id) values ($COL, $P)" > /dev/null
other_first "update public.product_collections set sort_order = sort_order where product_id = $P" 2 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && [ "$(exists_p "$P")" = "1" ] && ok=yes
record "C05 collection link locked by another session -> 45508 at once, nothing changed" "$ok" "$(dd)"
P=$(mkp k2 0)
delete_first "$P" "$(ver "$P")" "insert into public.product_collections (collection_id, product_id) values ($COL, $P)"
ok=no; deleted && has "$TMP/o.out" '23503' && [ "$(q "select count(*) from public.product_collections where product_id = $P")" = "0" ] && ok=yes
record "C06 collection link added while the delete holds -> FK 23503; no orphan link" "$ok" "$(dd)"

# صور
P=$(mkp i1 2)
other_first "update public.product_images set sort_order = sort_order where product_id = $P" 2 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && [ "$(exists_p "$P")" = "1" ] \
  && [ "$(q "select count(*) from public.storage_orphans where object_path like 'products/$P/%'")" = "0" ] && ok=yes
record "C07 image row locked by another session -> 45508 at once; no orphan registered" "$ok" "$(dd)"
P=$(mkp i2 1)
delete_first "$P" "$(ver "$P")" "insert into public.product_images (product_id, object_path) values ($P, 'products/$P/late.jpg')"
ok=no; deleted && has "$TMP/o.out" '23503' \
  && [ "$(q "select count(*) from public.storage_orphans where object_path = 'products/$P/c-1.jpg' and reason = 'product_deleted'")" = "1" ] \
  && [ "$(q "select count(*) from public.storage_orphans where object_path = 'products/$P/late.jpg'")" = "0" ] && ok=yes
record "C08 image added while the delete holds -> FK 23503; the old image registered, the late one never existed" "$ok" "$(dd)"

# قايمة الرئيسية: أول إدراج (مفيش صف)
q "delete from public.settings where key = 'home_products'" > /dev/null
P=$(mkp h1 0)
other_first "insert into public.settings (key, value) values ('home_products', '{\"ids\": [$P]}')" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && has "$TMP/d.out" '"removed_from_home": true' && [ "$(q "select value -> 'ids' from public.settings where key = 'home_products'")" = "[]" ] && ok=yes
record "C09 first home_products insert holds the list lock -> delete waits, then removes the id" "$ok" "$(dd)"
q "delete from public.settings where key = 'home_products'" > /dev/null
P=$(mkp h2 0)
delete_first "$P" "$(ver "$P")" "insert into public.settings (key, value) values ('home_products', '{\"ids\": [$P]}')"
ok=no; deleted && has "$TMP/o.out" '45507' && [ "$(q "select count(*) from public.settings where key = 'home_products'")" = "0" ] && ok=yes
record "C10 first home_products insert while the delete holds -> waits, then 45507; no row with a missing id" "$ok" "$(dd)"

# قايمة الرئيسية: تعديل صف موجود
q "insert into public.settings (key, value) values ('home_products', '{\"ids\": [$X]}')" > /dev/null
P=$(mkp h3 0)
other_first "update public.settings set value = '{\"ids\": [$X, $P]}' where key = 'home_products'" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && has "$TMP/d.out" '"removed_from_home": true' && [ "$(q "select value -> 'ids' from public.settings where key = 'home_products'")" = "[$X]" ] && ok=yes
record "C11 home list update adding the id holds the lock -> delete waits, then removes it" "$ok" "$(dd)"
P=$(mkp h4 0)
delete_first "$P" "$(ver "$P")" "update public.settings set value = '{\"ids\": [$X, $P]}' where key = 'home_products'"
ok=no; deleted && has "$TMP/o.out" '45507' && [ "$(q "select value -> 'ids' from public.settings where key = 'home_products'")" = "[$X]" ] && ok=yes
record "C12 home list update adding the id while the delete holds -> waits, then 45507; list unchanged" "$ok" "$(dd)"

# حذفين
P=$(mkp t1 0); V=$(ver "$P")
run_sql "$(del_txt "$P" "$V" 1.5)" "$TMP/d.out" & dp=$!
sleep 0.6
run_sql "$(del_txt "$P" "$V")" "$TMP/o.out"
wait "$dp"
ok=no; deleted && has "$TMP/o.out" '45501' && ok=yes
record "C13 two deletes of the same product -> the second waits, then 45501" "$ok" "$(dd)"
P=$(mkp t2 0); P2=$(mkp t3 0)
run_sql "$(del_txt "$P" "$(ver "$P")" 1.5)" "$TMP/d.out" & dp=$!
sleep 0.6
run_sql "$(del_txt "$P2" "$(ver "$P2")")" "$TMP/o.out"
wait "$dp"
ok=no; deleted && has "$TMP/o.out" '"deleted": true' && [ "$(exists_p "$P")$(exists_p "$P2")" = "00" ] && ok=yes
record "C14 two deletes of different products -> serialized on the list lock, both succeed" "$ok" "$(dd)"

# ترتيب المنتجات
P=$(mkp r1 0)
other_first "update public.products set sort_order = sort_order + 1 where id = $P" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && ok=yes
record "C15 reorder holds the product row -> delete waits, then succeeds (version unchanged)" "$ok" "$(dd)"
P=$(mkp r2 0)
delete_first "$P" "$(ver "$P")" "update public.products set sort_order = 7 where id = $P returning id"
ok=no; deleted && ! has "$TMP/o.out" 'ERROR' && [ -z "$(tr -d '[:space:]' < "$TMP/o.out")" ] && ok=yes
record "C16 reorder while the delete holds -> waits, then updates 0 rows" "$ok" "$(dd)"

# النسخة اتغيّرت أثناء الانتظار · انتهاء الانتظار
P=$(mkp v1 0); V=$(ver "$P")
other_first "update public.products set updated_at = now() where id = $P" 1.5 "$P" "$V"
ok=no; has "$TMP/d.out" '45502' && [ "$(exists_p "$P")" = "1" ] && ok=yes
record "C17 product edited while the delete waits -> 45502, nothing deleted" "$ok" "$(dd)"
P=$(mkp l1 0)
other_first "select 1 from public.products where id = $P for update" 5 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && has "$TMP/d.out" 'DETAIL:  product' && [ "$(exists_p "$P")" = "1" ] && ok=yes
record "C18 product row held longer than lock_timeout (3s) -> 45508 (product), nothing deleted" "$ok" "$(dd)"
P=$(mkp l2 0)
other_first "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_catalog:home_products', 0))" 5 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && has "$TMP/d.out" 'DETAIL:  home_products_lock' && [ "$(exists_p "$P")" = "1" ] && ok=yes
record "C19 home list lock held longer than lock_timeout -> 45508 (home_products_lock), nothing deleted" "$ok" "$(dd)"

# ---- 10) الرجوع بعد حذف حقيقي: مرفوض ----
rows=$(q "select count(*) from public.storage_orphans where reason = 'product_deleted'")
run_file "$ROLLBACK" "$TMP/r3.out"
ok=no; [ "$rows" -gt 0 ] && has "$TMP/r3.out" 'ZELL_0022_RB_HAS_DELETES' && [ "$(state)" = "$APPLIED" ] && ok=yes
record "R03 rollback after a real delete ($rows product_deleted rows) -> ZELL_0022_RB_HAS_DELETES, nothing removed" "$ok" "$(state) $(tailof "$TMP/r3.out")"
ok=no; verify_ok && ok=yes
record "V02 verify after the concurrency runs: PASS 8" "$ok" "$(summary_of "$TMP/v.out") $(fails_of "$TMP/v.out")"

# معلومة (مش حالة): ملف تحقق 0020 بيفحص ACL الـ helper بالحرف، فبعد 0022 متوقع يقول ZELL_0020_FUNCTION_ACL عليه.
run_file "$MIG/0020_inventory_purchasing_verify.sql" "$TMP/i20.out"
echo "INFO 0020 verify after 0022: $(grep -oE 'ZELL_0020_[A-Z_]+[^\"]*' "$TMP/i20.out" | head -n 1 | cut -c1-200)$(summary_of "$TMP/i20.out" | cut -c1-200)"

finish
