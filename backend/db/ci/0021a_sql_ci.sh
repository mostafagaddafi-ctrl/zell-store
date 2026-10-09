#!/usr/bin/env bash
# 0021-A A1 — اختبار SQL الدائم في CI: Postgres 17 مؤقت + shim شبه Supabase (postgres مش superuser وعنده CREATEROLE،
# service_role/anon/authenticated/authenticator، وdefault privileges بتدّي كل حاجة لـ anon/authenticated/service_role)،
# و orders بشكل Production (القيود اللي برّه ملفات الـ migration + orders_cancelled_final + RLS من غير FORCE)،
# و zell_order_writer مالك دالة إنشاء طلب شبه zell_create_order.
# بيغطي: شكل المعاملة (ptest + verify) · md5 الجسم · ptest (ci + production + حالات لازم تقع) · استعلام الأثر · التطبيق
# · رفض الإعادة · verify · التوافق مع اللوحة والمتجر قبل/بعد البوابة · الهوية · الانتقالات · المكالمة · التعديل · الموعد
# · الملاحظة · التعارض (اتصالين) · append-only · الفترات · البوابة · rollback (رفض + نضيف + إعادة تطبيق).
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
APPLY="$MIG/0021a_a1_order_cycle.sql"
PTEST="$MIG/0021a_a1_order_cycle_ptest.sql"
VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
ROLLBACK="$MIG/0021a_a1_order_cycle_rollback.sql"
SHAPE="$ROOT/backend/db/ci/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
O='00000000-0000-0000-0000-00000000000a'   # مالك شغّال
A='00000000-0000-0000-0000-00000000000b'   # أدمن شغّال
X='00000000-0000-0000-0000-00000000000c'   # أدمن موقوف
N='00000000-0000-0000-0000-00000000000d'   # مش في admin_users

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
code_in() { grep -o 'ERROR:  [0-9A-Z]\{5\}' | head -n 1 | awk '{print $2}'; }
has() { grep -q -- "$2" "$1"; }
# نداء زي PostgREST: دور authenticated + claims الجلسة ('' = من غير جلسة).
as_user_raw() {
  local claims=''
  if [ -n "$1" ]; then claims="{\"sub\":\"$1\",\"role\":\"authenticated\"}"; fi
  psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" \
    -c "set role authenticated; select pg_catalog.set_config('request.jwt.claims', '$claims', false) is null; $2" 2>&1
}
uval() { as_user_raw "$1" "$2" | tail -n 1; }
ucode() { as_user_raw "$1" "$2" | code_in; }
# اللوحة النهارده: PATCH بـ service_role. بيرجّع ok أو الـ SQLSTATE.
svc() {
  local out
  if out=$(psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -c "set role service_role; $1" 2>&1); then
    echo ok
  else
    printf '%s\n' "$out" | code_in
  fi
}
pgx() {
  local out
  if out=$(psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -c "$1" 2>&1); then
    echo ok
  else
    printf '%s\n' "$out" | code_in
  fi
}
ts() { q "select updated_at from public.orders where id = $1"; }
st() { q "select status from public.orders where id = $1"; }
# طلب من «المتجر»: دالة SECURITY DEFINER مالكها zell_order_writer (زي zell_create_order). $3 = coupon_id أو null.
mk() { q "select public.ci_create_order('$1', '$2', $3)"; }
# طلب «قديم» مباشر بحالة معينة (قبل التطبيق).
legacy() { q "insert into public.orders (order_number, status, customer_name, customer_phone, address) values ('FLM-L' || substr(md5(random()::text), 1, 5), '$1', 'زبون قديم', '01000000000', 'عنوان قديم طويل كفاية') returning id"; }

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
  if pg_catalog.to_regrole('zell_order_writer') is null then
    create role zell_order_writer nologin nobypassrls;
  end if;
end
$r$;
grant anon, authenticated, service_role to authenticator;
-- زي Supabase: postgres يقدر SET ROLE للأدوار دي (اختبار RLS والـ ptest).
grant anon, authenticated, service_role to postgres;
SQL
}

# reset_db "uuid:role:active" ...
reset_db() {
  local spec id role active n=0
  su_sql postgres "drop database if exists $DB with (force)"
  su_sql postgres "drop role if exists zell_order_definer"
  su_sql postgres "create database $DB owner postgres"
  su_sql "$DB" "alter schema public owner to postgres"
  su_sql "$DB" "revoke create on schema public from public"
  su_sql "$DB" "grant usage on schema public to anon, authenticated, service_role, zell_order_writer"
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

-- orders بشكل Production: id serial · قيد الحالة (5) و internal_notes (≤2000) المتعرّفين برّه ملفات الـ migration ·
-- orders_cancelled_final (0019، 45080) · RLS من غير FORCE · revoke من anon/authenticated (0002).
create table public.orders (
  id             serial primary key,
  order_number   text not null unique,
  status         text not null default 'new',
  customer_name  text not null,
  customer_phone text not null,
  address        text not null,
  notes          text,
  internal_notes text,
  coupon_id      bigint,
  total_piastres bigint not null default 0,
  notify_error   text,
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint orders_status_check check (status = any (array['new', 'confirmed', 'shipped', 'delivered', 'cancelled'])),
  constraint orders_internal_notes_length check (internal_notes is null or char_length(internal_notes) <= 2000)
);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
create function public.zell_orders_cancelled_final()
returns trigger language plpgsql set search_path = '' as $f$
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'ZELL_ORDER_CANCELLED_FINAL' using errcode = '45080';
  end if;
  return new;
end
$f$;
revoke all on function public.zell_orders_cancelled_final() from public, anon, authenticated;
create trigger orders_cancelled_final before update of status on public.orders
  for each row execute function public.zell_orders_cancelled_final();
grant select, insert, update on public.orders to zell_order_writer;
grant usage on sequence public.orders_id_seq to zell_order_writer;
create policy orders_insert_for_writer on public.orders for insert to zell_order_writer with check (true);
create policy orders_read_for_writer on public.orders for select to zell_order_writer using (true);
SQL
  psql -X -q -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" > /dev/null <<'SQL'
create function public.ci_create_order(p_name text, p_phone text, p_coupon bigint)
returns integer language sql security definer set search_path = '' as $f$
  insert into public.orders (order_number, customer_name, customer_phone, address, coupon_id)
  values ('FLM-' || upper(substr(md5(pg_catalog.random()::text), 1, 6)), p_name, p_phone, 'عنوان تجربة طويل كفاية', p_coupon)
  returning id
$f$;
alter function public.ci_create_order(text, text, bigint) owner to zell_order_writer;
grant execute on function public.ci_create_order(text, text, bigint) to postgres, service_role;
SQL
  for spec in "$@"; do
    n=$((n + 1))
    IFS=: read -r id role active <<< "$spec"
    q "insert into public.admin_users (user_id, role, is_active, created_at) values ('$id', '$role', $active, timestamptz '2026-01-01' + interval '$n minute')" > /dev/null
  done
}

seed_legacy() {
  local s
  for s in new new confirmed shipped delivered cancelled; do legacy "$s" > /dev/null; done
  q "update public.orders set internal_notes = 'ملاحظة قديمة' where status = 'confirmed'" > /dev/null
}

apply_a1() { run_file "$APPLY" "$TMP/apply.out"; }
verify_row() { run_file "$VERIFY" "$TMP/verify.out"; grep '^0|summary|' "$TMP/verify.out"; }
verify_fails() { grep -E '^[0-9]+\|check\|[^|]*\|[^|]*\|f\|' "$TMP/verify.out" | tr '\n' ' '; }
ptest_text() { sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = '$1';/" "$PTEST"; }
run_ptest() {
  ptest_text "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/ptest.out" 2>&1
}
ptest_summary() { grep '^0|summary|' "$TMP/ptest.out"; }
ptest_fails() { grep -E '^[0-9]+\|test\|[^|]*\|[^|]*\|fail\|' "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-1500; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }

body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"

# استعلام الأثر المعتمد (قراءة بس) — نفس النص في وصف الـ PR بالحرف.
# الأعمدة: 1 role · 2 tables · 3 functions · 4 orders_triggers · 5 orders_policies · 6 orders_new_columns
#          7 status_check_7 · 8 memberships · 9 idle_tx · 10 orders_locks · 11 orders_total · 12 statuses
IMPACT_SQL=$(cat <<'SQL'
select
 (select count(*) from pg_catalog.pg_roles where rolname = 'zell_order_definer') as role,
 (select count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('order_status_transitions','order_events','order_delivery_periods','zell_order_gate','zell_order_config_log')) as tables,
 (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_order\_%') as functions,
 (select count(*) from pg_catalog.pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal) as orders_triggers,
 (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'orders') as orders_policies,
 (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('next_follow_up_at','delivery_confirmed_date','delivery_confirmed_period','delivery_confirmed_note')) as orders_new_columns,
 (select pg_catalog.pg_get_constraintdef(c.oid) like '%''refused''%' from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check') as status_check_7,
 (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid in (m.roleid, m.member) where r.rolname = 'zell_order_definer') as memberships,
 (select count(*) from pg_catalog.pg_stat_activity where state like 'idle in transaction%' and pid <> pg_catalog.pg_backend_pid()) as idle_tx,
 (select count(*) from pg_catalog.pg_locks where relation = 'public.orders'::regclass and pid <> pg_catalog.pg_backend_pid()) as orders_locks,
 (select count(*) from public.orders) as orders_total,
 (select coalesce(string_agg(s.status || '=' || s.n, ',' order by s.status), '') from (select o.status, count(*) as n from public.orders o group by o.status) s) as statuses;
SQL
)
impact() { q "$IMPACT_SQL"; }
status_def() { q "select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_status_check'"; }

init_cluster

# ── S0: شكل الملفات ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify (begin ... one SELECT ... rollback)" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021A1 BODY'); M2=$(body_md5 "$PTEST" '0021A1 BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no; if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"
ok=yes
CODES=$(grep -o "errcode = '[0-9]\{5\}'" "$APPLY" | grep -o '[0-9]\{5\}' | sort -u | tr '\n' ' ')
if [ -z "$CODES" ]; then ok=no; fi
for c in $CODES; do if [ "$c" -lt 45400 ] || [ "$c" -gt 45449 ]; then ok=no; fi; done
record "S04 error codes only in 45400..45449" "$ok" "$CODES"

# ── S1: ptest قبل التطبيق ──
reset_db "$O:owner:true" "$A:admin:true" "$X:admin:false"
seed_legacy
BEFORE=$(impact)
BEFORE_DEF=$(status_def)
run_ptest ci; E=$?; S=$(ptest_summary)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 7)" = "ci" ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 9)" = "0" ] && [ "$(rf "$S" 15)" = "" ]; then ok=yes; fi
record "S10 ptest ci profile -> PASS, no skips" "$ok" "E=$E S=$S fails=$(ptest_fails) tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ')"
run_ptest production; E=$?; S=$(ptest_summary)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 7)" = "production" ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 15)" = "O00" ]; then ok=yes; fi
record "S11 ptest production profile -> PASS, expected skip O00" "$ok" "E=$E S=$S fails=$(ptest_fails)"
ok=no; if [ "$(impact)" = "$BEFORE" ] && [ "$(status_def)" = "$BEFORE_DEF" ]; then ok=yes; fi
record "S12 ptest leaves nothing behind (impact + status check unchanged)" "$ok" "before=$BEFORE after=$(impact)"
q "update public.admin_users set is_active = false where user_id = '$A'" > /dev/null
run_ptest production; E=$?; S=$(ptest_summary)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 11)" = "PASS" ] && [ "$(rf "$S" 15)" = "O00,P08" ]; then ok=yes; fi
record "S13 ptest production without active admin -> PASS, skips O00,P08" "$ok" "E=$E S=$S"
q "update public.admin_users set is_active = false where user_id = '$O'" > /dev/null
run_ptest production; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021A1_PTEST_NO_OWNER'; then ok=yes; fi
record "S14 ptest without active owner -> refuses" "$ok" "E=$E $(grep -m1 ERROR "$TMP/ptest.out")"
q "update public.admin_users set is_active = true where user_id in ('$O', '$A')" > /dev/null
ok=no; if [ "$(rf "$BEFORE" 1)|$(rf "$BEFORE" 2)|$(rf "$BEFORE" 3)|$(rf "$BEFORE" 4)|$(rf "$BEFORE" 6)|$(rf "$BEFORE" 7)" = "0|0|0|1|0|f" ]; then ok=yes; fi
record "S15 impact query before apply" "$ok" "$BEFORE"

# ── S2: التطبيق ──
L_NEW=$(q "select min(id) from public.orders where status = 'new'")
L_CONF=$(q "select min(id) from public.orders where status = 'confirmed'")
L_CANC=$(q "select min(id) from public.orders where status = 'cancelled'")
apply_a1; E=$?
AFTER=$(impact)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$AFTER" 1)|$(rf "$AFTER" 2)|$(rf "$AFTER" 3)|$(rf "$AFTER" 4)|$(rf "$AFTER" 6)|$(rf "$AFTER" 7)" = "1|5|24|3|4|t" ] \
   && [ "$(rf "$AFTER" 11)" = "$(rf "$BEFORE" 11)" ] && [ "$(rf "$AFTER" 12)" = "$(rf "$BEFORE" 12)" ]; then ok=yes; fi
record "S20 apply -> impact after (old orders untouched)" "$ok" "E=$E after=$AFTER $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ')"
apply_a1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021A1_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S21 re-apply refused (ALREADY_APPLIED), nothing changed" "$ok" "E=$E"
V=$(verify_row)
ok=no; if [ "$(rf "$V" 7)" = "PASS" ] && [ "$(rf "$V" 8)" = "f" ] && [ "$(rf "$V" 10)" = "0" ]; then ok=yes; fi
record "S22 verify -> PASS, gate closed, no events" "$ok" "V=$V fails=$(verify_fails)"
run_ptest ci; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021A1_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S23 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"
ok=no; if [ "$(q "select count(*) from public.orders where next_follow_up_at is not null or delivery_confirmed_date is not null")" = "0" ] \
   && [ "$(q "select count(*) from public.order_events")" = "0" ]; then ok=yes; fi
record "S24 no backfill: new columns empty, no events for old orders" "$ok" "-"

# ── S3: التوافق والبوابة مقفولة ──
T=$(svc "update public.orders set status = 'confirmed', updated_at = now() where id = $L_NEW")
T2=$(svc "update public.orders set internal_notes = 'من اللوحة', updated_at = now() where id = $L_NEW")
T3=$(svc "update public.orders set notify_error = null, notified_at = now(), updated_at = now() where id = $L_CONF")
T4=$(svc "update public.orders set status = 'shipped', updated_at = now() where id = $L_CONF")
ok=no; if [ "$T|$T2|$T3|$T4" = "ok|ok|ok|ok" ] && [ "$(st "$L_NEW")" = "confirmed" ]; then ok=yes; fi
record "S30 gate closed: dashboard PATCH (status / internal_notes / notify) works as today" "$ok" "$T|$T2|$T3|$T4"
T=$(svc "update public.orders set status = 'preparing', updated_at = now() where id = $L_NEW")
T2=$(svc "update public.orders set status = 'refused', updated_at = now() where id = $L_CONF")
T3=$(svc "update public.orders set status = 'new', updated_at = now() where id = $L_CANC")
T4=$(pgx "insert into public.orders (order_number, status, customer_name, customer_phone, address) values ('FLM-PREP01', 'preparing', 'زبون', '01000000000', 'عنوان طويل كفاية')")
ok=no; if [ "$T|$T2|$T3|$T4" = "45406|45406|45080|45405" ]; then ok=yes; fi
record "S31 gate closed: new statuses refused on any path (45406 / insert 45405), cancelled stays final (45080)" "$ok" "$T|$T2|$T3|$T4"
S1=$(mk 'زبون المتجر' '01011111111' null); E=$?
ok=no; if [ "$E" -eq 0 ] && [ "$(q "select count(*) from public.order_events where order_id = $S1 and kind = 'created' and actor is null")" = "1" ]; then ok=yes; fi
record "S32 store order (definer zell_order_writer) works + created event" "$ok" "id=$S1"

# ── S4: الهوية ──
C1=$(ucode '' "select public.zell_order_gate_state()")
C2=$(ucode "$N" "select public.zell_order_gate_state()")
C3=$(ucode "$X" "select public.zell_order_gate_state()")
C4=$(svc "select public.zell_order_transition($S1, now(), 'confirmed')")
C5=$(pgx "set role anon; select public.zell_order_events($S1)")
C6=$(pgx "set role authenticated; select pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"$A\",\"role\":\"service_role\"}', false) is null; select public.zell_order_gate_state()")
ok=no; if [ "$C1|$C2|$C3|$C4|$C5|$C6" = "45400|45401|45401|42501|42501|45400" ]; then ok=yes; fi
record "S40 identity: no session 45400 · not admin / inactive 45401 · service_role / anon 42501 · claims role must be authenticated" "$ok" "$C1|$C2|$C3|$C4|$C5|$C6"
ok=no; if [ "$(pgx "set role authenticated; select count(*) from public.order_events")" = "42501" ] \
   && [ "$(svc "select count(*) from public.order_events")" = "42501" ]; then ok=yes; fi
record "S41 order_events not readable directly (authenticated / service_role)" "$ok" "-"

# ── S5: الانتقالات (البوابة مقفولة) ──
S2=$(mk 'زبون تاني' '01022222222' null)
R1=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'shipped')")
R2=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'bogus')")
R3=$(ucode "$A" "select public.zell_order_transition($S2, '2020-01-01', 'confirmed')")
V1=$(uval "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'confirmed') ->> 'status'")
R4=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'preparing')")
V2=$(uval "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'shipped') ->> 'status'")
R5=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'refused')")
R6=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'cancelled')")
V3=$(uval "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'delivered') ->> 'status'")
R7=$(ucode "$A" "select public.zell_order_transition($S2, '$(ts "$S2")', 'cancelled')")
EV=$(q "select string_agg(payload ->> 'from' || '>' || (payload ->> 'to'), ',' order by id) from public.order_events where order_id = $S2 and kind = 'status_changed' and actor = '$A'")
ok=no; if [ "$R1|$R2|$R3|$V1|$R4|$V2|$R5|$R6|$V3|$R7" = "45405|45408|45404|confirmed|45406|shipped|45406|45405|delivered|45405" ] \
   && [ "$EV" = "new>confirmed,confirmed>shipped,shipped>delivered" ]; then ok=yes; fi
record "S50 transitions with gate closed (matrix + conflict + events)" "$ok" "$R1|$R2|$R3|$V1|$R4|$V2|$R5|$R6|$V3|$R7 ev=$EV"
S3=$(mk 'زبون تالت' '01033333333' null)
V1=$(uval "$O" "select public.zell_order_transition($S3, '$(ts "$S3")', 'cancelled', 'طلب الزبون') ->> 'status'")
R1=$(ucode "$O" "select public.zell_order_transition($S3, '$(ts "$S3")', 'new')")
ok=no; if [ "$V1|$R1" = "cancelled|45405" ] && [ "$(q "select payload ->> 'reason' from public.order_events where order_id = $S3 and kind = 'status_changed'")" = "طلب الزبون" ]; then ok=yes; fi
record "S51 new -> cancelled (reason kept), cancelled is final" "$ok" "$V1|$R1"

# ── S6: المكالمة والمتابعة ──
S4=$(mk 'زبون رابع' '01044444444' null)
R1=$(ucode "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'callback_later')")
R2=$(ucode "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'no_answer', null, now() + interval '1 day')")
R3=$(ucode "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'maybe')")
V1=$(uval "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'callback_later', 'بعد العصر', now() + interval '1 day') ->> 'status'")
V2=$(uval "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'agreed_awaiting_deposit') ->> 'status'")
V3=$(uval "$A" "select public.zell_order_set_follow_up($S4, '$(ts "$S4")', null) ->> 'status'")
V4=$(uval "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'customer_cancelled', 'غيّر رأيه') ->> 'status'")
R4=$(ucode "$A" "select public.zell_order_record_call($S4, '$(ts "$S4")', 'no_answer')")
K=$(q "select string_agg(kind || coalesce(':' || (payload ->> 'outcome'), ''), ',' order by id) from public.order_events where order_id = $S4")
ok=no; if [ "$R1|$R2|$R3|$V1|$V2|$V3|$V4|$R4" = "45409|45408|45408|new|new|new|cancelled|45410" ] \
   && [ "$K" = "created,call_attempt:callback_later,follow_up_set,call_attempt:agreed_awaiting_deposit,follow_up_set,call_attempt:customer_cancelled,status_changed" ]; then ok=yes; fi
record "S60 calls: callback_later needs follow-up · outcomes · cancel via call · only in new" "$ok" "$R1|$R2|$R3|$V1|$V2|$V3|$V4|$R4 k=$K"

# ── S7: التعديل والموعد والملاحظة ──
S5=$(mk 'زبون كوبون' '01055555555' 7)
R1=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"customer_phone\":\"01066666666\"}')")
V1=$(uval "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"customer_name\":\"اسم جديد\",\"notes\":null}') ->> 'ok'")
R2=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"customer_name\":\"اب\"}')")
R3=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"total_piastres\":1}')")
R4=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"customer_name\":\"اسم جديد\"}')")
R5=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"customer_phone\":\"0101\"}')")
ok=no; if [ "$R1|$V1|$R2|$R3|$R4|$R5" = "45411|true|45408|45408|45408|45408" ] && [ "$(q "select customer_name from public.orders where id = $S5")" = "اسم جديد" ] \
   && [ "$(q "select count(*) from public.order_events where order_id = $S5 and kind = 'details_edited' and payload ->> 'field' = 'customer_name' and payload ->> 'new' = 'اسم جديد'")" = "1" ]; then ok=yes; fi
record "S70 edit details: phone blocked with coupon (45411) · validation · no-op refused · event old/new" "$ok" "$R1|$V1|$R2|$R3|$R4|$R5"
V1=$(uval "$A" "select public.zell_order_set_confirmed_delivery($S5, '$(ts "$S5")', current_date + 2, 'noon', 'اتصل قبلها') ->> 'ok'")
R1=$(ucode "$A" "select public.zell_order_set_confirmed_delivery($S5, '$(ts "$S5")', current_date + 2, 'night')")
R2=$(ucode "$A" "select public.zell_order_set_confirmed_delivery($S5, '$(ts "$S5")', null, 'noon')")
V2=$(uval "$A" "select public.zell_order_set_internal_note($S5, '$(ts "$S5")', '  ملاحظة داخلية  ') ->> 'ok'")
R3=$(ucode "$A" "select public.zell_order_set_internal_note($S5, '$(ts "$S5")', repeat('x', 2001))")
ok=no; if [ "$V1|$R1|$R2|$V2|$R3" = "true|45408|45408|true|45408" ] \
   && [ "$(q "select delivery_confirmed_period || '|' || internal_notes from public.orders where id = $S5")" = "noon|ملاحظة داخلية" ] \
   && [ "$(q "select count(*) from public.order_events where order_id = $S5 and kind in ('delivery_confirmed_set', 'note_changed')")" = "2" ]; then ok=yes; fi
record "S71 confirmed delivery (date + period + note) and internal note via functions" "$ok" "$V1|$R1|$R2|$V2|$R3"
V1=$(uval "$A" "select public.zell_order_transition($S5, '$(ts "$S5")', 'confirmed') ->> 'status'")
R1=$(ucode "$A" "select public.zell_order_edit_details($S5, '$(ts "$S5")', '{\"address\":\"عنوان تاني طويل كفاية\"}')")
ok=no; if [ "$V1|$R1" = "confirmed|45410" ]; then ok=yes; fi
record "S72 edit after confirmation -> 45410" "$ok" "$V1|$R1"

# ── S8: الفترات ──
PT=$(uval "$O" "select public.zell_order_delivery_periods() ->> 'updated_at'")
R1=$(ucode "$A" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"08:00\",\"ends_at\":\"11:00\"},\"noon\":{\"starts_at\":\"11:00\",\"ends_at\":\"16:00\"},\"evening\":{\"starts_at\":\"16:00\",\"ends_at\":\"22:00\"}}')")
R2=$(ucode "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"08:00\",\"ends_at\":\"11:00\"},\"noon\":{\"starts_at\":\"11:00\",\"ends_at\":\"16:00\"}}')")
R3=$(ucode "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"08:00\",\"ends_at\":\"12:30\"},\"noon\":{\"starts_at\":\"12:00\",\"ends_at\":\"16:00\"},\"evening\":{\"starts_at\":\"16:00\",\"ends_at\":\"22:00\"}}')")
R4=$(ucode "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"8:00\",\"ends_at\":\"11:00\"},\"noon\":{\"starts_at\":\"11:00\",\"ends_at\":\"16:00\"},\"evening\":{\"starts_at\":\"16:00\",\"ends_at\":\"22:00\"}}')")
V1=$(uval "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"08:00\",\"ends_at\":\"11:00\"},\"noon\":{\"starts_at\":\"11:00\",\"ends_at\":\"16:00\"},\"evening\":{\"starts_at\":\"16:00\",\"ends_at\":\"22:00\"}}') -> 'periods' -> 2 ->> 'ends_at'")
R5=$(ucode "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"09:00\",\"ends_at\":\"12:00\"},\"noon\":{\"starts_at\":\"12:00\",\"ends_at\":\"17:00\"},\"evening\":{\"starts_at\":\"17:00\",\"ends_at\":\"21:00\"}}')")
ok=no; if [ "$R1|$R2|$R3|$R4|$V1|$R5" = "45402|45412|45412|45412|22:00|45404" ] \
   && [ "$(q "select count(*) from public.zell_order_config_log where kind = 'delivery_periods' and actor = '$O'")" = "1" ]; then ok=yes; fi
record "S80 delivery periods: owner only · all three · no overlap · HH:MI · version check · logged" "$ok" "$R1|$R2|$R3|$R4|$V1|$R5"

# ── S9: append-only والمسح ──
R1=$(pgx "update public.order_events set payload = '{}' where order_id = $S5")
R2=$(pgx "delete from public.order_events where order_id = $S5")
R3=$(pgx "truncate public.order_events")
R4=$(pgx "update public.zell_order_config_log set approval = null")
R5=$(pgx "delete from public.zell_order_config_log")
R6=$(pgx "truncate public.zell_order_config_log")
ok=no; if [ "$R1|$R2|$R3|$R4|$R5|$R6" = "45413|45413|45413|45413|45413|45413" ]; then ok=yes; fi
record "S90 append-only even for table owner (update / delete / truncate)" "$ok" "$R1|$R2|$R3|$R4|$R5|$R6"
R1=$(pgx "delete from public.orders where id = $S3")
ok=no; if [ "$R1" = "ok" ] && [ "$(q "select count(*) from public.order_events where order_id = $S3")" = "0" ]; then ok=yes; fi
record "S91 deleting an order (cleanup before A3) cascades its events" "$ok" "$R1"

# ── S10: البوابة ──
S6=$(mk 'زبون البوابة' '01077777777' null)
V1=$(uval "$A" "select public.zell_order_transition($S6, '$(ts "$S6")', 'confirmed') ->> 'status'")
R0=$(ucode '' "select public.zell_order_set_gate(true, 'owner-approval-2026-10-10-a2-tested')")
R1=$(ucode "$A" "select public.zell_order_set_gate(true, 'owner-approval-2026-10-10-a2-tested')")
R2=$(ucode "$O" "select public.zell_order_set_gate(true, 'yes')")
R3=$(pgx "update public.zell_order_gate set is_open = true")
R4=$(pgx "set role zell_order_definer; update public.zell_order_gate set is_open = true")
R5=$(ucode "$O" "select public.zell_order_set_gate(false, 'owner-approval-2026-10-10-noop')")
V2=$(uval "$O" "select public.zell_order_set_gate(true, 'owner-approval-2026-10-10-a2-tested') ->> 'is_open'")
ok=no; if [ "$R0|$V1|$R1|$R2|$R3|$R4|$R5|$V2" = "45400|confirmed|45402|45408|45414|45414|45408|true" ] \
   && [ "$(q "select count(*) from public.zell_order_config_log where kind = 'gate' and actor = '$O' and approval = 'owner-approval-2026-10-10-a2-tested' and (new_value ->> 'is_open')::boolean")" = "1" ] \
   && [ "$(q "select changed_by from public.zell_order_gate")" = "$O" ]; then ok=yes; fi
record "S100 gate: owner session only (no session 45400 · admin 45402) + approval text · direct UPDATE refused (even owner / definer role) · audited" "$ok" "$R0|$V1|$R1|$R2|$R3|$R4|$R5|$V2"
T=$(svc "update public.orders set status = 'shipped', updated_at = now() where id = $S6")
T2=$(svc "update public.orders set status = 'delivered', updated_at = now() where id = $L_CONF")
T3=$(svc "update public.orders set internal_notes = 'بعد الفتح', updated_at = now() where id = $S6")
T4=$(svc "update public.orders set notify_error = 'x', notified_at = now(), updated_at = now() where id = $S6")
T5=$(pgx "update public.orders set status = 'cancelled' where id = $S6")
ok=no; if [ "$T|$T2|$T3|$T4|$T5" = "45407|45407|ok|ok|45407" ]; then ok=yes; fi
record "S101 gate open: direct status writes refused (45407), other columns still writable" "$ok" "$T|$T2|$T3|$T4|$T5"
R1=$(ucode "$A" "select public.zell_order_transition($S6, '$(ts "$S6")', 'shipped')")
V1=$(uval "$A" "select public.zell_order_transition($S6, '$(ts "$S6")', 'preparing') ->> 'status'")
V2=$(uval "$A" "select public.zell_order_transition($S6, '$(ts "$S6")', 'shipped') ->> 'status'")
V3=$(uval "$A" "select public.zell_order_transition($S6, '$(ts "$S6")', 'refused', 'رفض الاستلام') ->> 'status'")
S7=$(mk 'زبون بعد الفتح' '01088888888' null); E=$?
V4=$(uval "$A" "select public.zell_order_record_call($S7, '$(ts "$S7")', 'confirmed') ->> 'status'")
ok=no; if [ "$R1|$V1|$V2|$V3|$E|$V4" = "45405|preparing|shipped|refused|0|confirmed" ] \
   && [ "$(q "select count(*) from public.order_events where order_id = $S7 and kind = 'created'")" = "1" ]; then ok=yes; fi
record "S102 gate open: confirmed -> shipped closed (45405) · preparing / refused available · store orders still work" "$ok" "$R1|$V1|$V2|$V3|$E|$V4"
V=$(verify_row)
ok=no; if [ "$(rf "$V" 7)" = "PASS" ] && [ "$(rf "$V" 8)" = "t" ] && [ "$(rf "$V" 11)" = "0" ]; then ok=yes; fi
record "S103 verify with gate open -> PASS" "$ok" "V=$V fails=$(verify_fails)"
EVJ=$(uval "$A" "select jsonb_array_length(public.zell_order_events($S6))")
ok=no; if [ "$EVJ" = "5" ]; then ok=yes; fi
record "S104 events readable via function (admin)" "$ok" "n=$EVJ"

# ── S11: rollback مرفوض ──
SNAP=$(impact)
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A1_RB_GATE_OPEN' && [ "$(impact)" = "$SNAP" ]; then ok=yes; fi
record "S110 rollback refused while gate open" "$ok" "E=$E"
uval "$O" "select public.zell_order_set_gate(false, 'owner-approval-2026-10-10-close')" > /dev/null
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A1_RB_EVENTS_IN_USE'; then ok=yes; fi
record "S111 rollback refused after real use (events)" "$ok" "E=$E $(grep -m1 ZELL "$TMP/rb.out")"

reset_db "$O:owner:true" "$A:admin:true"
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A1_RB_NOT_APPLIED'; then ok=yes; fi
record "S112 rollback when not applied -> NOT_APPLIED" "$ok" "E=$E"
seed_legacy
apply_a1 > /dev/null
S8=$(mk 'زبون' '01099999999' null)
PT=$(uval "$O" "select public.zell_order_delivery_periods() ->> 'updated_at'")
uval "$O" "select public.zell_order_save_delivery_periods('$PT', '{\"morning\":{\"starts_at\":\"08:00\",\"ends_at\":\"11:00\"},\"noon\":{\"starts_at\":\"11:00\",\"ends_at\":\"16:00\"},\"evening\":{\"starts_at\":\"16:00\",\"ends_at\":\"22:00\"}}')" > /dev/null
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021A1_RB_CONFIG_IN_USE'; then ok=yes; fi
record "S113 rollback refused after periods were changed" "$ok" "E=$E $(grep -m1 ZELL "$TMP/rb.out")"

# ── S12: rollback نضيف + إعادة تطبيق ──
reset_db "$O:owner:true" "$A:admin:true"
seed_legacy
PRE=$(impact); PRE_DEF=$(status_def)
apply_a1 > /dev/null
S9=$(mk 'زبون' '01012121212' null)
q "update public.orders set status = 'confirmed', updated_at = now() where id = $S9" > /dev/null
run_file "$ROLLBACK" "$TMP/rb.out"; E=$?
POST=$(impact)
ok=no; if [ "$E" -eq 0 ] && [ "$(status_def)" = "$PRE_DEF" ] && [ "$(rf "$POST" 1)|$(rf "$POST" 2)|$(rf "$POST" 3)|$(rf "$POST" 4)|$(rf "$POST" 5)|$(rf "$POST" 6)|$(rf "$POST" 7)|$(rf "$POST" 8)" = "$(rf "$PRE" 1)|$(rf "$PRE" 2)|$(rf "$PRE" 3)|$(rf "$PRE" 4)|$(rf "$PRE" 5)|$(rf "$PRE" 6)|$(rf "$PRE" 7)|$(rf "$PRE" 8)" ] \
   && [ "$(rf "$POST" 11)" = "$(( $(rf "$PRE" 11) + 1 ))" ] && [ "$(st "$S9")" = "confirmed" ]; then ok=yes; fi
record "S120 clean rollback -> back to the exact pre-apply shape (status check text identical), orders kept" "$ok" "E=$E pre=$PRE post=$POST $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ')"
apply_a1; E=$?
V=$(verify_row)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$V" 7)" = "PASS" ]; then ok=yes; fi
record "S121 re-apply after rollback + verify PASS" "$ok" "E=$E V=$V fails=$(verify_fails)"

# ── S13: التعارض باتصالين ──
S10=$(mk 'زبون التزامن' '01013131313' null)
TV=$(ts "$S10")
printf "BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true) IS NULL;\nSELECT public.zell_order_transition(%s, '%s', 'confirmed') ->> 'status';\nSELECT pg_sleep(4);\nCOMMIT;\n" "$A" "$S10" "$TV" | PGAPPNAME=zell_ci_t1 run_pg > "$TMP/t1.out" &
P1=$!
sleep 1
printf "BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT pg_catalog.set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true) IS NULL;\nSELECT public.zell_order_transition(%s, '%s', 'cancelled') ->> 'status';\nCOMMIT;\n" "$O" "$S10" "$TV" | PGAPPNAME=zell_ci_t2 run_pg > "$TMP/t2.out" &
P2=$!
WAITERS=0
for i in $(seq 1 30); do
  w=$(q "select count(*) from pg_catalog.pg_stat_activity where application_name = 'zell_ci_t2' and wait_event_type = 'Lock'")
  if [ "$w" -ge 1 ] 2>/dev/null; then WAITERS=$w; break; fi
  sleep 0.1
done
wait "$P1"; E1=$?
wait "$P2"; E2=$?
S2C=$(sqlstate "$TMP/t2.out")
ok=no; if [ "$E1" -eq 0 ] && [ "$E2" -ne 0 ] && [ "$S2C" = "45404" ] && [ "$WAITERS" -ge 1 ] && [ "$(st "$S10")" = "confirmed" ] \
   && [ "$(q "select count(*) from public.order_events where order_id = $S10 and kind = 'status_changed'")" = "1" ]; then ok=yes; fi
record "S130 two admins on the same order: second waits on the row lock then 45404" "$ok" "E1=$E1 E2=$E2 S2=$S2C waiters=$WAITERS"

su_sql postgres "drop database if exists $DB with (force)"
su_sql postgres "drop role if exists zell_order_definer"
rm -rf "$TMP"
echo "ZELL_0021A_SQL_CI_RESULT pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ] || [ "$PASS" -eq 0 ]; then exit 1; fi
