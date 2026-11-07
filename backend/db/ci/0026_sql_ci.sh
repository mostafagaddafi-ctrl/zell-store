#!/usr/bin/env bash
# IMAGE-DELETE B (0026) — اختبار SQL في CI: Postgres 17 مؤقت، والداتابيز مبنية من الصفر بالقايمة الصريحة كلها
# (backend/db/ci/build_from_scratch.list؛ postgres مش superuser زي Production)، وبعدين 0026 فوقها. مفيش أي اتصال بـ Supabase،
# ولا بيانات ولا مفاتيح من Production.
# بيغطي (العقد docs/contracts/IMAGE-DELETE.md §٨): شكل المعاملة · md5 الجسم (ptest = apply) · سطر الموافقة برّه الملفات ·
# استعلام الأثر قبل وبعد (البيانات زي ما هي) · حراس الـ preflight من غير أثر · ptest قبل التطبيق بس · التطبيق ورفض الإعادة ·
# verify (ومعاه منحة/policy زيادة = FAIL) · خط أساس الصلاحيات (منحة/policy زيادة قبل التطبيق = رفض) · السيناريوهات (0026_flows.sql) ·
# التزامن بجلستين حقيقيتين مع إثبات التداخل من pg_stat_activity (الأولى ماسكة القفل في pg_sleep والتانية مستنية Lock قبل ما
# الأولى تسيبه؛ غير كده الحالة تفشل): حذف ↔ تفعيل في الترتيبين · حذفين · set_primary · reorder · حذف المنتج · التراجع المشروط ↔
# set_primary · حذف ↔ إضافة صورة في الترتيبين · تسجيل الملف ↔ سجل لسه ما اتعملش له commit (45704) · وبعدها فحص سجلات
# الحالات (deadlock) · الرجوع (من غير موافقة · بموافقة · مرة تانية) ثم الأثر = قبل التطبيق بالظبط ثم ptest وإعادة التطبيق.
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
APPLY="$MIG/0026_image_delete.sql"
PTEST="$MIG/0026_image_delete_ptest.sql"
VERIFY="$MIG/0026_image_delete_verify.sql"
ROLLBACK="$MIG/0026_image_delete_rollback.sql"
IMPACT="$MIG/0026_image_delete_impact.sql"
FLOWS="$CIDIR/0026_flows.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || true)"
[ -n "$SUPER" ] || SUPER=supabase_admin
DB=zell_ci_0026
TMP="$(mktemp -d)"
PASS=0
FAIL=0
SEEN=" "
OWNER_ID='00000000-0000-4000-8000-0000000000a1'
ADMIN_ID='00000000-0000-4000-8000-0000000000a2'
OFF_ID='00000000-0000-4000-8000-0000000000a3'
USER_ID='00000000-0000-4000-8000-0000000000a4'
EMPTY_MD5=d41d8cd98f00b204e9800998ecf8427e
EXPECTED="S01 S02 S03 M01 B01 X01 M02 V00 E01 E02 E03 E04 P01 A01 A02 P02 V01 N01 N02 M03 F01 K01 K02 K03 K04 K05 K06 K07 K08 K09 K10 K11 RB1 RB2 V02 M04 RB3 P03 RA1 V03"
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
  echo "ZELL_0026_SQL_CI_RESULT pass=$PASS fail=$FAIL"
  rm -rf "$TMP"
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}
stop() { record "$1" no "$2"; echo "STOPPED: $1"; finish; }
tailof() { tail -n 6 "$1" 2> /dev/null | tr '\n' ' ' | cut -c1-600; }
su_q() { local db=$1; shift; psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$db" "$@" < /dev/null; }
su_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$1" -f "$2" < /dev/null; }
pg_f() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$1" -f "$2" < /dev/null; }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1" < /dev/null 2>&1; }
pg_in() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$1" 2>&1; }
su_in() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$SUPER" -d "$DB" -f - > "$1" 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" < /dev/null > "$2" 2>&1; }
run_sql() { printf '%s\n' "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
with_appr() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
body_of() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1"; }
# إثبات التداخل: جلسة application_name = $1 في pg_sleep (sleep) أو مستنية قفل (lock)، لحد 5 ثواني.
wait_app() {
  local i c cond
  if [ "$2" = sleep ]; then cond="wait_event = 'PgSleep'"; else cond="wait_event_type = 'Lock'"; fi
  for i in $(seq 1 50); do
    c=$(q "select pg_catalog.count(*) from pg_catalog.pg_stat_activity where application_name = '$1' and $cond")
    [ "$c" = "1" ] && return 0
    sleep 0.1
  done
  return 1
}
# حالة تزامن: $1 الاسم · $2 نص الجلسة الماسكة (بتنام جوه المعاملة) · $3 نص الجلسة المستنية. OV=yes لو اتشاف التداخل.
overlap() {
  local hp wp
  OV=no
  PGAPPNAME="$1h" run_sql "$2" "$TMP/$1h.out" & hp=$!
  if wait_app "$1h" sleep; then
    PGAPPNAME="$1w" run_sql "$3" "$TMP/$1w.out" & wp=$!
    wait_app "$1w" lock && OV=yes
    wait "$wp"
  else
    echo "holder never reached pg_sleep" > "$TMP/$1w.out"
  fi
  wait "$hp"
}
# الحالة: دالة الحذف | الـ trigger | عدد policies الدور | DELETE على product_images.
state() {
  q "select (pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null)::text
     || '|' || (exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'))::text
     || '|' || (select pg_catalog.count(*) from pg_catalog.pg_policies p where p.policyname like 'zell\\_catalog\\_definer\\_%')
     || '|' || pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'DELETE')::text"
}
# ملف بنتيجة صفوف (ptest / verify / flows): rc + صف الحكم (0|summary|...).
summary_of() { local rc; run_file "$1" "$TMP/$2.out"; rc=$?; echo "rc=$rc $(grep '^0|summary|' "$TMP/$2.out" | cut -d'|' -f3-)"; }
impact() { psql -X -q -tA -F "$US" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$IMPACT" < /dev/null > "$TMP/imp_$1.out" 2>&1; echo "$?" > "$TMP/imp_$1.rc"; }
impact_v() { su_q "$DB" -c "grant pg_read_all_stats to postgres" > "$TMP/impv_$1.log" 2>&1; impact "$1"; su_q "$DB" -c "revoke pg_read_all_stats from postgres" >> "$TMP/impv_$1.log" 2>&1; }
imp_valid() { [ "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" = "0" ] && [ "$(grep -c . "$TMP/imp_$1.out")" = "1" ] && [ "$(awk -F "$US" 'NF {print NF}' "$TMP/imp_$1.out")" = "15" ]; }
imp_f() { grep -v '^$' "$TMP/imp_$1.out" | head -n 1 | cut -d "$US" -f "$2"; }
imp_detail() { printf 'rc=%s %s' "$(cat "$TMP/imp_$1.rc" 2> /dev/null)" "$(tr "$US" '|' < "$TMP/imp_$1.out" | tr '\n' ' ' | cut -c1-900)"; }
# جلسات التزامن: نداء بجلسة المالك أو service_role أو postgres، وبعدين sleep جوه نفس المعاملة.
own_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$OWNER_ID\",\"role\":\"authenticated\"}', true);" "set local role authenticated;" "$1;" "reset role;" "select pg_catalog.pg_sleep($2);" "commit;"; }
svc_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "set local role service_role;" "$1;" "reset role;" "select pg_catalog.pg_sleep($2);" "commit;"; }
pgs_txt() { printf '%s\n' "set statement_timeout = '20s';" "begin;" "$1;" "select pg_catalog.pg_sleep($2);" "commit;"; }
mkp() { q "insert into public.products (name_ar, price_per_meter_piastres, is_active) values ('ci-0026-$1', 1000, false) returning id"; }
img() { q "insert into public.product_images (product_id, object_path, kind, sort_order, is_primary, fit) values ($1, 'products/$1/ci26-k-$2.jpg', 'gallery', $3, $4, case when $4 then 'cover' else 'contain' end) returning id"; }
delsql() { printf 'select public.zell_product_image_delete(%s, %s)::text' "$1" "$2"; }
kd() { printf 'h=[%s] w=[%s] final=[%s]' "$(tailof "$TMP/$1h.out")" "$(tailof "$TMP/$1w.out")" "$2"; }

# ---- 1) فحوص ثابتة ----
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" "$IMPACT" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 transaction shape: ptest / verify / flows / impact = begin ... one SELECT ... rollback (checker self-test first)" "$ok" "$(tailof "$TMP/shape.out") $(tailof "$TMP/shape_self.out")"
m_apply=$(body_md5 "$APPLY" "0026 BODY"); m_ptest=$(body_md5 "$PTEST" "0026 BODY")
ok=no; [ "$m_apply" = "$m_ptest" ] && [ "$m_apply" != "$EMPTY_MD5" ] && ok=yes
record "S02 ptest body = apply body (md5 $m_apply)" "$ok" "apply=$m_apply ptest=$m_ptest"
ok=no
if [ "$(grep -cx 'begin;' "$APPLY")" = "1" ] && [ "$(grep -cx 'commit;' "$APPLY")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$APPLY" | tail -n 1)" = "commit;" ] \
   && [ "$(grep -cx 'begin;' "$ROLLBACK")" = "1" ] && [ "$(grep -cx 'commit;' "$ROLLBACK")" = "1" ] && [ "$(grep -v '^[[:space:]]*$' "$ROLLBACK" | tail -n 1)" = "commit;" ] \
   && ! grep -v '^[[:space:]]*--' "$APPLY" "$ROLLBACK" | grep -qE 'zell\.approved_by ='; then ok=yes; fi
record "S03 apply + rollback: one begin + one commit (last), no approval line inside the files" "$ok" ""
ok=no
if [ "$(grep -cx 'begin;' "$IMPACT")" = "1" ] && [ "$(grep -cx 'set transaction read only;' "$IMPACT")" = "1" ] && [ "$(grep -cx 'rollback;' "$IMPACT")" = "1" ] && ! grep -q '{{' "$IMPACT" "$PTEST" "$VERIFY" "$APPLY" "$ROLLBACK"; then ok=yes; fi
record "M01 impact query: read only, one begin / rollback; no double braces in any 0026 file (Retool)" "$ok" ""

# ---- 2) بناء الداتابيز من القايمة الصريحة كلها ----
fresh=$(su_q postgres -c "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname in ('postgres','anon','authenticated','service_role')")
[ "$fresh" = "0" ] || stop "B01 fresh disposable cluster" "platform roles already present"
su_q postgres -c "create database $DB" -c "alter database $DB set zell.ci_scratch = 'on'" > "$TMP/createdb.log" 2>&1 || stop "B01 create database" "$(tailof "$TMP/createdb.log")"
su_f "$DB" "$CIDIR/platform_shim.sql" > "$TMP/shim.log" 2>&1 || stop "B01 platform_shim.sql" "$(tailof "$TMP/shim.log")"
su_f "$DB" "$CIDIR/platform_default_privileges.sql" > "$TMP/dp.log" 2>&1 || stop "B01 platform_default_privileges.sql" "$(tailof "$TMP/dp.log")"
n=0
last=""
while IFS='|' read -r kind rel _reason; do
  case "$kind" in ''|'#'*|exclude) continue ;; apply|baseline|fixture|check) ;; *) stop "B01 build list" "unknown kind $kind" ;; esac
  [ "$rel" = "migrations/0026_image_delete.sql" ] && stop "B01 build list" "0026 already in the list (stage C only)"
  f="$DBDIR/$rel"
  [ -f "$f" ] || stop "B01 build list" "missing $rel"
  n=$((n + 1))
  last="$rel"
  runf="$f"
  if [ "$kind" = "apply" ] && grep -q 'zell\.approved_by' "$f"; then
    runf="$TMP/run_$n.sql"
    sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = 'ci-0026-build';/" "$f" > "$runf"
    if grep -q 'zell\.inv_expected' "$f"; then
      sed -i "0,/^begin;\$/s//begin;\nset local zell.inv_expected = 'locations=1 suppliers=0 purchase_docs=0 purchase_doc_lines=0 purchase_doc_charges=0 opening_docs=0 opening_lines=0 stock_lots=0 commands=0 audit=0';/" "$runf"
    fi
  fi
  pg_f "$DB" "$runf" > "$TMP/build_$n.log" 2>&1 || stop "B01 build step $n $rel" "$(tailof "$TMP/build_$n.log")"
done < "$LIST"
shape=$(su_q "$DB" -c "select rolsuper::text || ',' || rolbypassrls::text from pg_catalog.pg_roles where rolname = 'postgres'")
ok=no; [ "$n" -gt 10 ] && [ "$shape" = "false,true" ] && [ "$last" = "migrations/0025_installer_shipping.sql" ] && ok=yes
record "B01 database built from the whole build_from_scratch.list ($n steps, last $last), postgres not superuser" "$ok" "steps=$n last=$last postgres=$shape"
[ "$ok" = yes ] || finish

# ---- 3) بيانات CI (committed): الهويات ----
q "insert into auth.users (id, email) values ('$ADMIN_ID', 'ci-admin-0026@example.invalid'), ('$OFF_ID', 'ci-off-0026@example.invalid'), ('$USER_ID', 'ci-user-0026@example.invalid')" > "$TMP/x1.log"
q "insert into public.admin_users (user_id, role, is_active) values ('$ADMIN_ID', 'admin', true), ('$OFF_ID', 'admin', false)" >> "$TMP/x1.log"
chk=$(q "select (select pg_catalog.count(*) from public.admin_users where user_id = '$OWNER_ID' and role = 'owner' and is_active)
         || '|' || (select pg_catalog.count(*) from public.admin_users where user_id in ('$ADMIN_ID', '$OFF_ID'))
         || '|' || (select pg_catalog.count(*) from auth.users where id = '$USER_ID')")
ok=no; [ "$chk" = "1|2|1" ] && ok=yes
record "X01 CI identities: active owner ...a1 (fixture), admin ...a2, inactive admin ...a3, plain user ...a4" "$ok" "$chk $(tailof "$TMP/x1.log")"

# ---- 4) قبل التطبيق ----
impact_v b
ok=no
if imp_valid b && [ "$(imp_f b 1)" = "false|false" ] && [ "$(imp_f b 13)" = "0" ] && [ "$(imp_f b 14)" = "t" ] && [ "$(imp_f b 15)" = "-" ] \
   && imp_f b 11 | grep -q '^product_images:S=bucket,id,object_path,product_id;U=product_id;I=;D=false;G=false | ' \
   && ! imp_f b 12 | grep -q 'image_promote'; then ok=yes; fi
record "M02 impact before 0026: not applied, idle_tx 0, sessions visible, full definer grants = 0022 baseline, no new policy, 15 columns" "$ok" "$(imp_detail b)"
ST0=$(state)
res=$(summary_of "$VERIFY" v0)
ok=no; case "$res" in "rc=0 FAIL|"*) ok=yes ;; esac
record "V00 verify before 0026 -> FAIL (functions missing), no execution errors" "$ok" "$res $(tailof "$TMP/v0.out")"
run_file "$APPLY" "$TMP/e1.out"
ok=no; has "$TMP/e1.out" 'ZELL_0026_APPROVAL_MISSING' && [ "$(state)" = "$ST0" ] && ok=yes
record "E01 apply without the approval line -> ZELL_0026_APPROVAL_MISSING, nothing changed" "$ok" "$(tailof "$TMP/e1.out")"
with_appr "$APPLY" 'ci-0026-e2' | su_in "$TMP/e2.out"
ok=no; has "$TMP/e2.out" 'ZELL_0026_WRONG_CALLER' && [ "$(state)" = "$ST0" ] && ok=yes
record "E02 apply as another role (superuser) -> ZELL_0026_WRONG_CALLER, nothing changed" "$ok" "$(tailof "$TMP/e2.out")"
{ echo "begin;"; echo "grant update (sort_order) on table public.product_images to zell_catalog_definer;"; echo "set local zell.approved_by = 'ci-0026-e3';"; body_of "$APPLY" "0026 BODY"; echo "rollback;"; } | pg_in "$TMP/e3.out"
ok=no; has "$TMP/e3.out" 'ZELL_0026_BASELINE_DRIFT' && has "$TMP/e3.out" 'grants:' && [ "$(state)" = "$ST0" ] && ok=yes
record "E03 unexpected extra grant (UPDATE sort_order) before apply, same transaction -> ZELL_0026_BASELINE_DRIFT (grants), nothing changed" "$ok" "$(tailof "$TMP/e3.out")"
{ echo "begin;"; echo "alter policy zell_catalog_definer_lock on public.product_images with check (true);"; echo "set local zell.approved_by = 'ci-0026-e4';"; body_of "$APPLY" "0026 BODY"; echo "rollback;"; } | pg_in "$TMP/e4.out"
ok=no; has "$TMP/e4.out" 'ZELL_0026_BASELINE_DRIFT' && has "$TMP/e4.out" 'policies:' && [ "$(state)" = "$ST0" ] && ok=yes
record "E04 widened policy (lock with check true) before apply, same transaction -> ZELL_0026_BASELINE_DRIFT (policies), nothing changed" "$ok" "$(tailof "$TMP/e4.out")"
res=$(summary_of "$PTEST" p1)
ok=no; [ "$res" = "rc=0 PASS|pass=6 fail=0" ] && [ "$(state)" = "$ST0" ] && ok=yes
record "P01 ptest before 0026 -> PASS 6/0, nothing changed" "$ok" "$res $(tailof "$TMP/p1.out")"

# ---- 5) التطبيق ----
with_appr "$APPLY" 'ci-0026-apply' | pg_in "$TMP/a1.out"; rc=$?
ST1=$(state)
ok=no; [ "$rc" = "0" ] && case "$ST1" in "true|true|"*"|true") ok=yes ;; esac
record "A01 apply with the approval line -> applied (postflight inside the file passed)" "$ok" "rc=$rc state=$ST1 $(tailof "$TMP/a1.out")"
[ "$ok" = yes ] || finish
with_appr "$APPLY" 'ci-0026-again' | pg_in "$TMP/a2.out"
ok=no; has "$TMP/a2.out" 'ZELL_0026_ALREADY_APPLIED' && [ "$(state)" = "$ST1" ] && ok=yes
record "A02 apply again -> ZELL_0026_ALREADY_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/a2.out")"
run_file "$PTEST" "$TMP/p2.out"
ok=no; has "$TMP/p2.out" 'ZELL_0026_PTEST_PRE_APPLY_ONLY' && ok=yes
record "P02 ptest after 0026 -> ZELL_0026_PTEST_PRE_APPLY_ONLY" "$ok" "$(tailof "$TMP/p2.out")"
res=$(summary_of "$VERIFY" v1)
ok=no; [ "$res" = "rc=0 PASS|pass=9 fail=0" ] && ok=yes
record "V01 verify after 0026 -> PASS 9/0" "$ok" "$res $(grep '|fail|' "$TMP/v1.out" | tr '\n' ' ' | cut -c1-600)"
q "grant update (sort_order) on table public.product_images to zell_catalog_definer" > "$TMP/n1.log"
r1=$(summary_of "$VERIFY" n1a); f1=$(grep '|fail|' "$TMP/n1a.out" | cut -d'|' -f2 | tr '\n' ' ')
q "revoke update (sort_order) on table public.product_images from zell_catalog_definer" >> "$TMP/n1.log"
r2=$(summary_of "$VERIFY" n1b)
ok=no; case "$r1" in "rc=0 FAIL|"*) [ "$f1" = "V06 " ] && [ "$r2" = "rc=0 PASS|pass=9 fail=0" ] && ok=yes ;; esac
record "N01 extra grant after apply (UPDATE sort_order) -> verify FAIL on V06 only; revoked -> PASS 9/0" "$ok" "with=$r1 fails=[$f1] after=$r2 $(tailof "$TMP/n1.log")"
q "alter policy zell_catalog_definer_image_promote on public.product_images with check ((is_primary and fit = 'cover' and kind = 'gallery') or true)" > "$TMP/n2.log"
r1=$(summary_of "$VERIFY" n2a); f1=$(grep '|fail|' "$TMP/n2a.out" | cut -d'|' -f2 | tr '\n' ' ')
q "alter policy zell_catalog_definer_image_promote on public.product_images with check (is_primary and fit = 'cover' and kind = 'gallery')" >> "$TMP/n2.log"
r2=$(summary_of "$VERIFY" n2b)
ok=no; case "$r1" in "rc=0 FAIL|"*) [ "$f1" = "V05 " ] && [ "$r2" = "rc=0 PASS|pass=9 fail=0" ] && ok=yes ;; esac
record "N02 widened promote policy after apply (OR true) -> verify FAIL on V05 only; restored -> PASS 9/0" "$ok" "with=$r1 fails=[$f1] after=$r2 $(tailof "$TMP/n2.log")"
impact_v a
ok=no
if imp_valid a && [ "$(imp_f a 1)" = "true|true" ] && [ "$(imp_f a 13)" = "0" ] \
   && imp_f a 11 | grep -q '^product_images:S=bucket,id,is_primary,kind,object_path,product_id,sort_order;U=fit,is_primary,updated_at;I=;D=true;G=false | ' \
   && imp_f a 12 | grep -q 'image_promote' && [ "$(imp_f a 11 | cut -d'|' -f2-)" = "$(imp_f b 11 | cut -d'|' -f2-)" ]; then
  ok=yes
  for c in 2 3 4 5 6 7 8 9 10; do [ "$(imp_f a $c)" = "$(imp_f b $c)" ] || ok=no; done
fi
record "M03 impact after 0026: applied, data columns 2..10 identical to before, product_images grants exact (UPDATE product_id gone), products/storage_orphans grants unchanged" "$ok" "$(imp_detail a)"

# ---- 6) السيناريوهات ----
res=$(summary_of "$FLOWS" f1)
ok=no; [ "$res" = "rc=0 PASS|pass=19 fail=0" ] && ok=yes
record "F01 flows (0026_flows.sql) -> PASS 19/0" "$ok" "$res $(grep '|fail|' "$TMP/f1.out" | tr '\n' ' ' | cut -c1-900) $(tailof "$TMP/f1.out")"

# ---- 7) التزامن بجلستين حقيقيتين، مع إثبات التداخل (overlap: OV=yes) ----
# K01 الحذف الأول ↔ التفعيل: التفعيل بيستنى قفل المنتج، والـ trigger بيرفض 45705.
P=$(mkp k1); G=$(img "$P" 1 0 true)
overlap k1 "$(own_txt "$(delsql "$P" "$G")" 2.5)" "$(pgs_txt "update public.products set is_active = true where id = $P" 0)"
fin=$(q "select x.is_active::text || ',' || (select pg_catalog.count(*) from public.product_images i where i.product_id = $P) from public.products x where x.id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k1h.out" '"deleted_image_id"' && has "$TMP/k1w.out" '45705' && [ "$fin" = "false,0" ] && ok=yes
record "K01 delete last image (hidden) holds the product, activation waits (overlap seen) -> 45705; product hidden, no images" "$ok" "ov=$OV $(kd k1 "$fin")"
# K02 التفعيل الأول ↔ الحذف: الحذف بيستنى for update، وبعد الـ commit بيرفض 45702.
P=$(mkp k2); G=$(img "$P" 2 0 true)
overlap k2 "$(pgs_txt "update public.products set is_active = true where id = $P" 2.5)" "$(own_txt "$(delsql "$P" "$G")" 0)"
fin=$(q "select x.is_active::text || ',' || (select pg_catalog.count(*) from public.product_images i where i.product_id = $P and i.is_primary) from public.products x where x.id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k2w.out" '45702' && [ "$fin" = "true,1" ] && ok=yes
record "K02 activation holds the product, delete of the last image waits (overlap seen) -> 45702; visible with its primary" "$ok" "ov=$OV $(kd k2 "$fin")"
# K03 حذفين لآخر صورتين في منتج ظاهر: التاني بيستنى صف المنتج، وبعده بيعدّ من جديد -> 45702.
P=$(mkp k3); A=$(img "$P" 3 0 true); B=$(img "$P" 4 1 false); q "update public.products set is_active = true where id = $P" > /dev/null
overlap k3 "$(own_txt "$(delsql "$P" "$A")" 2.5)" "$(own_txt "$(delsql "$P" "$B")" 0)"
fin=$(q "select x.is_active::text || ',' || (select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text, ',') from public.product_images i where i.product_id = $P) from public.products x where x.id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k3h.out" '"promoted_image_id"' && has "$TMP/k3w.out" '45702' && [ "$fin" = "true,$B:true" ] && ok=yes
record "K03 two deletes of the last two images (visible), second waits (overlap seen) and recounts -> 45702; one primary left" "$ok" "ov=$OV $(kd k3 "$fin")"
# K04 حذف ↔ zell_set_primary_product_image (ماسكة الصور).
P=$(mkp k4); A=$(img "$P" 5 0 true); B=$(img "$P" 6 1 false); C=$(img "$P" 7 2 false)
overlap k4 "$(svc_txt "select public.zell_set_primary_product_image($P, $B)" 2.5)" "$(own_txt "$(delsql "$P" "$C")" 0)"
fin=$(q "select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text, ',' order by i.id) from public.product_images i where i.product_id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k4w.out" '"deleted_image_id"' && [ "$fin" = "$A:false,$B:true" ] && ok=yes
record "K04 delete waits on images held by zell_set_primary_product_image (overlap seen), then deletes; exactly one primary" "$ok" "ov=$OV $(kd k4 "$fin")"
# K05 حذف ↔ zell_reorder_product_images.
P=$(mkp k5); A=$(img "$P" 8 0 true); B=$(img "$P" 9 1 false); C=$(img "$P" 10 2 false)
overlap k5 "$(svc_txt "select public.zell_reorder_product_images($P, array[$C, $B, $A]::bigint[])" 2.5)" "$(own_txt "$(delsql "$P" "$B")" 0)"
fin=$(q "select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text || ':' || i.sort_order, ',' order by i.id) from public.product_images i where i.product_id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k5w.out" '"deleted_image_id"' && [ "$fin" = "$A:true:2,$C:false:0" ] && ok=yes
record "K05 delete waits on images held by zell_reorder_product_images (overlap seen), then deletes; order kept, one primary" "$ok" "ov=$OV $(kd k5 "$fin")"
# K06 حذف صورة ↔ zell_product_delete لنفس المنتج: بعد commit حذف المنتج -> 45701.
P=$(mkp k6); A=$(img "$P" 11 0 true); U=$(q "select updated_at::text from public.products where id = $P")
overlap k6 "$(own_txt "select public.zell_product_delete($P, '$U'::timestamptz)::text" 2.5)" "$(own_txt "$(delsql "$P" "$A")" 0)"
fin=$(q "select pg_catalog.count(*) from public.products where id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k6w.out" '45701' && [ "$fin" = "0" ] && ok=yes
record "K06 image delete waits on zell_product_delete holding the product (overlap seen) -> 45701; product gone" "$ok" "ov=$OV $(kd k6 "$fin")"
# K07 جملة التراجع المشروطة ↔ zell_set_primary_product_image (§٥-ج): بتستنى قفل الصف، وبعد الـ commit صفر.
P=$(mkp k7); X=$(img "$P" 12 0 false)
overlap k7 "$(svc_txt "select public.zell_set_primary_product_image($P, $X)" 2.5)" "$(svc_txt "with d as (delete from public.product_images where id = $X and is_primary = false returning 1) select 'deleted=' || pg_catalog.count(*) from d" 0)"
fin=$(q "select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text, ',') from public.product_images i where i.product_id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k7w.out" 'deleted=0' && [ "$fin" = "$X:true" ] && ok=yes
record "K07 conditional rollback delete waits on set_primary's row lock (overlap seen), re-checks -> 0 rows; image stays primary" "$ok" "ov=$OV $(kd k7 "$fin")"
# K08 حذف الرئيسية ماسك المنتج ↔ إضافة صورة (FK key share) بتستنى؛ البديل من الصور اللي كانت موجودة.
P=$(mkp k8); A=$(img "$P" 13 0 true); B=$(img "$P" 14 1 false); q "update public.products set is_active = true where id = $P" > /dev/null
overlap k8 "$(own_txt "$(delsql "$P" "$A")" 2.5)" "$(svc_txt "insert into public.product_images (product_id, object_path, kind, sort_order, is_primary, fit) values ($P, 'products/$P/ci26-k-x8.jpg', 'gallery', 0, false, 'contain') returning 'inserted=' || id" 0)"
X=$(q "select id from public.product_images where object_path = 'products/$P/ci26-k-x8.jpg'")
fin=$(q "select x.is_active::text || ',' || (select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text, ',' order by i.id) from public.product_images i where i.product_id = $P) from public.products x where x.id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k8h.out" "\"promoted_image_id\": $B" && has "$TMP/k8w.out" 'inserted=' && [ -n "$X" ] && [ "$fin" = "true,$B:true,$X:false" ] && ok=yes
record "K08 delete of the primary holds the product, image insert waits on the FK (overlap seen); promotion from the existing images; one primary" "$ok" "ov=$OV $(kd k8 "$fin")"
# K09 إضافة صورة لسه ما اتعملها commit ↔ حذف الرئيسية بيستنى؛ بعد الـ commit الصورة الجديدة جزء من البدائل.
P=$(mkp k9); A=$(img "$P" 15 0 true); B=$(img "$P" 16 1 false); q "update public.products set is_active = true where id = $P" > /dev/null
overlap k9 "$(svc_txt "insert into public.product_images (product_id, object_path, kind, sort_order, is_primary, fit) values ($P, 'products/$P/ci26-k-x9.jpg', 'gallery', 0, false, 'contain')" 2.5)" "$(own_txt "$(delsql "$P" "$A")" 0)"
X=$(q "select id from public.product_images where object_path = 'products/$P/ci26-k-x9.jpg'")
fin=$(q "select x.is_active::text || ',' || (select pg_catalog.string_agg(i.id::text || ':' || i.is_primary::text, ',' order by i.id) from public.product_images i where i.product_id = $P) from public.products x where x.id = $P")
ok=no; [ "$OV" = yes ] && has "$TMP/k9w.out" "\"promoted_image_id\": $X" && [ "$fin" = "true,$B:false,$X:true" ] && ok=yes
record "K09 uncommitted image insert holds the FK lock, delete of the primary waits (overlap seen); new image counted, promoted by (sort_order, id); one primary" "$ok" "ov=$OV $(kd k9 "$fin")"
# K10 سجل لنفس المسار لسه ما اتعملش له commit: تسجيل الملف بيستنى لحد lock_timeout -> 45704، ومفيش تغيير.
P=$(mkp k10); A=$(img "$P" 17 0 true); B=$(img "$P" 18 1 false); PB=$(q "select object_path from public.product_images where id = $B")
overlap k10 "$(svc_txt "insert into public.storage_orphans (bucket, object_path, reason) values ('product-images', '$PB', 'insert_failed')" 4)" "$(own_txt "$(delsql "$P" "$B")" 0)"
fin=$(q "select (select pg_catalog.count(*) from public.product_images i where i.id = $B) || ',' || (select o.reason from public.storage_orphans o where o.object_path = '$PB')")
ok=no; [ "$OV" = yes ] && has "$TMP/k10w.out" '45704' && has "$TMP/k10w.out" 'orphan_insert' && [ "$fin" = "1,insert_failed" ] && ok=yes
record "K10 orphan record for the path not yet committed: delete waits (overlap seen) until lock_timeout -> 45704 (orphan_insert); image kept" "$ok" "ov=$OV $(kd k10 "$fin")"
ok=yes
for k in k1 k2 k3 k4 k5 k6 k7 k8 k9 k10; do if grep -qE '40P01|deadlock' "$TMP/${k}h.out" "$TMP/${k}w.out"; then ok=no; fi; done
record "K11 log scan of K01..K10: no deadlock" "$ok" "$(grep -lE '40P01|deadlock' "$TMP"/k*.out 2> /dev/null | tr '\n' ' ')"

# ---- 8) الرجوع ثم إعادة التطبيق ----
ORPH=$(q "select pg_catalog.count(*) || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t")
run_file "$ROLLBACK" "$TMP/rb1.out"
ok=no; has "$TMP/rb1.out" 'ZELL_0026_RB_APPROVAL_MISSING' && [ "$(state)" = "$ST1" ] && ok=yes
record "RB1 rollback without the approval line -> ZELL_0026_RB_APPROVAL_MISSING, still applied" "$ok" "$(tailof "$TMP/rb1.out")"
with_appr "$ROLLBACK" 'ci-0026-rollback' | pg_in "$TMP/rb2.out"; rc=$?
ok=no; [ "$rc" = "0" ] && [ "$(state)" = "$ST0" ] && [ "$(q "select pg_catalog.count(*) || ':' || pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t")" = "$ORPH" ] && ok=yes
record "RB2 rollback with the approval line -> back to the pre-0026 state; storage_orphans untouched" "$ok" "rc=$rc state=$(state) before=$ST0 $(tailof "$TMP/rb2.out")"
res=$(summary_of "$VERIFY" v2)
ok=no; case "$res" in "rc=0 FAIL|"*) ok=yes ;; esac
record "V02 verify after rollback -> FAIL (not applied)" "$ok" "$res"
impact_v r
ok=no; imp_valid r && [ "$(imp_f r 1)" = "false|false" ] && [ "$(imp_f r 11)" = "$(imp_f b 11)" ] && [ "$(imp_f r 12)" = "$(imp_f b 12)" ] && ok=yes
record "M04 impact after rollback: grants (col 11) and policies (col 12) identical to before 0026 (UPDATE product_id restored)" "$ok" "$(imp_detail r)"
with_appr "$ROLLBACK" 'ci-0026-rollback-again' | pg_in "$TMP/rb3.out"
ok=no; has "$TMP/rb3.out" 'ZELL_0026_RB_NOT_APPLIED' && [ "$(state)" = "$ST0" ] && ok=yes
record "RB3 rollback again -> ZELL_0026_RB_NOT_APPLIED, nothing changed" "$ok" "$(tailof "$TMP/rb3.out")"
res=$(summary_of "$PTEST" p3)
ok=no; [ "$res" = "rc=0 PASS|pass=6 fail=0" ] && ok=yes
record "P03 ptest after rollback -> PASS 6/0" "$ok" "$res $(tailof "$TMP/p3.out")"
with_appr "$APPLY" 'ci-0026-reapply' | pg_in "$TMP/ra1.out"; rc=$?
ok=no; [ "$rc" = "0" ] && [ "$(state)" = "$ST1" ] && ok=yes
record "RA1 re-apply after rollback -> applied" "$ok" "rc=$rc state=$(state) $(tailof "$TMP/ra1.out")"
res=$(summary_of "$VERIFY" v3)
ok=no; [ "$res" = "rc=0 PASS|pass=9 fail=0" ] && ok=yes
record "V03 verify after re-apply -> PASS 9/0" "$ok" "$res"

finish
