#!/usr/bin/env bash
# 0022 PRODUCT-DELETE — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بنفس القايمة الصريحة
# (backend/db/ci/build_from_scratch.list، و postgres مش superuser زي Production)، وبعدين 0022 فوقها. ده البناء الكامل + 0022
# لحد ما 0022 تتضاف للقايمة بعد التطبيق على Production (العقد §٧-أ).
# بيغطي: شكل المعاملة · md5 الجسم · مفتاح القفل مش مستخدم برّه 0022 · حراس الـ preflight · تحقق 0020 قبل وبعد (إلزامي) ·
# ptest · التطبيق · رفض الإعادة · verify بالحرف (ومحاولات توسيع منحة أو policy) · الرجوع قبل أي حذف لنفس حالة الـ catalog
# بالظبط · السيناريوهات (0022_flows.sql) · التزامن بجلستين في الاتجاهين بالدوال الفعلية (عروض · إضافات · أقسام · ترتيب) وبالـ
# DML المباشر وقايمة الرئيسية · مفيش 40P01 · انتظار القفل محدود · رفض الرجوع بعد حذف.
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
V0020="$MIG/0020_inventory_purchasing_verify.sql"
V0020R="$MIG/0020_inventory_purchasing_verify_rows.sql"
FLOWS="$CIDIR/0022_flows.sql"
IMPACT="$MIG/0022_product_delete_impact.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="${CI_SUPERUSER:-supabase_admin}"
DB=zell_ci_0022
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
MAXD=0
OWNER_ID='00000000-0000-4000-8000-0000000000a1'
ADMIN_ID='00000000-0000-4000-8000-0000000000a2'
OFF_ID='00000000-0000-4000-8000-0000000000a3'
USER_ID='00000000-0000-4000-8000-0000000000a4'
EXPECTED="S01 S02 S03 S04 S05 B01 X01 IMP0 IMP1 IMP2 I01 W01 G01 G02 G03 G04 T01 A01 IMP3 A02 A03 V01 N01 N02 N03 N04 N05 I02 W02 I03 W03 I04 I05 I06 I07 I08 R01 IMP4 R02 A04 IMP5 F00
C01 C02 C03 C04 C05 C06 C07 C08 C09 C10 C11 C12 C13 C14 C15 C16 C17 C18 C19 P01 P02 P03 P04 P05 P06 P07 P08 H01 H02 H03 H04 Z01 Z02 R03 V02 K22"
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
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
run_sql() { printf '%s' "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
now_ms() { date +%s%3N; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "${4:-postgres}" -d "$DB" -f - > "$3" 2>&1; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
failed_ids() { grep -E '^[0-9]+\|check\|[^|]*\|[^|]*\|f\|' "$1" | cut -d'|' -f3 | tr '\n' ' '; }
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
# بصمة الـ catalog: ACLs الجداول والأعمدة والـ schema وكل دوال public، والـ policies، والقيود، والـ triggers، والأدوار والعضويات.
cat_fp() {
  q "select pg_catalog.md5(pg_catalog.concat_ws('|',
     (select string_agg(c.relname || '=' || coalesce(c.relacl::text, '-'), ',' order by c.relname) from pg_catalog.pg_class c
       where c.relnamespace = 'public'::regnamespace),
     (select string_agg(c.relname || '.' || a.attname || '=' || a.attacl::text, ',' order by c.relname, a.attname)
        from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and a.attacl is not null and pg_catalog.cardinality(a.attacl) > 0),
     (select n.nspacl::text from pg_catalog.pg_namespace n where n.nspname = 'public'),
     (select string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '-') || '=' || pg_catalog.md5(p.prosrc), ','
                        order by p.oid::regprocedure::text) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace),
     (select string_agg(c.relname || '/' || p.polname || '/' || p.polcmd::text || '/' || pg_catalog.array_to_string(p.polroles, '+') || '/'
                        || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '-') || '/'
                        || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '-'), ',' order by c.relname, p.polname)
        from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid),
     (select string_agg(c.conrelid::regclass::text || '/' || c.conname || '/' || pg_catalog.pg_get_constraintdef(c.oid), ','
                        order by c.conrelid::regclass::text, c.conname) from pg_catalog.pg_constraint c
       where c.connamespace = 'public'::regnamespace),
     (select string_agg(t.tgrelid::regclass::text || '/' || t.tgname || '/' || t.tgenabled::text, ',' order by t.tgrelid::regclass::text, t.tgname)
        from pg_catalog.pg_trigger t where not t.tgisinternal),
     (select string_agg(r.rolname, ',' order by r.rolname) from pg_catalog.pg_roles r),
     (select string_agg(m.roleid::regrole::text || '>' || m.member::regrole::text || '/' || m.set_option::text || m.inherit_option::text || m.admin_option::text,
                        ',' order by m.roleid::regrole::text, m.member::regrole::text) from pg_catalog.pg_auth_members m)))"
}
verify_ok() { run_file "$VERIFY" "$TMP/v.out"; [ "$(summary_of "$TMP/v.out" | cut -d'|' -f7)" = "PASS" ]; }
v20() { run_file "$V0020" "$TMP/i20.out"; }
v20_line() { grep -oE 'ZELL_0020_[A-Z0-9_]+[^"]{0,160}' "$TMP/i20.out" | head -n 1; }

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" "$IMPACT" "$V0020R" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify / flows / impact / 0020 rows = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0022 BODY"); m_ptest=$(body_md5 "$PTEST" "0022 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -cx 'commit;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" | grep -q 'zell\.approved_by ='; then ok=yes; fi
record "S03 apply / rollback: one begin + one commit (last), no approval line inside the file" "$ok" ""
found=$(cd "$ROOT" && grep -rlF --exclude-dir=.git --exclude-dir=node_modules 'zell_catalog:home_products' . | sed 's|^\./||' | sort | tr '\n' ' ')
ok=yes
for f in $found; do
  case "$f" in
    backend/db/migrations/0022_product_delete.sql|backend/db/migrations/0022_product_delete_ptest.sql|backend/db/ci/0022_sql_ci.sh|docs/contracts/PRODUCT-DELETE.md) ;;
    *) ok=no ;;
  esac
done
case " $found " in *" backend/db/migrations/0022_product_delete.sql "*) ;; *) ok=no ;; esac
record "S04 advisory key text zell_catalog:home_products used only by 0022 (contract §5-a)" "$ok" "$found"
blk() { awk -v s="do \$$2\$" -v e="\$$2\$;" '$0 == s {f = 1} f {print} f && $0 == e {exit}' "$1"; }
ok=yes; bmd=""
for tg in zverify_a zverify_b zverify_end; do
  a=$(blk "$V0020" "$tg" | md5sum | cut -d' ' -f1); b=$(blk "$V0020R" "$tg" | md5sum | cut -d' ' -f1)
  [ "$a" = "$b" ] && [ "$a" != "$EMPTY_MD5" ] || ok=no
  bmd="$bmd $tg=$a/$b"
done
record "S05 0020 rows wrapper: the 3 blocks (zverify_a · zverify_b · zverify_end) = the original verify byte for byte" "$ok" "$bmd"

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

# ---- 3) بيانات CI (committed) ----
q "insert into auth.users (id, email) values ('$ADMIN_ID', 'ci-admin-0022@example.invalid'), ('$OFF_ID', 'ci-off-0022@example.invalid'), ('$USER_ID', 'ci-user-0022@example.invalid')" > "$TMP/x1.log"
q "insert into public.admin_users (user_id, role, is_active) values ('$ADMIN_ID', 'admin', true), ('$OFF_ID', 'admin', false)" >> "$TMP/x1.log"
P_ORD=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-orders', 1000, false) returning id")
P_STK=$(q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-stock', 1000, false) returning id")
# صفوف مباشرة من غير triggers (session_replication_role = replica بدور الـ CI superuser): القيود CHECK شغّالة.
su_q "$DB" -c "set session_replication_role = replica" \
  -c "insert into public.order_items (order_id, product_id, product_name_ar, unit_price_piastres, length_cm, width_cm, line_total_piastres) values (2147480000, $P_ORD, 'ci-0022-orders', 100, 300, 50, 300)" >> "$TMP/x1.log" 2>&1
su_q "$DB" -c "set session_replication_role = replica" \
  -c "with d as (insert into public.opening_stock_docs (doc_no, status, location_id, as_of_date, draft_payload, created_by, updated_by) select 'OPN-900001', 'draft', l.id, current_date, '{}'::jsonb, '$OWNER_ID', '$OWNER_ID' from public.inventory_locations l where l.code = 'MAIN' returning id) insert into public.opening_stock_lines (line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot, quantity, line_total_piastres, doc_id, cost_is_estimated) select 1, 'batch', $P_STK, 'ci-0022-stock', 'piece', 1, 100, d.id, false from d" >> "$TMP/x1.log" 2>&1
chk=$(q "select (select count(*) from public.admin_users where user_id in ('$ADMIN_ID', '$OFF_ID'))
         || '|' || (select count(*) from auth.users where id = '$USER_ID')
         || '|' || (select count(*) from public.order_items where product_id = $P_ORD)
         || '|' || (select count(*) from public.opening_stock_lines where product_id = $P_STK)")
ok=no; [ "$chk" = "2|1|1|1" ] && ok=yes
record "X01 CI data: admin ...a2, inactive admin ...a3, plain user ...a4, product $P_ORD in order_items, product $P_STK in opening_stock_lines" "$ok" "$chk $(tailof "$TMP/x1.log")"

# ---- 3b) استعلام الأثر (0022_product_delete_impact.sql) — نفس الملف بالحرف قبل التطبيق وبعده ----
# حالة CI قبل التطبيق شبه Production: صف home_products فيه id قديم لمنتج مش موجود، وصورة مستنية تنظيف، ورابط إضافة، ورابط قسم.
SEED1=$(q "select min(id) from public.products where name_ar not like 'ci-0022-%'")
SEED2=$(q "select max(id) from public.products where name_ar not like 'ci-0022-%'")
PRECOL=$(q "insert into public.collections (slug, title_ar) values ('ci-0022-pre', 'CI 0022 pre') returning id")
q "insert into public.settings (key, value) values ('home_products', '{\"mode\": \"selected\", \"ids\": [$SEED1, $SEED2, 999999], \"allLabel\": \"\"}')
   on conflict (key) do update set value = excluded.value" > "$TMP/pre.log"
q "insert into public.storage_orphans (object_path, reason) values ('products/ci-pre/old.jpg', 'replaced')" >> "$TMP/pre.log"
q "insert into public.product_addons (product_id, addon_id) values ($SEED1, $SEED2)" >> "$TMP/pre.log"
q "insert into public.product_collections (collection_id, product_id) values ($PRECOL, $SEED1)" >> "$TMP/pre.log"
q "insert into public.product_images (product_id, object_path) values ($SEED1, 'products/ci-pre/a.jpg')" >> "$TMP/pre.log"
q "insert into public.product_widths (product_id, width_cm, price_per_meter_piastres) values ($SEED1, 77, 1000)" >> "$TMP/pre.log"
OLD_ORPH="CHECK ((reason = ANY (ARRAY['insert_failed'::text, 'delete_failed'::text, 'replaced'::text, 'removed'::text])))"
NEW_ORPH="CHECK ((reason = ANY (ARRAY['insert_failed'::text, 'delete_failed'::text, 'replaced'::text, 'removed'::text, 'product_deleted'::text])))"
DATA_COLS="10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31"
imp() { run_file "$IMPACT" "$TMP/imp_$1.out"; IMP_RC=$?; grep -v '^[[:space:]]*$' "$TMP/imp_$1.out" | tail -n 1 > "$TMP/imp_$1.row"; }
icol() { cut -d'|' -f"$2" "$TMP/imp_$1.row"; }
inf() { awk -F'|' '{print NF}' "$TMP/imp_$1.row"; }
# أول عمود مختلف بين نتيجتين (من القايمة $3)، وفاضي لو كله زي بعضه.
idiff() { local f; for f in $3; do [ "$(icol "$1" "$f")" = "$(icol "$2" "$f")" ] || { printf '%s' "$f"; return; }; done; }
ishow() { cut -d'|' -f2-14,16,18,20,22,26-28,30-34 "$TMP/imp_$1.row"; }

imp pre
ok=no
[ "$IMP_RC" -eq 0 ] && [ "$(inf pre)" = "34" ] && icol pre 1 | grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' \
  && [ "$(icol pre 2)|$(icol pre 3)|$(icol pre 4)|$(icol pre 5)|$(icol pre 6)|$(icol pre 8)" = "0|0|0|0|f|0" ] \
  && [ "$(icol pre 7)" = "$OLD_ORPH" ] && [ "$(icol pre 26)" = "1" ] && [ "$(icol pre 32)|$(icol pre 33)" = "0|0" ] && ok=yes
echo "IMPACT pre: $(ishow pre)"
record "IMP0 impact query before apply: 34 columns, UTC time, 0022 objects absent, old reasons, 1 stale home id, idle_tx 0, stop_locks 0" "$ok" "rc=$IMP_RC nf=$(inf pre) $(tailof "$TMP/imp_pre.out")"

# تغيير محتوى بنفس العدد في كل جدول لازم يظهر في بصمته بس (العدد زي ما هو)، والرجوع يرجّع الـ baseline بالظبط.
ok=yes; miss=""
while IFS='~' read -r label change revert fpc cntc; do
  q "$change" > /dev/null; imp chg; q "$revert" > /dev/null
  d=$(idiff pre chg "$DATA_COLS")
  if [ "$d" != "$fpc" ] || { [ -n "$cntc" ] && [ "$(icol pre "$cntc")" != "$(icol chg "$cntc")" ]; }; then ok=no; miss="$miss [$label: first diff=$d]"; fi
done <<EOF
products name~update public.products set name_ar = name_ar || '+' where id = $SEED2~update public.products set name_ar = left(name_ar, -1) where id = $SEED2~15~12
image alt text~update public.product_images set alt_text = 'ci' where object_path = 'products/ci-pre/a.jpg'~update public.product_images set alt_text = null where object_path = 'products/ci-pre/a.jpg'~17~16
width price~update public.product_widths set price_per_meter_piastres = price_per_meter_piastres + 1 where product_id = $SEED1 and width_cm = 77~update public.product_widths set price_per_meter_piastres = price_per_meter_piastres - 1 where product_id = $SEED1 and width_cm = 77~19~18
addon order~update public.product_addons set sort_order = sort_order + 1 where product_id = $SEED1 and addon_id = $SEED2~update public.product_addons set sort_order = sort_order - 1 where product_id = $SEED1 and addon_id = $SEED2~21~20
collection order~update public.product_collections set sort_order = sort_order + 1 where collection_id = $PRECOL~update public.product_collections set sort_order = sort_order - 1 where collection_id = $PRECOL~23~22
settings value~update public.settings set value = pg_catalog.jsonb_set(value, '{allLabel}', '"ci"') where key = 'home_products'~update public.settings set value = pg_catalog.jsonb_set(value, '{allLabel}', '""') where key = 'home_products'~24~
orphan row content~update public.storage_orphans set created_at = created_at + interval '1 second' where object_path = 'products/ci-pre/old.jpg'~update public.storage_orphans set created_at = created_at - interval '1 second' where object_path = 'products/ci-pre/old.jpg'~29~28
EOF
imp pre2
d=$(idiff pre pre2 "$DATA_COLS")
[ -z "$d" ] || { ok=no; miss="$miss [after the reverts column $d differs from the baseline]"; }
record "IMP1 same-count content change in products / images / widths / addon links / collection links / settings / orphans changes that fingerprint (count unchanged); reverts give the baseline back" "$ok" "$miss"

# الأقفال والمعاملات: القاعدة الحالية بس، والوقف بس للأقفال اللي بتعطّل التطبيق.
ok=yes; why=""
run_sql "select pg_catalog.pg_sleep(4) from public.products limit 1;" "$TMP/l1.out" & lp=$!; sleep 1; imp lk1; wait "$lp"
[ "$(icol lk1 34)" -ge 1 ] && [ "$(icol lk1 33)" = "0" ] && [ "$(icol lk1 32)" = "0" ] || { ok=no; why="$why [active read: $(icol lk1 32)|$(icol lk1 33)|$(icol lk1 34)]"; }
run_sql "$(printf '%s\n' 'begin;' 'lock table public.storage_orphans in share row exclusive mode;' 'select pg_catalog.pg_sleep(4);' 'commit;')" "$TMP/l2.out" & lp=$!; sleep 1; imp lk2; wait "$lp"
[ "$(icol lk2 33)" -ge 1 ] && [ "$(icol lk2 32)" = "0" ] || { ok=no; why="$why [strong lock: $(icol lk2 32)|$(icol lk2 33)|$(icol lk2 34)]"; }
run_sql "$(printf '%s\n' 'begin;' 'select count(*) from public.settings;' '\! sleep 4' 'commit;')" "$TMP/l3.out" & lp=$!; sleep 1.5; imp lk3; wait "$lp"
[ "$(icol lk3 32)" -ge 1 ] && [ "$(icol lk3 33)" -ge 1 ] || { ok=no; why="$why [idle in transaction: $(icol lk3 32)|$(icol lk3 33)|$(icol lk3 34)]"; }
printf '%s\n' 'begin;' 'select 1;' '\! sleep 4' 'commit;' | psql -X -q -tA -U postgres -d postgres -f - > "$TMP/l4.out" 2>&1 & lp=$!; sleep 1.5; imp lk4; wait "$lp"
[ "$(icol lk4 32)" = "0" ] && [ "$(icol lk4 33)" = "0" ] || { ok=no; why="$why [other database: $(icol lk4 32)|$(icol lk4 33)]"; }
record "IMP2 locks / idle: active read = info only · ShareRowExclusive = stop · idle in transaction = stop (idle_tx + its lock) · other database ignored" "$ok" "$why"

# ---- 4) تحقق 0020 قبل 0022 (إلزامي) ----
v20
ok=no; has "$TMP/i20.out" 'ZELL_0020_VERIFY_RESULT part_a=ok' && ! has "$TMP/i20.out" '0022=applied' && ok=yes
record "I01 0020 verify before 0022: part_a=ok, no 0022 marker" "$ok" "$(v20_line)"
# الرسالة اللي الأصلي رماها (P0001 أو غيره) بالحرف، والصف بتاع نسخة الصفوف.
v20_raw() { sed -n 's/.*ERROR:  [0-9A-Z]\{5\}: //p' "$TMP/i20.out" | head -n 1; }
v20r() { run_file "$V0020R" "$TMP/i20r.out"; V20R_RC=$?; grep '^0|summary|' "$TMP/i20r.out" | head -n 1 > "$TMP/i20r.row"; }
w_check() { # $1 id+name, $2 expected verdict, $3 required marker text or message prefix
  local orig row verdict state msg markers ok=no
  v20; orig=$(v20_raw); v20r; row=$(cat "$TMP/i20r.row")
  verdict=$(printf '%s' "$row" | cut -d'|' -f3); state=$(printf '%s' "$row" | cut -d'|' -f4)
  msg=$(printf '%s' "$row" | cut -d'|' -f5); markers=$(printf '%s' "$row" | cut -d'|' -f6)
  if [ "$V20R_RC" -eq 0 ] && [ "$verdict" = "$2" ] && [ -n "$msg" ] && [ "$msg" = "$orig" ]; then
    case "$2" in
      PASS) [ "$state" = "P0001" ] && [ "$markers" = "$3" ] && ok=yes ;;
      FAIL) case "$msg" in "$3"*) ok=yes ;; esac ;;
    esac
  fi
  record "$1" "$ok" "rc=$V20R_RC verdict=$verdict state=$state markers=[$markers] msg=[$msg] orig=[$orig]"
}
w_check "W01 0020 verify as rows before 0022: PASS, same message as the original, markers 0020s+pr3" PASS "0020s=applied pr3=applied"

# ---- 5) حراس الـ preflight (قبل التطبيق) ----
CF0=$(cat_fp)
fp_ok() { printf '%s' "$CF0" | grep -Eqx '[0-9a-f]{32}'; }
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
[ "$(state)" = "$CLEAN" ] && [ "$(cat_fp)" = "$CF0" ] && fp_ok || ok=no
record "G04 stock helper grant already present -> ZELL_0022_PRE_INV_GRANT_EXISTS (catalog back to the same state)" "$ok" "$(state) $(tailof "$TMP/g4.out")"

# ---- 6) ptest قبل التطبيق ----
run_file "$PTEST" "$TMP/pt.out"; rc=$?
s=$(summary_of "$TMP/pt.out")
ok=no; [ "$rc" -eq 0 ] && [ "$(printf '%s' "$s" | cut -d'|' -f9)" = "PASS" ] && [ "$(state)" = "$CLEAN" ] && [ "$(cat_fp)" = "$CF0" ] && fp_ok && ok=yes
record "T01 ptest before apply: PASS 6/0 and fully rolled back (same catalog fingerprint)" "$ok" "$s $(fails_of "$TMP/pt.out") $(tailof "$TMP/pt.out")"

# ---- 7) التطبيق ----
run_approved "$APPLY" 'ci-0022' "$TMP/a1.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && [ "$(state)" = "$APPLIED" ] && ok=yes
record "A01 apply with the approval line" "$ok" "$(state) $(tailof "$TMP/a1.out")"
[ "$ok" = yes ] || finish
imp post
ok=no
[ "$IMP_RC" -eq 0 ] && [ "$(inf post)" = "34" ] \
  && [ "$(icol post 2)|$(icol post 3)|$(icol post 4)|$(icol post 5)|$(icol post 6)|$(icol post 8)" = "1|4|17|1|t|3" ] \
  && [ "$(icol post 7)" = "$NEW_ORPH" ] && [ "$(icol post 9)" = "$(( $(icol pre 9) + 1 ))" ] \
  && [ -z "$(idiff pre post "$DATA_COLS")" ] && [ "$(icol post 32)|$(icol post 33)" = "0|0" ] && ok=yes
echo "IMPACT post: $(ishow post)"
record "IMP3 impact query right after apply: role 1 · functions 4 · policies 17 · trigger 1 · helper grant t · product_deleted · code users 3 · inv functions +1; columns 10-31 = baseline" "$ok" "first data diff=$(idiff pre post "$DATA_COLS") $(ishow post)"
run_approved "$APPLY" 'ci-0022' "$TMP/a2.out"
ok=no; has "$TMP/a2.out" 'ZELL_0022_ALREADY_APPLIED' && [ "$(state)" = "$APPLIED" ] && ok=yes
record "A02 second apply -> ZELL_0022_ALREADY_APPLIED" "$ok" "$(tailof "$TMP/a2.out")"
run_file "$PTEST" "$TMP/a3.out"
ok=no; has "$TMP/a3.out" 'ZELL_0022_PTEST_PRE_APPLY_ONLY' && ok=yes
record "A03 ptest after apply -> ZELL_0022_PTEST_PRE_APPLY_ONLY" "$ok" "$(tailof "$TMP/a3.out")"
ok=no; verify_ok && ok=yes
record "V01 verify after apply: PASS 10" "$ok" "$(summary_of "$TMP/v.out") $(fails_of "$TMP/v.out") $(tailof "$TMP/v.out")"

# ---- 8) verify بيكشف أي توسيع (كل حالة: FAIL في الفحص المقصود، وبعد الرجوع PASS) ----
neg() { # $1 id+name, $2 widen SQL, $3 restore SQL, $4 check id expected to fail
  q "$2" > "$TMP/neg.log"
  run_file "$VERIFY" "$TMP/vn.out"
  local s1 ids; s1=$(summary_of "$TMP/vn.out" | cut -d'|' -f7); ids=$(failed_ids "$TMP/vn.out")
  q "$3" >> "$TMP/neg.log"
  local ok=no
  [ "$s1" = "FAIL" ] && case " $ids " in *" $4 "*) true ;; *) false ;; esac && verify_ok && ok=yes
  record "$1" "$ok" "verdict=$s1 failed=[$ids] $(tailof "$TMP/neg.log")"
}
neg "N01 extra column grant (products.name_ar SELECT) -> V09 FAIL" \
  "grant select (name_ar) on public.products to zell_catalog_definer" \
  "revoke select (name_ar) on public.products from zell_catalog_definer" V09
neg "N02 extra policy for the role on another table (orders) -> V10 FAIL" \
  "create policy ci_0022_x on public.orders for select to zell_catalog_definer using (true)" \
  "drop policy ci_0022_x on public.orders" V10
neg "N03 widened USING on zell_catalog_definer_update (settings) -> V10 FAIL" \
  "alter policy zell_catalog_definer_update on public.settings using (true)" \
  "alter policy zell_catalog_definer_update on public.settings using (key = 'home_products')" V10
neg "N04 PUBLIC policy on one of the role's tables (products) -> V10 FAIL" \
  "create policy ci_0022_pub on public.products for select to public using (true)" \
  "drop policy ci_0022_pub on public.products" V10
neg "N05 extra EXECUTE on zell_product_delete (service_role) -> V03 FAIL" \
  "set role zell_catalog_definer; grant execute on function public.zell_product_delete(integer, timestamptz) to service_role; reset role" \
  "set role zell_catalog_definer; revoke execute on function public.zell_product_delete(integer, timestamptz) from service_role; reset role" V03

# ---- 9) تحقق 0020 بعد 0022 (إلزامي) ومحاولات الزيادة ----
v20
ok=no; has "$TMP/i20.out" 'ZELL_0020_VERIFY_RESULT part_a=ok' && has "$TMP/i20.out" '0022=applied' && ok=yes
record "I02 0020 verify after 0022: part_a=ok with the 0022 marker" "$ok" "$(v20_line)"
w_check "W02 0020 verify as rows after 0022: PASS, same message as the original, markers 0020s+pr3+0022" PASS "0020s=applied pr3=applied 0022=applied"
neg20() { # $1 id+name, $2 change SQL, $3 restore SQL, $4 expected error
  q "$2" > "$TMP/n20.log"
  v20
  local line; line=$(v20_line)
  q "$3" >> "$TMP/n20.log"
  local ok=no
  has "$TMP/i20.out" "$4" && ! has "$TMP/i20.out" 'part_a=ok' && ok=yes
  record "$1" "$ok" "$line $(tailof "$TMP/n20.log")"
}
q "set role zell_inventory_definer; grant execute on function public.zell_inv_product_stock_ref_exists(integer) to authenticated; reset role" > /dev/null
w_check "W03 0020 verify as rows with a real failure (extra grant): FAIL, the failure message shown unchanged (= original)" FAIL "ZELL_0020_0022_WRAPPER_SHAPE"
q "set role zell_inventory_definer; revoke execute on function public.zell_inv_product_stock_ref_exists(integer) from authenticated; reset role" > /dev/null
neg20 "I03 extra EXECUTE on the stock wrapper (authenticated) -> ZELL_0020_0022_WRAPPER_SHAPE" \
  "set role zell_inventory_definer; grant execute on function public.zell_inv_product_stock_ref_exists(integer) to authenticated; reset role" \
  "set role zell_inventory_definer; revoke execute on function public.zell_inv_product_stock_ref_exists(integer) from authenticated; reset role" \
  'ZELL_0020_0022_WRAPPER_SHAPE'
neg20 "I04 extra EXECUTE on the stock helper (zell_catalog_definer) -> ZELL_0020_FUNCTION_ACL" \
  "grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_catalog_definer" \
  "revoke execute on function public.zell_inv_product_has_stock_refs(integer) from zell_catalog_definer" \
  'ZELL_0020_FUNCTION_ACL'
neg20 "I05 unapproved function owned by zell_inventory_definer (not zell_inv_*) -> ZELL_0020_FUNCTION_FOREIGN" \
  "grant create on schema public to zell_inventory_definer; set role zell_inventory_definer; create function public.zz_ci_0022_inv() returns integer language sql as 'select 1'; reset role; revoke create on schema public from zell_inventory_definer" \
  "set role zell_inventory_definer; drop function public.zz_ci_0022_inv(); reset role" \
  'ZELL_0020_FUNCTION_FOREIGN'
neg20 "I06 unapproved zell_inv_* function -> ZELL_0020_FUNCTION_COUNT" \
  "create function public.zell_inv_zz_ci() returns integer language sql as 'select 1'" \
  "drop function public.zell_inv_zz_ci()" \
  'ZELL_0020_FUNCTION_COUNT'
neg20 "I07 mixed state: helper grant revoked while the wrapper exists -> ZELL_0020_FUNCTION_ACL" \
  "revoke execute on function public.zell_inv_product_has_stock_refs(integer) from zell_inventory_definer" \
  "grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_inventory_definer" \
  'ZELL_0020_FUNCTION_ACL'
v20
ok=no; has "$TMP/i20.out" 'ZELL_0020_VERIFY_RESULT part_a=ok' && has "$TMP/i20.out" '0022=applied' && verify_ok && ok=yes
record "I08 after every revert: 0020 verify part_a=ok (0022 marker) and 0022 verify PASS" "$ok" "$(v20_line) $(summary_of "$TMP/v.out")"

# ---- 10) الرجوع قبل أي حذف، وإعادة التطبيق ----
run_file "$ROLLBACK" "$TMP/r1.out"; rc=$?
v20
ok=no
[ "$rc" -eq 0 ] && [ "$(state)" = "$CLEAN" ] && [ "$(cat_fp)" = "$CF0" ] && fp_ok \
  && has "$TMP/i20.out" 'ZELL_0020_VERIFY_RESULT part_a=ok' && ! has "$TMP/i20.out" '0022=applied' && ok=yes
record "R01 rollback before any delete: catalog fingerprint = before apply (ACLs, functions, policies, constraints, triggers, roles); 0020 verify ok" "$ok" "$(state) $(v20_line) $(tailof "$TMP/r1.out")"
imp rb
ok=no; [ "$IMP_RC" -eq 0 ] && [ -z "$(idiff pre rb "2 3 4 5 6 7 8 9 $DATA_COLS")" ] && ok=yes
record "IMP4 impact query after rollback = the baseline exactly (columns 2-31)" "$ok" "first diff=$(idiff pre rb "2 3 4 5 6 7 8 9 $DATA_COLS")"
run_file "$ROLLBACK" "$TMP/r2.out"
ok=no; has "$TMP/r2.out" 'ZELL_0022_RB_NOT_APPLIED' && ok=yes
record "R02 rollback when not applied -> ZELL_0022_RB_NOT_APPLIED" "$ok" "$(tailof "$TMP/r2.out")"
run_approved "$APPLY" 'ci-0022-again' "$TMP/a4.out"; rc=$?
ok=no; [ "$rc" -eq 0 ] && [ "$(state)" = "$APPLIED" ] && verify_ok && ok=yes
record "A04 re-apply after rollback + verify PASS" "$ok" "$(state) $(summary_of "$TMP/v.out") $(tailof "$TMP/a4.out")"
imp again
ok=no; [ "$IMP_RC" -eq 0 ] && [ -z "$(idiff post again "2 3 4 5 6 7 8 9 $DATA_COLS")" ] && ok=yes
record "IMP5 impact query after re-apply = the after-apply result (columns 2-31)" "$ok" "first diff=$(idiff post again "2 3 4 5 6 7 8 9 $DATA_COLS")"

# ---- 10b) عقد استدعاء التطبيقات على البناء الكامل + 0022 (المرحلة B، العقد §٧-أ) ----
# نفس حارس BASELINE (call_contract.mjs) بـ --pending require: نداءات zell_product_delete* بتتفحص فعليًا (الوجود · أسماء المعاملات ·
# EXECUTE لـ authenticated · مفيش لـ anon و service_role)، زي ما هتتفحص في build_from_scratch بعد المرحلة C.
if node "$CIDIR/call_contract.mjs" --root "$ROOT" --policy "$CIDIR/call_contract_policy.json" --sql "$TMP/cc.sql" --pending require > "$TMP/cc_static.log" 2>&1; then
  psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f "$TMP/cc.sql" < /dev/null > "$TMP/cc_db.log" 2>&1; rc=$?
  fails=$(grep -c '^CALL FAIL ' "$TMP/cc_db.log" || true)
  passes=$(grep -c '^CALL PASS ' "$TMP/cc_db.log" || true)
  checks=$(grep -oE '"checks":[0-9]+' "$TMP/cc_static.log" | head -n 1 | cut -d: -f2)
  ok=no
  [ "$rc" -eq 0 ] && [ "$fails" = "0" ] && [ -n "$checks" ] && [ "$passes" = "$checks" ] && ! grep -q '^PENDING ' "$TMP/cc_static.log" \
    && grep -q '^CALL PASS .* zell_product_delete authenticated' "$TMP/cc_db.log" \
    && grep -q '^CALL PASS .* zell_product_delete_preview authenticated' "$TMP/cc_db.log" && ok=yes
  record "K22 call contract of the apps on the full build + 0022 (pending required): $passes of ${checks:-?} checks, delete + preview included" "$ok" "rc=$rc fails=$fails $(grep '^CALL FAIL ' "$TMP/cc_db.log" | head -n 5 | tr '\n' ' ') $(tailof "$TMP/cc_db.log")"
else
  record "K22 call contract of the apps on the full build + 0022 (static part failed)" no "$(tailof "$TMP/cc_static.log")"
fi

# ---- 11) السيناريوهات (معاملة بترجع) ----
run_file "$FLOWS" "$TMP/fl.out"; rc=$?
s=$(summary_of "$TMP/fl.out")
ok=no; [ "$rc" -eq 0 ] && [ "$(printf '%s' "$s" | cut -d'|' -f9)" = "PASS" ] && ok=yes
grep -E '^[0-9]+\|test\|' "$TMP/fl.out" | cut -d'|' -f3,5 | tr '\n' ' '; echo
record "F00 flows: PASS 25/0 (identity + forged actors, every code with full-content fingerprints, success, orphans, preview, least privilege, guard + save path, FK last guard, helper revoke)" "$ok" "$s $(fails_of "$TMP/fl.out") $(tailof "$TMP/fl.out")"

# ---- 12) التزامن بجلستين (committed) ----
ver() { q "select updated_at from public.products where id = $1"; }
exists_p() { q "select count(*) from public.products where id = $1"; }
om() { q "select coalesce(max(id), 0) from public.storage_orphans"; }
home_ids() { q "select value -> 'ids' from public.settings where key = 'home_products'"; }
set_home() { q "delete from public.settings where key = 'home_products'" > /dev/null; q "insert into public.settings (key, value) values ('home_products', '{\"ids\": [$1]}')" > /dev/null; }
mkp() {
  q "with p as (insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-c-$1', 1000, false) returning id),
          i as (insert into public.product_images (product_id, object_path)
                select p.id, 'products/' || p.id || '/c-' || g || '.jpg' from p, pg_catalog.generate_series(1, $2) g returning 1),
          w as (insert into public.product_widths (product_id, width_cm, price_per_meter_piastres) select p.id, 60, 1200 from p returning 1)
     select id from p"
}
mkvis() { q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0022-v-$1', 1000, true) returning id"; }
# بصمة محتوى باقي الداتابيز: من غير المنتجات $1 (csv) وتوابعها، ومن غير القسم $2 وروابطه، ومن غير home_products، وstorage_orphans لحد id $3.
# $4 = reorder: أعمدة sort_order و updated_at في products مش محسوبة (الترتيب بيغيّرهم لكل المنتجات).
fp_rest() {
  local ids="$1" col="$2" om="$3" prow="to_jsonb(t)"
  [ "${4:-}" = "reorder" ] && prow="(to_jsonb(t) - 'sort_order' - 'updated_at')"
  q "select md5(concat_ws('|',
       (select md5(coalesce(string_agg($prow::text, ',' order by $prow::text), '')) from public.products t where t.id not in ($ids)),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.product_images t where t.product_id not in ($ids)),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.product_widths t where t.product_id not in ($ids)),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.product_addons t where t.product_id not in ($ids) and t.addon_id not in ($ids)),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.product_collections t where t.product_id not in ($ids) and t.collection_id <> $col),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.collections t where t.id <> $col),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.orders t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.order_items t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.settings t where t.key <> 'home_products'),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.storage_orphans t where t.id <= $om),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.opening_stock_docs t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.opening_stock_lines t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.stock_lots t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.purchase_doc_lines t where true),
       (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from public.admin_users t where true)))"
}
del_txt() {
  local slp=""
  [ -n "${3:-}" ] && slp="select pg_catalog.pg_sleep($3);"
  printf '%s\n' "set statement_timeout = '20s';" "begin;" \
    "select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$OWNER_ID\",\"role\":\"authenticated\"}', true);" \
    "set local role authenticated;" \
    "select public.zell_product_delete($1, '$2'::timestamptz)::text;" \
    "$slp" "commit;"
}
role_line() { [ -n "${1:-}" ] && printf 'set local role %s;' "$1"; }
hold_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "$(role_line "${3:-}")" "$1;" "select pg_catalog.pg_sleep($2);" "commit;"; }
other_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "$(role_line "${2:-}")" "$1;" "commit;"; }
track() { local d=$(( $2 - $1 )); [ "$d" -gt "$MAXD" ] && MAXD=$d; LASTD=$d; }
LASTD=0
# الجلسة التانية ماسكة الأول ($1 لمدة $2 ثانية، بدور $5 لو موجود)، والحذف بعدها ($3 بالنسخة $4). مدة الحذف بتتسجّل.
other_first() {
  : > "$TMP/o.out"
  run_sql "$(hold_txt "$1" "$2" "${5:-}")" "$TMP/h.out" &
  local hp=$!
  sleep 0.6
  local t0; t0=$(now_ms)
  run_sql "$(del_txt "$3" "$4")" "$TMP/d.out"
  track "$t0" "$(now_ms)"
  wait "$hp"
}
# الحذف ماسك الأول (ثانيتين قبل commit)، والجلسة التانية بعده ($3، بدور $4 لو موجود).
delete_first() {
  : > "$TMP/h.out"
  run_sql "$(del_txt "$1" "$2" 2)" "$TMP/d.out" &
  local dp=$!
  sleep 0.6
  run_sql "$(other_txt "$3" "${4:-}")" "$TMP/o.out"
  wait "$dp"
}
deleted() { has "$TMP/d.out" '"deleted": true'; }
dd() {
  cat "$TMP/d.out" "$TMP/o.out" "$TMP/h.out" >> "$TMP/all_sessions.log" 2> /dev/null
  printf 'wait=%sms d=[%s] o=[%s] h=[%s]' "$LASTD" "$(tailof "$TMP/d.out")" "$(tailof "$TMP/o.out")" "$(tailof "$TMP/h.out")"
}
: > "$TMP/o.out"; : > "$TMP/h.out"; : > "$TMP/d.out"; : > "$TMP/all_sessions.log"

COL=$(q "insert into public.collections (slug, title_ar) values ('ci-0022-conc', 'CI 0022') returning id")
AV=$(mkvis addon-owner)
X=$(mkvis home-x)
Y=$(mkvis home-y)
XC=$(mkvis coll-x)
WROW='[{"widthCm": 70, "pricePerMeterPiastres": 1300, "isActive": true}]'
REORDER="select public.zell_reorder_products(array(select id from public.products order by id))"

# مقاسات (DML مباشر)
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

# إضافات (DML مباشر)
P=$(mkp a1 0); q "insert into public.product_addons (product_id, addon_id) values ($AV, $P)" > /dev/null
other_first "update public.product_addons set sort_order = sort_order where addon_id = $P" 2 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && [ "$(exists_p "$P")" = "1" ] && [ "$(q "select count(*) from public.product_addons where addon_id = $P")" = "1" ] && ok=yes
record "C03 addon link locked by another session -> 45508 at once, nothing changed" "$ok" "$(dd)"
P=$(mkp a2 0)
delete_first "$P" "$(ver "$P")" "insert into public.product_addons (product_id, addon_id) values ($AV, $P)"
ok=no; deleted && has "$TMP/o.out" '23503' && [ "$(q "select count(*) from public.product_addons where addon_id = $P or product_id = $P")" = "0" ] && ok=yes
record "C04 addon link added while the delete holds -> FK 23503; no orphan link" "$ok" "$(dd)"

# مجموعات (DML مباشر)
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
ok=no; deleted && has "$TMP/d.out" '"removed_from_home": true' && [ "$(home_ids)" = "[]" ] && ok=yes
record "C09 first home_products insert holds the list lock -> delete waits, then removes the id" "$ok" "$(dd)"
q "delete from public.settings where key = 'home_products'" > /dev/null
P=$(mkp h2 0)
delete_first "$P" "$(ver "$P")" "insert into public.settings (key, value) values ('home_products', '{\"ids\": [$P]}')"
ok=no; deleted && has "$TMP/o.out" '45507' && [ "$(q "select count(*) from public.settings where key = 'home_products'")" = "0" ] && ok=yes
record "C10 first home_products insert while the delete holds -> waits, then 45507; no row with a missing id" "$ok" "$(dd)"

# قايمة الرئيسية: تعديل صف فيه المحذوف
set_home "$X"
P=$(mkp h3 0)
other_first "update public.settings set value = '{\"ids\": [$X, $P]}' where key = 'home_products'" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && has "$TMP/d.out" '"removed_from_home": true' && [ "$(home_ids)" = "[$X]" ] && ok=yes
record "C11 home list update adding the id holds the lock -> delete waits, then removes it" "$ok" "$(dd)"
P=$(mkp h4 0)
delete_first "$P" "$(ver "$P")" "update public.settings set value = '{\"ids\": [$X, $P]}' where key = 'home_products'"
ok=no; deleted && has "$TMP/o.out" '45507' && [ "$(home_ids)" = "[$X]" ] && ok=yes
record "C12 home list update adding the id while the delete holds -> waits, then 45507; list unchanged" "$ok" "$(dd)"

# حذفين
P=$(mkp t1 0); V=$(ver "$P")
: > "$TMP/h.out"
run_sql "$(del_txt "$P" "$V" 1.5)" "$TMP/d.out" & dp=$!
sleep 0.6
t0=$(now_ms); run_sql "$(del_txt "$P" "$V")" "$TMP/o.out"; track "$t0" "$(now_ms)"
wait "$dp"
ok=no; deleted && has "$TMP/o.out" '45501' && ok=yes
record "C13 two deletes of the same product -> the second waits, then 45501" "$ok" "$(dd)"
P=$(mkp t2 0); P2=$(mkp t3 0)
run_sql "$(del_txt "$P" "$(ver "$P")" 1.5)" "$TMP/d.out" & dp=$!
sleep 0.6
t0=$(now_ms); run_sql "$(del_txt "$P2" "$(ver "$P2")")" "$TMP/o.out"; track "$t0" "$(now_ms)"
wait "$dp"
ok=no; deleted && has "$TMP/o.out" '"deleted": true' && [ "$(exists_p "$P")$(exists_p "$P2")" = "00" ] && ok=yes
record "C14 two deletes of different products -> serialized on the list lock, both succeed" "$ok" "$(dd)"

# ترتيب (DML مباشر على sort_order بس)
P=$(mkp r1 0)
other_first "update public.products set sort_order = sort_order + 1 where id = $P" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && ok=yes
record "C15 sort_order-only update holds the product row -> delete waits, then succeeds (version unchanged)" "$ok" "$(dd)"
P=$(mkp r2 0)
delete_first "$P" "$(ver "$P")" "update public.products set sort_order = 7 where id = $P returning id"
ok=no; deleted && ! has "$TMP/o.out" 'ERROR' && [ -z "$(tr -d '[:space:]' < "$TMP/o.out")" ] && ok=yes
record "C16 sort_order-only update while the delete holds -> waits, then updates 0 rows" "$ok" "$(dd)"

# النسخة اتغيّرت أثناء الانتظار · انتهاء الانتظار
P=$(mkp v1 0); V=$(ver "$P")
other_first "update public.products set updated_at = now() where id = $P" 1.5 "$P" "$V"
ok=no; has "$TMP/d.out" '45502' && [ "$(exists_p "$P")" = "1" ] && ok=yes
record "C17 product row edited while the delete waits -> 45502, nothing deleted" "$ok" "$(dd)"
P=$(mkp l1 0)
other_first "select 1 from public.products where id = $P for update" 5 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && has "$TMP/d.out" 'DETAIL:  product' && [ "$(exists_p "$P")" = "1" ] && [ "$LASTD" -lt 4500 ] && ok=yes
record "C18 product row held longer than lock_timeout (3s) -> 45508 (product) after ~3s, nothing deleted" "$ok" "$(dd)"
P=$(mkp l2 0)
other_first "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_catalog:home_products', 0))" 5 "$P" "$(ver "$P")"
ok=no; has "$TMP/d.out" '45508' && has "$TMP/d.out" 'DETAIL:  home_products_lock' && [ "$(exists_p "$P")" = "1" ] && [ "$LASTD" -lt 4500 ] && ok=yes
record "C19 home list lock held longer than lock_timeout -> 45508 (home_products_lock) after ~3s, nothing deleted" "$ok" "$(dd)"

# الدوال الفعلية (service_role زي اللوحة النهارده) — كل حالة بالترتيبين، وباقي الداتابيز بصمته زي ما هي.
outcome() { if deleted; then echo success; elif has "$TMP/d.out" '45508'; then echo 45508; else echo other; fi; }
P=$(mkp pw1 1); OM=$(om); F=$(fp_rest "$P" 0 "$OM")
other_first "select public.zell_set_product_widths($P, '$WROW'::jsonb)" 2 "$P" "$(ver "$P")" service_role
ok=no
if ! has "$TMP/d.out" '45502' && [ "$(fp_rest "$P" 0 "$OM")" = "$F" ]; then
  if deleted; then [ "$(q "select count(*) from public.product_widths where product_id = $P")" = "0" ] && ok=yes
  elif has "$TMP/d.out" '45508'; then [ "$(q "select string_agg(width_cm::text, ',') from public.product_widths where product_id = $P")" = "70" ] && ok=yes; fi
fi
record "P01 zell_set_product_widths first, then delete (same product) -> success on the current state or 45508, never 45502; rest unchanged [got: $(outcome)]" "$ok" "$(dd)"
P=$(mkp pw2 1); OM=$(om); F=$(fp_rest "$P" 0 "$OM")
delete_first "$P" "$(ver "$P")" "select public.zell_set_product_widths($P, '$WROW'::jsonb)" service_role
ok=no; deleted && has "$TMP/o.out" '45100' && [ "$(q "select count(*) from public.product_widths where product_id = $P")" = "0" ] \
  && [ "$(fp_rest "$P" 0 "$OM")" = "$F" ] && ok=yes
record "P02 delete first, then zell_set_product_widths -> waits on the product row, then not found (45100); no width written; rest unchanged" "$ok" "$(dd)"

AV2=$(mkvis addon-owner-2)
P=$(mkp pa1 0); q "update public.products set sale_unit = 'piece' where id = $P" > /dev/null
OM=$(om); F=$(fp_rest "$P,$AV2" 0 "$OM")
other_first "select public.zell_set_product_addons($AV2, array[$P])" 2 "$P" "$(ver "$P")" service_role
ok=no
if [ "$(fp_rest "$P,$AV2" 0 "$OM")" = "$F" ]; then
  if deleted; then [ "$(q "select count(*) from public.product_addons where addon_id = $P or product_id = $AV2")" = "0" ] && ok=yes
  elif has "$TMP/d.out" '45508'; then [ "$(q "select count(*) from public.product_addons where product_id = $AV2 and addon_id = $P")" = "1" ] && [ "$(exists_p "$P")" = "1" ] && ok=yes; fi
fi
record "P03 zell_set_product_addons (other product lists it) first, then delete -> success with the link cascaded, or 45508; rest unchanged [got: $(outcome)]" "$ok" "$(dd)"
AV3=$(mkvis addon-owner-3)
P=$(mkp pa2 0); q "update public.products set sale_unit = 'piece' where id = $P" > /dev/null
q "insert into public.product_addons (product_id, addon_id) values ($AV3, $P)" > /dev/null
OM=$(om); F=$(fp_rest "$P,$AV3" 0 "$OM")
delete_first "$P" "$(ver "$P")" "select public.zell_set_product_addons($AV3, array[$P])" service_role
ok=no; deleted && { has "$TMP/o.out" '23503' || has "$TMP/o.out" '45112'; } \
  && [ "$(q "select count(*) from public.product_addons where product_id = $AV3")" = "0" ] && [ "$(fp_rest "$P,$AV3" 0 "$OM")" = "$F" ] && ok=yes
record "P04 delete first, then zell_set_product_addons listing it -> the writer fails (FK), no partial change; rest unchanged" "$ok" "$(dd)"

COL2=$(q "insert into public.collections (slug, title_ar) values ('ci-0022-conc-2', 'CI 0022 2') returning id")
P=$(mkp pk1 0)
q "insert into public.product_collections (collection_id, product_id, sort_order) values ($COL2, $XC, 1), ($COL2, $P, 2)" > /dev/null
OM=$(om); F=$(fp_rest "$P" "$COL2" "$OM")
other_first "select public.zell_set_collection_products($COL2, array[$P, $XC])" 2 "$P" "$(ver "$P")" service_role
ok=no
if [ "$(fp_rest "$P" "$COL2" "$OM")" = "$F" ]; then
  if deleted; then [ "$(q "select string_agg(product_id::text, ',' order by product_id) from public.product_collections where collection_id = $COL2")" = "$XC" ] && ok=yes
  elif has "$TMP/d.out" '45508'; then [ "$(q "select string_agg(product_id::text || ':' || sort_order, ',' order by sort_order) from public.product_collections where collection_id = $COL2")" = "$P:1,$XC:2" ] && ok=yes; fi
fi
record "P05 zell_set_collection_products (collection with the product) first, then delete -> 45508 or success on the current state; rest unchanged [got: $(outcome)]" "$ok" "$(dd)"
COL3=$(q "insert into public.collections (slug, title_ar) values ('ci-0022-conc-3', 'CI 0022 3') returning id")
P=$(mkp pk2 0)
q "insert into public.product_collections (collection_id, product_id, sort_order) values ($COL3, $XC, 1), ($COL3, $P, 2)" > /dev/null
OM=$(om); F=$(fp_rest "$P" "$COL3" "$OM")
delete_first "$P" "$(ver "$P")" "select public.zell_set_collection_products($COL3, array[$P, $XC])" service_role
ok=no; deleted && has "$TMP/o.out" '23503' \
  && [ "$(q "select string_agg(product_id::text || ':' || sort_order, ',') from public.product_collections where collection_id = $COL3")" = "$XC:1" ] \
  && [ "$(fp_rest "$P" "$COL3" "$OM")" = "$F" ] && ok=yes
record "P06 delete first, then zell_set_collection_products listing it -> the writer fails (FK), collection unchanged; rest unchanged" "$ok" "$(dd)"

P=$(mkp pr1 0); V=$(ver "$P"); OM=$(om); F=$(fp_rest "$P" 0 "$OM" reorder)
other_first "$REORDER" 2 "$P" "$V" service_role
ok=no; has "$TMP/d.out" '45502' && [ "$(exists_p "$P")" = "1" ] && [ "$(fp_rest "$P" 0 "$OM" reorder)" = "$F" ] && ok=yes
record "P07 zell_reorder_products first (it rewrites updated_at of every product) -> delete waits, then 45502; nothing deleted" "$ok" "$(dd)"
P=$(mkp pr2 0); N=$(q "select count(*) from public.products"); OM=$(om); F=$(fp_rest "$P" 0 "$OM" reorder)
delete_first "$P" "$(ver "$P")" "$REORDER" service_role
ok=no; deleted && ! has "$TMP/o.out" 'ERROR' && [ "$(tr -d '[:space:]' < "$TMP/o.out")" = "$((N - 1))" ] && [ "$(fp_rest "$P" 0 "$OM" reorder)" = "$F" ] && ok=yes
record "P08 delete first, then zell_reorder_products -> waits, then reorders the $((N - 1)) remaining rows" "$ok" "$(dd)"

# قايمة الرئيسية: حذفين لمنتجين فيها · تعديل من غير المحذوف
P=$(mkp hh1 0); P2=$(mkp hh2 0); set_home "$X, $P, $P2"
run_sql "$(del_txt "$P" "$(ver "$P")" 1.5)" "$TMP/d.out" & dp=$!
sleep 0.6
: > "$TMP/h.out"
t0=$(now_ms); run_sql "$(del_txt "$P2" "$(ver "$P2")")" "$TMP/o.out"; track "$t0" "$(now_ms)"
wait "$dp"
ok=no; deleted && has "$TMP/o.out" '"deleted": true' && has "$TMP/o.out" '"removed_from_home": true' && [ "$(home_ids)" = "[$X]" ] && ok=yes
record "H01 two deletes of two products in the home list -> serialized, final list = the rest in order" "$ok" "$(dd)"
set_home "$X"; P=$(mkp hn1 0)
other_first "update public.settings set value = '{\"ids\": [$X, $Y]}' where key = 'home_products'" 1.5 "$P" "$(ver "$P")"
ok=no; deleted && has "$TMP/d.out" '"removed_from_home": false' && [ "$(home_ids)" = "[$X, $Y]" ] && ok=yes
record "H02 home list update without the deleted product first -> delete waits, then succeeds; the new list kept" "$ok" "$(dd)"
set_home "$X"; P=$(mkp hn2 0)
delete_first "$P" "$(ver "$P")" "update public.settings set value = '{\"ids\": [$X, $Y]}' where key = 'home_products'"
ok=no; deleted && ! has "$TMP/o.out" 'ERROR' && [ "$(home_ids)" = "[$X, $Y]" ] && ok=yes
record "H03 delete first, then home list update without it -> waits, then saved; no choice lost" "$ok" "$(dd)"
# حفظ المحتوى ومفاتيح settings التانية مابياخدوش M.
CKEYS="'hero','order_steps','faqs','sections','footer_links','trust_line','announcement'"
run_sql "$(hold_txt "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zell_catalog:home_products', 0))" 4)" "$TMP/h.out" & hp=$!
sleep 0.6
t0=$(now_ms)
run_sql "$(printf '%s\n' "set lock_timeout = '1s';" "begin;" "set local role service_role;" \
  "select (public.zell_save_content((select max(s.updated_at) from public.settings s where s.key in ($CKEYS)), (select value from public.settings where key = 'hero'), (select value from public.settings where key = 'order_steps'), (select value from public.settings where key = 'faqs'), (select value from public.settings where key = 'sections'), (select value from public.settings where key = 'footer_links'), (select value #>> '{}' from public.settings where key = 'trust_line'), null) is not null)::text;" \
  "update public.settings set value = value, updated_at = now() where key = 'hero' returning 'other-key-ok';" "commit;")" "$TMP/o.out"
t1=$(now_ms)
wait "$hp"
: > "$TMP/d.out"; LASTD=$((t1 - t0))
ok=no; has "$TMP/o.out" 'true' && has "$TMP/o.out" 'other-key-ok' && ! has "$TMP/o.out" 'ERROR' && [ "$LASTD" -lt 1500 ] && ok=yes
record "H04 zell_save_content + another settings key while the list lock is held -> no wait (lock_timeout 1s), saved" "$ok" "$(dd)"

ok=no; ! grep -q '40P01' "$TMP/all_sessions.log" && [ -s "$TMP/all_sessions.log" ] && ok=yes
record "Z01 no deadlock (40P01) in any session of the concurrency runs" "$ok" "$(grep -m1 '40P01' "$TMP/all_sessions.log")"
ok=no; [ "$MAXD" -le 6500 ] && [ "$MAXD" -gt 0 ] && ok=yes
record "Z02 longest delete call in the concurrency runs = $MAXD ms (bound 6500 = two lock waits of 3s + margin)" "$ok" "max=$MAXD"

# ---- 13) الرجوع بعد حذف حقيقي: مرفوض ----
rows=$(q "select count(*) from public.storage_orphans where reason = 'product_deleted'")
run_file "$ROLLBACK" "$TMP/r3.out"
ok=no; [ "$rows" -gt 0 ] && has "$TMP/r3.out" 'ZELL_0022_RB_HAS_DELETES' && [ "$(state)" = "$APPLIED" ] && ok=yes
record "R03 rollback after a real delete ($rows product_deleted rows) -> ZELL_0022_RB_HAS_DELETES, nothing removed" "$ok" "$(state) $(tailof "$TMP/r3.out")"
v20
ok=no; verify_ok && has "$TMP/i20.out" 'ZELL_0020_VERIFY_RESULT part_a=ok' && ok=yes
record "V02 after the concurrency runs: 0022 verify PASS 10 and 0020 verify part_a=ok" "$ok" "$(summary_of "$TMP/v.out") $(fails_of "$TMP/v.out") $(v20_line)"

finish
