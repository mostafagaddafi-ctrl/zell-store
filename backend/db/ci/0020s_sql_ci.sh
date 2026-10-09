#!/usr/bin/env bash
# 0020-S — اختبار SQL الدائم في CI (PR-1): Postgres 17 مؤقت + shim شبه Supabase (نفس أسلوب 0021p_sql_ci.sh).
# الداتابيز: admin_users + أقل شكل من جداول المتجر اللي preflight 0020 والبصمة بتاعته محتاجينه (مش نسخة من المتجر)
#   ← 0020_inventory_purchasing.sql الحقيقي ← 0020-S.
# بيغطي: شكل المعاملة في الـ ptest والـ verify · md5 الجسم · verify قبل التطبيق · ptest (ci · production · production من غير أدمن)
# · مفيش أثر بعد الـ ptest · التطبيق · رفض إعادة التطبيق · الـ ptest بيرفض بعد التطبيق · verify · نداءات زي PostgREST
# · rollback 0020 بيرفض طول ما 0020-S متطبّق · rollback 0020-S (من غير تأكيد · بعد PR-3 · نضيف) · إعادة التطبيق
# · rollback 0020 بيشتغل بعد rollback 0020-S · statement_timeout (مستند 100 سطر بجلسة authenticated تحت القيمة المعتمدة 8s)
# · ملفي 0020 بعد التعديل = النسخة القديمة بالحرف من غير 0020-S (blobs متثبتة) · 0020-S ناقص.
# · PR-3 (S19): ptest (ci · production) · جزئي = رفض · التطبيق · رفض الإعادة · verify (pr3) · rollback بالترتيب.
# ممنوع يتشغّل على أي داتابيز غير الحاوية المؤقتة.
set -uo pipefail

if [ "$(printenv ZELL_CI_DISPOSABLE_DB)" != "yes" ]; then
  echo "refusing: disposable CI database only" >&2
  exit 2
fi
case "$(printenv PGHOST)" in
  localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be localhost" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIG="$ROOT/backend/db/migrations"
BASE="$MIG/0020_inventory_purchasing.sql"
BASE_RB="$MIG/0020_inventory_purchasing_rollback.sql"
APPLY="$MIG/0020s_inv_session.sql"
PTEST="$MIG/0020s_inv_session_ptest.sql"
VERIFY="$MIG/0020s_inv_session_verify.sql"
ROLLBACK="$MIG/0020s_inv_session_rollback.sql"
SHAPE="$ROOT/backend/db/ci/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER)"
if [ -z "$SUPER" ]; then SUPER=supabase_admin; fi
DB="zell_ci_0020s"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
A='00000000-0000-0000-0000-00000000000a'
X='00000000-0000-0000-0000-00000000000c'
Y='00000000-0000-0000-0000-00000000000d'
ATTEST="panel-not-calling-session-functions"
# القيمة المعتمدة لـ statement_timeout بتاع دور authenticated (الـ ptest بيتأكد إن Production مش أقل منها).
APPROVED_AUTH_TIMEOUT="8s"
BASE_VERIFY="$MIG/0020_inventory_purchasing_verify.sql"
# نسخ ملفي 0020 القديمين قبل الـ PR ده (blob على main 5b851ce): للمقارنة بالحرف لما 0020-S مش متطبّق.
LEGACY_VERIFY_BLOB="6e137fa9b11be74f1abdc5a17c304856d4a44b40"
LEGACY_RB_BLOB="186b4addcb2e2b139bb2e8ecfbcb9e754abe49dd"
PR3_APPLY="$MIG/0020s_pr3_revoke_service_role.sql"
PR3_PTEST="$MIG/0020s_pr3_ptest.sql"
PR3_RB="$MIG/0020s_pr3_rollback.sql"
SVC_OLD_SQL="select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%' and p.proname not like 'zell\_inv\_session\_%' and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')"
svc_old() { q "$SVC_OLD_SQL"; }
attested_pr3_rollback() {
  sed "0,/^begin;\$/s//begin;\nset local zell.rollback_attest = 'restore-service-role-execute';/" "$PR3_RB" | run_stdin "$1"
}

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
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" > "$2" 2>&1; }
run_stdin() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$1" 2>&1; }
has() { grep -q -- "$2" "$1"; }
# نداء زي PostgREST: دور authenticated + claims الجلسة. بيطبع الخرج كله (آخر سطر = النتيجة لو نجح).
as_user() {
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" \
    -c "set role authenticated; select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) is null; $2" 2>&1
}
as_service() {
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -c "set role service_role; $1" 2>&1
}
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
attested_rollback() {
  sed "0,/^begin;\$/s//begin;\nset local zell.rollback_attest = '$ATTEST';/" "$ROLLBACK" | run_stdin "$1"
}

# الـ ptest / verify بيرجّعوا صفوف: أول صف ord=0 هو الملخص (فاصل |).
#   ptest: 7 profile · 8 pass · 9 fail · 10 skip · 11 verdict · 14 expected_skips · 15 actual_skips · 16-19 التوقيت
#   verify: 7 stage · 8 pass · 9 fail · 10 skip · 11 verdict · 15 actual_skips · 16 old_fp
run_rows() {
  run_file "$1" "$2"
  RC=$?
  SUMMARY=$(grep -m 1 '^0|summary|' "$2")
  echo "rows $(basename "$1"): exit=$RC summary=$SUMMARY"
  grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|fail\|' "$2" | head -n 30
}
sf() { printf '%s' "$SUMMARY" | cut -d'|' -f"$1"; }
tail5() { tail -n 5 "$1" | cut -c1-400; }

RESIDUE_SQL=$(cat <<'SQL'
select
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_session\_%') as session_fns,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_inv_claims_actor') as claims_fn,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') as inv_fns,
 (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || p.proowner::regrole::text
                                 || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || p.provolatile::text
                                 || ':' || coalesce(p.proconfig::text, ''), ',' order by p.oid::regprocedure::text), ''))
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
     and p.proname not like 'zell\_inv\_session\_%' and p.proname <> 'zell_inv_claims_actor') as old_fp,
 (select count(*) from public.suppliers) + (select count(*) from public.purchase_docs) + (select count(*) from public.opening_stock_docs)
   + (select count(*) from public.stock_lots) + (select count(*) from public.inventory_commands)
   + (select count(*) from public.inventory_audit_log) as inv_rows,
 (select count(*) from public.inventory_locations) as locations,
 (select count(*) from pg_catalog.pg_stat_activity where state like 'idle in transaction%' and pid <> pg_catalog.pg_backend_pid()) as idle_tx;
SQL
)
residue() { q "$RESIDUE_SQL"; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }

# الـ sequences: last_value لكل sequence في public (NULL = 0)، والفرق بين لقطتين (غير الصفر بس).
SEQ_SQL="select coalesce(string_agg(s.sequencename || '=' || coalesce(s.last_value, 0), ' ' order by s.sequencename), '') from pg_catalog.pg_sequences s where s.schemaname = 'public'"
seqs() { q "$SEQ_SQL"; }
seq_delta() {
  printf '%s\n%s\n' "$1" "$2" | awk 'NR == 1 {for (i = 1; i <= NF; i++) {split($i, a, "="); b[a[1]] = a[2]}}
    NR == 2 {o = ""; for (i = 1; i <= NF; i++) {split($i, a, "="); d = a[2] - b[a[1]]; if (d != 0) {o = o a[1] "=+" d " "}} print o}'
}
seq_of() { printf '%s' "$1" | tr ' ' '\n' | awk -F= -v n="$2" '$1 == n {print substr($2, 2)}'; }
# سطور ERROR بس (من غير اسم الملف ورقم السطر)، للمقارنة بين نسختين.
err_lines() { grep 'ERROR:' "$1" | sed 's/^.*ERROR:/ERROR:/'; }

# مستند 100 سطر بجلسة authenticated زي PostgREST: كل نداء جملة لوحدها، تحت statement_timeout = $1.
big_doc() {
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -v to="$1" -v owner="$A" -f - 2>&1 <<'SQL'
\timing on
select pg_catalog.set_config('zell.big_doc', (select jsonb_build_object('locationId', l.id,
  'docDate', to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD'), 'supplierDiscountPiastres', 37,
  'lines', (select jsonb_agg(jsonb_build_object('kind', 'batch', 'productId', 1, 'quantity', 1, 'lineTotalPiastres', 100))
              from generate_series(1, 100)))::text
  from public.inventory_locations l where l.code = 'MAIN'), false) is null;
set role authenticated;
select pg_catalog.set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, false) is null;
set statement_timeout = :'to';
select 'PREVIEW_OK' from (select public.zell_inv_session_preview_purchase(pg_catalog.current_setting('zell.big_doc')::jsonb) as r) x where x.r is not null;
select pg_catalog.set_config('zell.doc_id', public.zell_inv_session_create_purchase(gen_random_uuid(), pg_catalog.current_setting('zell.big_doc')::jsonb) ->> 'docId', false) is null;
select 'POST_' || (public.zell_inv_session_post_purchase(gen_random_uuid(), pg_catalog.current_setting('zell.doc_id')::bigint, 1) ->> 'status');
SQL
}

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
grant anon, authenticated, service_role to postgres;
-- القيمة المعتمدة لدور authenticated (PostgREST بيطبّق إعداد الدور على كل request).
alter role authenticated set statement_timeout = '8s';
SQL
}

# reset_db "uuid:role:active" ...
reset_db() {
  local spec id role active n=0
  su_sql postgres "drop database if exists $DB with (force)"
  su_sql postgres "drop role if exists zell_inventory_definer"
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
-- أقل شكل بيعدّي preflight 0020 والبصمة بتاعته: الأعمدة والقيود اللي بيفحصها بالاسم، و zell_set_product_widths بترتيب القفل.
create table public.products (
  id integer primary key,
  name_ar text not null,
  sale_unit text not null default 'meter' constraint products_sale_unit_check check (sale_unit in ('meter', 'piece')),
  width_cm integer,
  price_per_meter_piastres integer not null default 0,
  is_active boolean not null default true
);
create table public.product_widths (
  product_id integer not null references public.products (id),
  width_cm integer not null,
  is_active boolean not null default true,
  constraint product_widths_product_width_key unique (product_id, width_cm)
);
create table public.orders (id bigserial primary key, status text not null default 'new', total_piastres bigint not null default 0);
create function public.zell_orders_cancelled_final()
returns trigger language plpgsql set search_path = '' as $f$
begin
  return new;
end
$f$;
-- rollback 0020 بيتأكد إن الـ trigger الوحيد الباقي في public هو ده (من 0019).
create trigger orders_cancelled_final before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();
create table public.order_items (id bigserial primary key);
create table public.product_addons (id bigserial primary key);
create table public.coupons (id bigserial primary key);
create table public.settings (key text primary key, value jsonb not null default '{}'::jsonb);
create function public.zell_set_product_widths(p_product_id integer, p_widths jsonb)
returns void language plpgsql set search_path = '' as $f$
begin
  perform 1 from public.products p where p.id = p_product_id for update;
  delete from public.product_widths w where w.product_id = p_product_id;
end
$f$;
insert into public.products (id, name_ar, sale_unit, width_cm, price_per_meter_piastres)
values (1, 'قطعة اختبار', 'piece', null, 0), (2, 'فيلم اختبار', 'meter', 100, 15000);
SQL
  for spec in "$@"; do
    n=$((n + 1))
    IFS=: read -r id role active <<< "$spec"
    q "insert into public.admin_users (user_id, role, is_active, created_at) values ('$id', '$role', $active, timestamptz '2026-01-01' + interval '$n minute')" > /dev/null
  done
}

echo "server_version: $(psql -X -tA -U "$SUPER" -d postgres -c 'show server_version')"
echo "client: $(psql --version)"
init_cluster

# ── S0: شكل المعاملة (begin … SELECT واحد قبل rollback، من غير commit) ──
ok=no; if python3 "$SHAPE" "$PTEST" > "$TMP/shape_ptest.out" 2>&1; then ok=yes; fi
cat "$TMP/shape_ptest.out"
record "S0a ptest transaction shape" "$ok" "$(tail5 "$TMP/shape_ptest.out")"
ok=no; if python3 "$SHAPE" "$VERIFY" > "$TMP/shape_verify.out" 2>&1; then ok=yes; fi
cat "$TMP/shape_verify.out"
record "S0b verify transaction shape" "$ok" "$(tail5 "$TMP/shape_verify.out")"

# ── S1: الـ ptest فيه نفس جسم الـ migration بالحرف ──
m1=$(body_md5 "$APPLY" "0020S BODY"); m2=$(body_md5 "$PTEST" "0020S BODY")
ok=no; if [ "$m1" = "$m2" ] && [ "$m1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S1 ptest body md5 = migration ($m1)" "$ok" "migration=$m1 ptest=$m2"

ok=no; if python3 "$SHAPE" "$PR3_PTEST" > "$TMP/shape_pr3.out" 2>&1; then ok=yes; fi
cat "$TMP/shape_pr3.out"
record "S0c PR-3 ptest transaction shape" "$ok" "$(tail5 "$TMP/shape_pr3.out")"
p1=$(body_md5 "$PR3_APPLY" "0020S3 BODY"); p2=$(body_md5 "$PR3_PTEST" "0020S3 BODY")
ok=no; if [ "$p1" = "$p2" ] && [ "$p1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S1b PR-3 ptest body md5 = migration ($p1)" "$ok" "migration=$p1 ptest=$p2"

# ── S2: 0020 الحقيقي بيتطبّق على الـ shim ──
reset_db "$A:owner:true" "$X:admin:true" "$Y:admin:false"
ok=no; if run_file "$BASE" "$TMP/base.out"; then ok=yes; fi
record "S2 0020_inventory_purchasing.sql applies on the CI shim" "$ok" "$(tail5 "$TMP/base.out")"
if [ "$ok" != "yes" ]; then
  cat "$TMP/base.out" | tail -n 40
  echo "ZELL_0020S_SQL_CI_RESULT pass=$PASS fail=$FAIL (stopped: base 0020 did not apply)"
  exit 1
fi
R0=$(residue)
echo "residue before: $R0"

# ── S3: verify قبل التطبيق = صفوف + FAIL، و exit 0 ──
run_rows "$VERIFY" "$TMP/verify_pre.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 2)" = "summary" ] && [ "$(sf 11)" = "FAIL" ]; then ok=yes; fi
record "S3 verify before apply: rows returned, verdict FAIL, exit 0" "$ok" "exit=$RC summary=$SUMMARY $(tail5 "$TMP/verify_pre.out")"

# ── S3b: verify 0020 (بعد التعديل) قبل 0020-S: نفس النتيجة القديمة، من غير علامة 0020-S ──
run_file "$BASE_VERIFY" "$TMP/base_verify_pre.out"
ok=no; if has "$TMP/base_verify_pre.out" "ZELL_0020_VERIFY_RESULT part_a=ok" && ! has "$TMP/base_verify_pre.out" "0020s="; then ok=yes; fi
record "S3b 0020 verify before 0020-S: part_a=ok, no 0020-S marker" "$ok" "$(err_lines "$TMP/base_verify_pre.out" | cut -c1-200)"

# ── S4: ptest (ci) قبل التطبيق، ومفيش أثر بعده ──
sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = 'ci';/" "$PTEST" > "$TMP/ptest_ci.sql"
run_rows "$TMP/ptest_ci.sql" "$TMP/ptest_ci.out"
ok=no; if grep -qx "set local zell.ptest_profile = 'ci';" "$TMP/ptest_ci.sql" && [ "$RC" -eq 0 ] && [ "$(sf 7)" = "ci" ] \
  && [ "$(sf 11)" = "PASS" ] && [ "$(sf 9)" = "0" ] && [ "$(sf 10)" = "0" ] && [ "$(sf 16)" = "$APPROVED_AUTH_TIMEOUT" ]; then ok=yes; fi
record "S4a ptest profile=ci: verdict PASS, fail=0, skip=0 (pass=$(sf 8), auth_timeout=$(sf 16), big_preview_ms=$(sf 18), big_post_ms=$(sf 19))" "$ok" "exit=$RC summary=$SUMMARY $(tail5 "$TMP/ptest_ci.out")"
R1=$(residue)
ok=no; if [ "$R1" = "$R0" ]; then ok=yes; fi
record "S4b no residue after ptest (functions, old fingerprint, inventory rows, idle tx)" "$ok" "before=$R0 after=$R1"

# ── S5: ptest (production): مستندات صغيرة بس (T02 = CI بس)، بأدمن ومن غير أدمن، وعدد الـ sequences ──
SQ0=$(seqs)
run_rows "$PTEST" "$TMP/ptest_prod.out"
SQ1=$(seqs)
SEQD=$(seq_delta "$SQ0" "$SQ1")
echo "SEQ_DELTA_PRODUCTION_PROFILE $SEQD"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 7)" = "production" ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 15)" = "T02" ] && [ "$(sf 16)" = "$APPROVED_AUTH_TIMEOUT" ]; then ok=yes; fi
record "S5a ptest profile=production (owner A + admin X): PASS, skip T02 only, timeout read $(sf 16) (pass=$(sf 8))" "$ok" "exit=$RC summary=$SUMMARY"
bl=$(seq_of "$SEQD" batch_lot_seq); rl=$(seq_of "$SEQD" roll_lot_seq)
if [ -z "$bl" ]; then bl=0; fi
if [ -z "$rl" ]; then rl=0; fi
ok=no; if [ "$bl" -le 2 ] && [ "$rl" -eq 0 ]; then ok=yes; fi
record "S5c production profile uses small documents only (batch_lot_seq +$bl <= 2, roll_lot_seq +$rl = 0) :: $SEQD" "$ok" "$SEQD"
q "update public.admin_users set is_active = false where user_id = '$X'" > /dev/null
run_rows "$PTEST" "$TMP/ptest_prod_b.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 15)" = "R04,T02" ]; then ok=yes; fi
record "S5b ptest profile=production (owner A only): PASS, skips R04,T02 only" "$ok" "exit=$RC summary=$SUMMARY"
q "update public.admin_users set is_active = true where user_id = '$X'" > /dev/null

# ── S6: التطبيق ──
ok=no; if run_file "$APPLY" "$TMP/apply.out"; then ok=yes; fi
R2=$(residue)
if [ "$ok" = "yes" ] && [ "$(rf "$R2" 1)" = "23" ] && [ "$(rf "$R2" 2)" = "1" ] && [ "$(rf "$R2" 3)" = "67" ] \
  && [ "$(rf "$R2" 4)" = "$(rf "$R0" 4)" ] && [ "$(rf "$R2" 5)" = "$(rf "$R0" 5)" ]; then :; else ok=no; fi
record "S6 apply: 23 session fns + claims_actor, zell_inv_% = 67, old fingerprint and data unchanged" "$ok" "residue=$R2 $(tail5 "$TMP/apply.out")"

# ── S7: إعادة التطبيق بترفض، والـ ptest بيرفض بعد التطبيق ──
ok=no; if ! run_file "$APPLY" "$TMP/apply2.out" && has "$TMP/apply2.out" "ZELL_0020S_ALREADY_APPLIED"; then ok=yes; fi
record "S7a re-apply refused (ZELL_0020S_ALREADY_APPLIED)" "$ok" "$(tail5 "$TMP/apply2.out")"
ok=no; if ! run_file "$PTEST" "$TMP/ptest_after.out" && has "$TMP/ptest_after.out" "ZELL_0020S_PTEST_PRE_APPLY_ONLY"; then ok=yes; fi
record "S7b ptest after apply refused (ZELL_0020S_PTEST_PRE_APPLY_ONLY)" "$ok" "$(tail5 "$TMP/ptest_after.out")"

# ── S8: verify ──
run_rows "$VERIFY" "$TMP/verify.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 9)" = "0" ] && [ "$(sf 16)" = "$(rf "$R0" 4)" ]; then ok=yes; fi
record "S8 verify after apply: PASS (pass=$(sf 8)), old_fp = before apply" "$ok" "exit=$RC summary=$SUMMARY"

# ── S8b: verify 0020 (بعد التعديل) بعد 0020-S: part_a=ok + علامة 0020-S ──
run_file "$BASE_VERIFY" "$TMP/base_verify_post.out"
ok=no; if has "$TMP/base_verify_post.out" "ZELL_0020_VERIFY_RESULT part_a=ok" && has "$TMP/base_verify_post.out" "0020s=applied"; then ok=yes; fi
record "S8b 0020 verify after 0020-S: part_a=ok, marker 0020s=applied" "$ok" "$(err_lines "$TMP/base_verify_post.out" | cut -c1-200)"

# ── S9: نداءات زي PostgREST ──
o_new=$(as_user "$A" "select public.zell_inv_session_list_locations(true, 50, null)" | tail -n 1)
o_old=$(as_service "select public.zell_inv_list_locations('$A'::uuid, true, 50, null)" | tail -n 1)
ok=no; case "$o_new" in "{"*) if [ "$o_new" = "$o_old" ]; then ok=yes; fi ;; esac
record "S9a owner via session = old path via service_role" "$ok" "new=$(printf '%s' "$o_new" | cut -c1-160) old=$(printf '%s' "$o_old" | cut -c1-160)"
out=$(as_user "$X" "select public.zell_inv_session_list_locations(true, 50, null)")
ok=no; case "$out" in *45200*) ok=yes ;; esac
record "S9b admin (not owner) via session -> 45200" "$ok" "$(printf '%s' "$out" | tail -n 3 | cut -c1-200)"
out=$(as_service "select public.zell_inv_session_list_locations(true, 50, null)")
ok=no; case "$out" in *42501*) ok=yes ;; esac
record "S9c service_role on session function -> 42501" "$ok" "$(printf '%s' "$out" | tail -n 3 | cut -c1-200)"
out=$(as_user "$A" "select public.zell_inv_list_locations('$A'::uuid, true, 50, null)")
ok=no; case "$out" in *42501*) ok=yes ;; esac
record "S9d authenticated on old function (owner p_actor) -> 42501" "$ok" "$(printf '%s' "$out" | tail -n 3 | cut -c1-200)"

# ── S10: rollback 0020 بيرفض طول ما 0020-S متطبّق، برسالة صريحة ──
ok=no; if ! run_file "$BASE_RB" "$TMP/base_rb1.out" && has "$TMP/base_rb1.out" "ZELL_0020_ROLLBACK_0020S_FIRST" \
  && [ "$(rf "$(residue)" 1)" = "23" ]; then ok=yes; fi
record "S10 0020 rollback refused while 0020-S is applied (ZELL_0020_ROLLBACK_0020S_FIRST)" "$ok" "$(err_lines "$TMP/base_rb1.out" | cut -c1-200)"

# ── S11: rollback 0020-S من غير تأكيد بيرفض ──
ok=no; if ! run_file "$ROLLBACK" "$TMP/rb_noattest.out" && has "$TMP/rb_noattest.out" "ZELL_0020S_ROLLBACK_ATTEST" \
  && [ "$(rf "$(residue)" 1)" = "23" ]; then ok=yes; fi
record "S11 rollback without attest refused, nothing changed" "$ok" "$(tail5 "$TMP/rb_noattest.out")"

# ── S12: rollback 0020-S بيرفض لو PR-3 متطبّق (service_role مالوش EXECUTE على القديمة) ──
q "set role zell_inventory_definer; revoke execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) from service_role; reset role" > "$TMP/pr3_sim.out"
ok=no; if ! attested_rollback "$TMP/rb_pr3.out" && has "$TMP/rb_pr3.out" "ZELL_0020S_ROLLBACK_PR3_ACTIVE" \
  && [ "$(rf "$(residue)" 1)" = "23" ]; then ok=yes; fi
record "S12 rollback refused while PR-3 is active (grants first)" "$ok" "$(cat "$TMP/pr3_sim.out") $(tail5 "$TMP/rb_pr3.out")"
q "set role zell_inventory_definer; grant execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) to service_role; reset role" > /dev/null

# ── S13: rollback نضيف ──
ok=no; if attested_rollback "$TMP/rb.out"; then ok=yes; fi
R3=$(residue)
if [ "$ok" = "yes" ] && [ "$(rf "$R3" 1)" = "0" ] && [ "$(rf "$R3" 2)" = "0" ] && [ "$(rf "$R3" 3)" = "43" ] \
  && [ "$(rf "$R3" 4)" = "$(rf "$R0" 4)" ]; then :; else ok=no; fi
record "S13 attested rollback: session fns gone, zell_inv_% = 43, old fingerprint = before apply" "$ok" "residue=$R3 $(tail5 "$TMP/rb.out")"
o_old=$(as_service "select public.zell_inv_list_locations('$A'::uuid, true, 50, null)" | tail -n 1)
ok=no; case "$o_old" in "{"*) ok=yes ;; esac
record "S13b old path still works after rollback" "$ok" "$(printf '%s' "$o_old" | cut -c1-160)"

# ── S14: إعادة التطبيق بعد الرجوع + verify ──
ok=no; if run_file "$APPLY" "$TMP/apply3.out"; then ok=yes; fi
run_rows "$VERIFY" "$TMP/verify3.out"
if [ "$ok" = "yes" ] && [ "$(sf 11)" = "PASS" ]; then :; else ok=no; fi
record "S14 re-apply after rollback + verify PASS" "$ok" "summary=$SUMMARY $(tail5 "$TMP/apply3.out")"

# ── S19: 0020-S PR-3 (سحب EXECUTE من service_role على الـ 23 القديمة). الحالة هنا: PR-1 متطبّق (S14) ──
sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = 'ci';/" "$PR3_PTEST" > "$TMP/pr3_ptest_ci.sql"
run_rows "$TMP/pr3_ptest_ci.sql" "$TMP/pr3_ptest_ci.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 7)" = "ci" ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 9)" = "0" ] && [ "$(sf 10)" = "0" ]; then ok=yes; fi
record "S19a PR-3 ptest profile=ci: PASS, fail=0, skip=0 (pass=$(sf 8))" "$ok" "exit=$RC summary=$SUMMARY $(tail5 "$TMP/pr3_ptest_ci.out")"
ok=no; if [ "$(svc_old)" = "23" ]; then ok=yes; fi
record "S19b no residue after PR-3 ptest (service_role still on the old 23)" "$ok" "svc_old=$(svc_old)"
run_rows "$PR3_PTEST" "$TMP/pr3_ptest_prod.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 7)" = "production" ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 15)" = "P06" ]; then ok=yes; fi
record "S19c PR-3 ptest profile=production: PASS, skip P06 only (pass=$(sf 8))" "$ok" "exit=$RC summary=$SUMMARY"

# partial: سحب يدوي من دالة واحدة ← التطبيق بيرفض، والـ verify (0020-S و 0020) بيفشلوا. وبعدين رجوع.
q "set role zell_inventory_definer; revoke execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) from service_role; reset role" > /dev/null
ok=no; if ! run_file "$PR3_APPLY" "$TMP/pr3_partial.out" && has "$TMP/pr3_partial.out" "ZELL_0020S3_PARTIAL"; then ok=yes; fi
run_rows "$VERIFY" "$TMP/verify_partial3.out"
if [ "$(sf 11)" != "FAIL" ]; then ok=no; fi
run_file "$BASE_VERIFY" "$TMP/base_verify_partial3.out"
if ! has "$TMP/base_verify_partial3.out" "ZELL_0020_FUNCTION_ACL"; then ok=no; fi
record "S19d partial revoke: PR-3 apply refused (PARTIAL), 0020-S verify FAIL, 0020 verify FUNCTION_ACL" "$ok" "$(err_lines "$TMP/pr3_partial.out" | cut -c1-120) | verify=$(sf 11) stage=$(sf 7) | $(err_lines "$TMP/base_verify_partial3.out" | cut -c1-120)"
q "set role zell_inventory_definer; grant execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) to service_role; reset role" > /dev/null

ok=no; if run_file "$PR3_APPLY" "$TMP/pr3_apply.out" && [ "$(svc_old)" = "0" ]; then ok=yes; fi
record "S19e PR-3 apply: service_role EXECUTE on old zell_inv_* = 0" "$ok" "svc_old=$(svc_old) $(tail5 "$TMP/pr3_apply.out")"
ok=no; if ! run_file "$PR3_APPLY" "$TMP/pr3_apply2.out" && has "$TMP/pr3_apply2.out" "ZELL_0020S3_ALREADY_APPLIED"; then ok=yes; fi
record "S19f PR-3 re-apply refused (ALREADY_APPLIED)" "$ok" "$(err_lines "$TMP/pr3_apply2.out" | cut -c1-200)"
ok=no; if ! run_file "$PR3_PTEST" "$TMP/pr3_ptest_after.out" && has "$TMP/pr3_ptest_after.out" "ZELL_0020S3_PTEST_PRE_APPLY_ONLY"; then ok=yes; fi
record "S19g PR-3 ptest after apply refused (PRE_APPLY_ONLY)" "$ok" "$(err_lines "$TMP/pr3_ptest_after.out" | cut -c1-200)"
run_rows "$VERIFY" "$TMP/verify_pr3.out"
ok=no; if [ "$RC" -eq 0 ] && [ "$(sf 7)" = "pr3" ] && [ "$(sf 11)" = "PASS" ] && [ "$(sf 9)" = "0" ]; then ok=yes; fi
record "S19h 0020-S verify after PR-3: stage pr3, PASS (pass=$(sf 8))" "$ok" "exit=$RC summary=$SUMMARY"
run_file "$BASE_VERIFY" "$TMP/base_verify_pr3.out"
ok=no; if has "$TMP/base_verify_pr3.out" "ZELL_0020_VERIFY_RESULT part_a=ok" && has "$TMP/base_verify_pr3.out" "0020s=applied pr3=applied"; then ok=yes; fi
record "S19i 0020 verify after PR-3: part_a=ok, marker 0020s=applied pr3=applied" "$ok" "$(err_lines "$TMP/base_verify_pr3.out" | cut -c1-200)"
o_new=$(as_user "$A" "select public.zell_inv_session_list_locations(true, 50, null)" | tail -n 1)
out_old=$(as_service "select public.zell_inv_list_locations('$A'::uuid, true, 50, null)")
out_ses=$(as_service "select public.zell_inv_session_list_locations(true, 50, null)")
ok=no; case "$o_new" in "{"*) ok=yes ;; esac
case "$out_old" in *42501*) ;; *) ok=no ;; esac
case "$out_ses" in *42501*) ;; *) ok=no ;; esac
record "S19j PostgREST-like: owner via session ok; service_role on old -> 42501; service_role on session -> 42501" "$ok" "new=$(printf '%s' "$o_new" | cut -c1-80)"
ok=no; if ! attested_rollback "$TMP/pr1_rb_pr3.out" && has "$TMP/pr1_rb_pr3.out" "ZELL_0020S_ROLLBACK_PR3_ACTIVE"; then ok=yes; fi
record "S19k PR-1 rollback refused while PR-3 applied (grants first)" "$ok" "$(err_lines "$TMP/pr1_rb_pr3.out" | cut -c1-200)"
ok=no; if ! run_file "$PR3_RB" "$TMP/pr3_rb_noattest.out" && has "$TMP/pr3_rb_noattest.out" "ZELL_0020S3_ROLLBACK_ATTEST" && [ "$(svc_old)" = "0" ]; then ok=yes; fi
record "S19l PR-3 rollback without attest refused, nothing changed" "$ok" "$(err_lines "$TMP/pr3_rb_noattest.out" | cut -c1-200)"
ok=no; if attested_pr3_rollback "$TMP/pr3_rb.out" && [ "$(svc_old)" = "23" ]; then ok=yes; fi
run_rows "$VERIFY" "$TMP/verify_pr3_rb.out"
if [ "$(sf 7)" != "pr1" ] || [ "$(sf 11)" != "PASS" ]; then ok=no; fi
run_file "$BASE_VERIFY" "$TMP/base_verify_pr3_rb.out"
if ! has "$TMP/base_verify_pr3_rb.out" "part_a=ok" || has "$TMP/base_verify_pr3_rb.out" "pr3=applied"; then ok=no; fi
record "S19m PR-3 rollback (attested): service_role back on 23, 0020-S verify stage pr1 PASS, 0020 verify ok without pr3 marker" "$ok" "svc_old=$(svc_old) verify=$SUMMARY $(tail5 "$TMP/pr3_rb.out")"
ok=no; if attested_pr3_rollback "$TMP/pr3_rb_again.out"; then :; elif has "$TMP/pr3_rb_again.out" "ZELL_0020S3_ROLLBACK_NOT_APPLIED"; then ok=yes; fi
record "S19n PR-3 rollback when not applied refused (NOT_APPLIED)" "$ok" "$(err_lines "$TMP/pr3_rb_again.out" | cut -c1-200)"
ok=no; if run_file "$PR3_APPLY" "$TMP/pr3_apply3.out" && [ "$(svc_old)" = "0" ] && attested_pr3_rollback "$TMP/pr3_rb3.out" && [ "$(svc_old)" = "23" ]; then ok=yes; fi
record "S19o PR-3 re-apply after rollback, then rollback again (cycle)" "$ok" "svc_old=$(svc_old)"

# ── S15: الترتيب: rollback 0020-S ثم rollback 0020 بيشتغل ──
ok=no; if attested_rollback "$TMP/rb2.out" && run_file "$BASE_RB" "$TMP/base_rb2.out"; then ok=yes; fi
inv_left=$(q "select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'")
if [ "$ok" = "yes" ] && [ "$inv_left" = "0" ]; then :; else ok=no; fi
record "S15 rollback 0020-S then rollback 0020 works (zell_inv_% = 0)" "$ok" "inv_left=$inv_left $(tail5 "$TMP/base_rb2.out")"


# ── S16: statement_timeout: مستند 100 سطر بجلسة authenticated تحت القيمة المعتمدة، وإثبات إن الحد شغّال ──
reset_db "$A:owner:true" "$X:admin:true"
ok=no; if run_file "$BASE" "$TMP/base16.out" && run_file "$APPLY" "$TMP/apply16.out"; then ok=yes; fi
TO=$(q "select substring(c from '^statement_timeout=(.*)\$') from pg_catalog.pg_roles r cross join lateral unnest(coalesce(r.rolconfig, '{}'::text[])) c where r.rolname = 'authenticated' and c like 'statement\_timeout=%'")
out=$(big_doc "$TO")
times=$(printf '%s\n' "$out" | grep '^Time:' | tr '\n' ' ')
if [ "$ok" = "yes" ] && [ "$TO" = "$APPROVED_AUTH_TIMEOUT" ]; then :; else ok=no; fi
case "$out" in *PREVIEW_OK*POST_posted*) ;; *) ok=no ;; esac
case "$out" in *ERROR*) ok=no ;; esac
record "S16a big document (100 lines) via session under authenticated statement_timeout=$TO: preview + create + post ok [$times]" "$ok" "$(printf '%s' "$out" | tail -n 5 | cut -c1-300)"
out=$(big_doc "1ms")
ok=no; case "$out" in *57014*) ok=yes ;; esac
record "S16b same harness with statement_timeout=1ms -> 57014 (the limit is enforced per statement)" "$ok" "$(printf '%s' "$out" | grep ERROR | head -n 2 | cut -c1-200)"

# ── S17: ملفي 0020 بعد التعديل = النسخة القديمة بالحرف لما 0020-S مش متطبّق ──
git -C "$ROOT" cat-file -p "$LEGACY_VERIFY_BLOB" > "$TMP/legacy_verify.sql" 2> "$TMP/legacy_git.err"
git -C "$ROOT" cat-file -p "$LEGACY_RB_BLOB" > "$TMP/legacy_rb.sql" 2>> "$TMP/legacy_git.err"
ok=no; if [ -s "$TMP/legacy_verify.sql" ] && [ -s "$TMP/legacy_rb.sql" ]; then ok=yes; fi
record "S17a legacy 0020 verify / rollback loaded from pinned blobs" "$ok" "$(cat "$TMP/legacy_git.err")"
# (b) verify: نفس سطر النتيجة ونفس exit
reset_db "$A:owner:true" "$X:admin:true"
run_file "$BASE" "$TMP/base17.out"
run_file "$TMP/legacy_verify.sql" "$TMP/lv.out"; lrc=$?
run_file "$BASE_VERIFY" "$TMP/nv.out"; nrc=$?
ok=no; if [ "$lrc" = "$nrc" ] && [ "$(err_lines "$TMP/lv.out")" = "$(err_lines "$TMP/nv.out")" ] && has "$TMP/nv.out" "part_a=ok"; then ok=yes; fi
record "S17b 0020 verify without 0020-S = legacy (same result line, exit $nrc)" "$ok" "legacy=$(err_lines "$TMP/lv.out" | cut -c1-160) new=$(err_lines "$TMP/nv.out" | cut -c1-160)"
# (c) rollback فيه بيانات: نفس الرفض، ومفيش تغيير
q "set role service_role; select public.zell_inv_create_supplier('$A'::uuid, gen_random_uuid(), 'مورد اختبار', null, null) is not null" > /dev/null
run_file "$TMP/legacy_rb.sql" "$TMP/lrb_data.out"; lrc=$?
run_file "$BASE_RB" "$TMP/nrb_data.out"; nrc=$?
ok=no; if [ "$lrc" = "$nrc" ] && [ "$nrc" != "0" ] && [ "$(err_lines "$TMP/lrb_data.out")" = "$(err_lines "$TMP/nrb_data.out")" ] \
  && has "$TMP/nrb_data.out" "ZELL_0020_ROLLBACK_HAS_DATA"; then ok=yes; fi
record "S17c 0020 rollback with data, without 0020-S = legacy (ZELL_0020_ROLLBACK_HAS_DATA)" "$ok" "legacy=$(err_lines "$TMP/lrb_data.out" | cut -c1-160) new=$(err_lines "$TMP/nrb_data.out" | cut -c1-160)"
# (d) rollback نضيف: نفس الخرج ونفس الحالة بعده (داتابيز جديدة لكل نسخة)
reset_db "$A:owner:true" "$X:admin:true"
run_file "$BASE" "$TMP/base17d1.out"
run_file "$TMP/legacy_rb.sql" "$TMP/lrb_clean.out"; lrc=$?
lstate=$(q "select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'")
reset_db "$A:owner:true" "$X:admin:true"
run_file "$BASE" "$TMP/base17d2.out"
run_file "$BASE_RB" "$TMP/nrb_clean.out"; nrc=$?
nstate=$(q "select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'")
ok=no; if [ "$lrc" = "0" ] && [ "$nrc" = "0" ] && [ "$lstate" = "0" ] && [ "$nstate" = "0" ] \
  && [ "$(err_lines "$TMP/lrb_clean.out")" = "$(err_lines "$TMP/nrb_clean.out")" ]; then ok=yes; fi
record "S17d 0020 rollback (clean), without 0020-S = legacy (both succeed, zell_inv_% = 0)" "$ok" "legacy rc=$lrc left=$lstate new rc=$nrc left=$nstate"
# (e) rollback و 0020 مش متطبّق خالص: نفس الرفض
run_file "$TMP/legacy_rb.sql" "$TMP/lrb_none.out"; lrc=$?
run_file "$BASE_RB" "$TMP/nrb_none.out"; nrc=$?
ok=no; if [ "$lrc" = "$nrc" ] && [ "$nrc" != "0" ] && [ "$(err_lines "$TMP/lrb_none.out")" = "$(err_lines "$TMP/nrb_none.out")" ]; then ok=yes; fi
record "S17e 0020 rollback when 0020 is not applied = legacy (same refusal)" "$ok" "legacy=$(err_lines "$TMP/lrb_none.out" | cut -c1-160) new=$(err_lines "$TMP/nrb_none.out" | cut -c1-160)"

# ── S18: 0020-S ناقص (دالة واحدة اتمسحت): verify 0020 بيفشل، و rollback 0020 بيطلب rollback 0020-S الأول ──
reset_db "$A:owner:true" "$X:admin:true"
run_file "$BASE" "$TMP/base18.out"
run_file "$APPLY" "$TMP/apply18.out"
q "set role zell_inventory_definer; drop function public.zell_inv_session_list_lots(text, integer, bigint, integer, bigint); reset role" > "$TMP/partial.out"
run_file "$BASE_VERIFY" "$TMP/base_verify_partial.out"
ok=no; if has "$TMP/base_verify_partial.out" "ZELL_0020_FUNCTION_COUNT"; then ok=yes; fi
record "S18a 0020 verify with partial 0020-S -> ZELL_0020_FUNCTION_COUNT" "$ok" "$(cat "$TMP/partial.out") $(err_lines "$TMP/base_verify_partial.out" | cut -c1-200)"
ok=no; if ! run_file "$BASE_RB" "$TMP/base_rb_partial.out" && has "$TMP/base_rb_partial.out" "ZELL_0020_ROLLBACK_0020S_FIRST"; then ok=yes; fi
record "S18b 0020 rollback with partial 0020-S -> ZELL_0020_ROLLBACK_0020S_FIRST" "$ok" "$(err_lines "$TMP/base_rb_partial.out" | cut -c1-200)"

echo "ZELL_0020S_SQL_CI_RESULT pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ] || [ "$PASS" -eq 0 ]; then exit 1; fi
