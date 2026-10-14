#!/usr/bin/env bash
# EXPRESS-SHIPPING W1 — اختبار SQL في CI: Postgres 17 مؤقت + shim الـ CI بتاع P1 بالحرف (init_cluster و reset_db و IMPACT_SQL من
# backend/db/ci/0021p1_sql_ci.sh: 0021-P ← A1 ← D)، وفوقه P1 و P2 و D2 و TR (شكل Production، ومالك zell_create_order = postgres،
# و RLS على order_items)، وبعدين EXPRESS-SHIPPING (0021ex).
# بيغطي: شكل المعاملة · md5 الجسم · الأكواد · الجسم = P1 + التعديلات بس · ptest (production و ci) · رفض التطبيق من غير
# موافقة ومن متصل تاني · التطبيق · بصمة zell_create_order والصلاحيات · استعلام الأثر (الخانة 4 بس بتتغيّر) · verify (EX ·
# A1 · D · P1 · P2 · 0021-P · D2 · TR) بالحالتين ورفض البصمة المجهولة والخليط والـ overload · مقارنة قديم/جديد على المصفوفة
# كاملة (من غير المعامل ومع standard، والسريع) · سيناريوهات الإعداد والطلب (0021ex_flows.sql) · قيد اللقطة · الرجوع
# (بصمات R1 التلاتة · رفض بطلب أو بسطر سجل) وإعادة التطبيق · حراس الـ preflight.
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
CIDIR="$ROOT/backend/db/ci"
P1CI="$CIDIR/0021p1_sql_ci.sh"
OLD19="$MIG/0019_coupons.sql"
A1="$MIG/0021a_a1_order_cycle.sql"
A1VERIFY="$MIG/0021a_a1_order_cycle_verify.sql"
DAPPLY="$MIG/0021d_preferred_delivery.sql"
DVERIFY="$MIG/0021d_preferred_delivery_verify.sql"
ENGINE="$MIG/0021p_erp_access.sql"
ADAPTER="$MIG/0021p_zell_erp_access.sql"
PVERIFY="$MIG/0021p_access_verify.sql"
P1APPLY="$MIG/0021a_p1_payments.sql"
P1VERIFY="$MIG/0021a_p1_payments_verify.sql"
P2APPLY="$MIG/0021a_p2_checkout_fee.sql"
P2VERIFY="$MIG/0021a_p2_checkout_fee_verify.sql"
D2APPLY="$MIG/0021d2_delivery_settings.sql"
D2VERIFY="$MIG/0021d2_delivery_settings_verify.sql"
TRAPPLY="$MIG/0021tr_track_order.sql"
TRVERIFY="$MIG/0021tr_track_order_verify.sql"
APPLY="$MIG/0021ex_express_shipping.sql"
PTEST="$MIG/0021ex_express_shipping_ptest.sql"
VERIFY="$MIG/0021ex_express_shipping_verify.sql"
ROLLBACK="$MIG/0021ex_express_shipping_rollback.sql"
FLOWS="$CIDIR/0021ex_flows.sql"
SHAPE="$CIDIR/0021p_txn_shape.py"
SUPER="$(printenv CI_SUPERUSER || echo supabase_admin)"
DB="zell_ci"
TMP="$(mktemp -d)"
PASS=0
FAIL=0
OLD_SIG='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text'
SIG14='jsonb, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb'
# شكل Production (08-HANDOFF-NOW): مالك zell_create_order = postgres.
CO_OWNER=postgres
OWNER_ID='00000000-0000-0000-0000-00000000000a'
CO14='CREATE OR REPLACE FUNCTION public.zell_create_order('
CO15='CREATE FUNCTION public.zell_create_order('
# بصمات قراءة R1 (Production 2026-10-14) للنسخة الحالية (14)، والبصمة الجديدة المعتمدة (15).
OLD_MD5='811d4d573d750db9c7e5164799536aa6'
OLD_DEF_MD5='1e639ee0c856c267a40135fbe384fa5d'
OLD_DEF_SHA='211b03008c671d710030b2636684ba2e3b4043237048b3ff5fd028c4c8ddc5a2'
NEW_MD5='62924d0fe9b1563e76c54bbddfb628b4'

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
# نداءات بدور service_role (زي المتجر): الـ SQL من stdin.
srq() { { echo 'set role service_role;'; cat; } | psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f - 2>&1; }
run_file() { psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f "$1" > "$2" 2>&1; }
has() { grep -q -- "$2" "$1"; }
rf() { printf '%s' "$1" | cut -d'|' -f"$2"; }
body_md5() { awk -v s="-- >>> $2" -v e="-- <<< $2" '$0 == s {f = 1} f {print} $0 == e {f = 0}' "$1" | md5sum | cut -d' ' -f1; }
EMPTY_MD5="$(printf '' | md5sum | cut -d' ' -f1)"
extract_fn() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && $0 == "$function$" {exit}' "$OLD19"; echo ';'; }
# تعريف دالة كامل من ملف (من سطر CREATE لحد سطر $function$ أو $function$;).
extract_def() { awk -v s="$1" 'index($0, s) == 1 {f = 1} f {print} f && ($0 == "$function$" || $0 == "$function$;") {exit}' "$2"; }
# سطر الموافقة بعد أول begin; (برّه الجسم، فالـ md5 مابيتغيّرش) — زي التشغيل على Production بالظبط.
approved() { sed "0,/^begin;\$/s//begin;\nset local zell.approved_by = '$2';/" "$1"; }
run_approved() { approved "$1" "$2" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$3" 2>&1; }
apply_ex() { run_approved "$APPLY" 'ci-0021ex' "$TMP/apply.out"; }
rollback_ex() { run_approved "$ROLLBACK" 'ci-0021ex-rollback' "$TMP/rb.out"; }
summary_of() { grep '^0|summary|' "$1"; }
fails_of() { grep -E '^[0-9]+\|(test|check)\|[^|]*\|[^|]*\|(fail|f)\|' "$1" | tr '\n' ' ' | cut -c1-1800; }
vsum() { run_file "$1" "$TMP/v.out"; summary_of "$TMP/v.out"; }
ptest_text() { sed "s/^set local zell.ptest_profile = 'production';\$/set local zell.ptest_profile = '$1';/" "$PTEST"; }
run_ptest() { ptest_text "$1" | psql -X -q -tA -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d "$DB" -f - > "$TMP/ptest.out" 2>&1; }
# الأحكام: A1 · D · P1 · P2 · 0021-P (العمود 11) · D2 · TR
verdicts_old() { printf '%s|%s|%s|%s|%s|%s|%s' "$(rf "$(vsum "$A1VERIFY")" 7)" "$(rf "$(vsum "$DVERIFY")" 7)" "$(rf "$(vsum "$P1VERIFY")" 7)" "$(rf "$(vsum "$P2VERIFY")" 7)" "$(rf "$(vsum "$PVERIFY")" 11)" "$(rf "$(vsum "$D2VERIFY")" 7)" "$(rf "$(vsum "$TRVERIFY")" 7)"; }
ALL7='PASS|PASS|PASS|PASS|PASS|PASS|PASS'
verify_ex() { run_file "$VERIFY" "$TMP/exv.out"; summary_of "$TMP/exv.out"; }
# الأحكام اللي بتعتمد على zell_create_order: D · P1 · EX
v3() { printf '%s|%s|%s' "$(rf "$(vsum "$DVERIFY")" 7)" "$(rf "$(vsum "$P1VERIFY")" 7)" "$(rf "$(verify_ex)" 7)"; }
# الحالة: الجدول · السجل · دوال zell_shipping_* · أعمدة اللقطة · عدد معاملات zell_create_order (لكل نسخة)
ex_state() { q "select (to_regclass('public.zell_shipping_options') is not null)::int || '|' || (to_regclass('public.zell_shipping_options_log') is not null)::int || '|' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_shipping\_%') || '|' || (select count(*) from pg_attribute a where a.attrelid = 'public.orders'::regclass and not a.attisdropped and a.attname in ('shipping_method', 'shipping_days_min', 'shipping_days_max')) || '|' || coalesce((select string_agg(p.pronargs::text, ',' order by p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'), '')"; }
# بصمة zell_create_order: md5(prosrc) · md5(def) · sha256(def) · المعاملات · المالك · security definer · الإعداد · الصلاحيات
co_fp() { q "select md5(p.prosrc) || '|' || md5(pg_get_functiondef(p.oid)) || '|' || encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') || '|' || p.pronargs || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || array_to_string(p.proconfig, ',') || '|' || (select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'zell_create_order'"; }
codes() { grep -o "errcode = '[0-9A-Z]*'" | grep -o "'[0-9A-Z]*'" | tr -d "'" | sort -u | tr '\n' ' '; }

# init_cluster و reset_db و IMPACT_SQL من CI بتاع P1 بالحرف (مصدر واحد للـ shim واستعلام الأثر).
awk '/^init_cluster\(\) \{$/ {f = 1} f {print} f && /^\}$/ {f = 0}' "$P1CI" > "$TMP/shim.sh"
awk '/^reset_db\(\) \{$/ {f = 1} f {print} f && /^\}$/ {f = 0}' "$P1CI" >> "$TMP/shim.sh"
awk 'index($0, "IMPACT_SQL=$(cat <<") == 1 {f = 1} f {print} f && $0 == ")" {f = 0}' "$P1CI" >> "$TMP/shim.sh"
# shellcheck disable=SC1090
. "$TMP/shim.sh"
if ! declare -F init_cluster > /dev/null || ! declare -F reset_db > /dev/null || [ -z "$(declare -p IMPACT_SQL 2> /dev/null)" ]; then
  echo "refusing: could not load the shim from $P1CI" >&2
  exit 2
fi
impact() { q "$IMPACT_SQL"; }
# الأثر المتوقع بعد التطبيق: نفس اللي قبله بالحرف، والخانة 4 (بصمة zell_create_order) بس = البصمة الجديدة.
impact_after() { printf '%s' "$1" | awk -F'|' -v OFS='|' -v m="$NEW_MD5" '{$4 = m; print}'; }

# شكل Production قبل EX: الـ shim (0021-P ← A1 ← D) + P1 + P2 + D2، و RLS على order_items، و TR.
prep() {
  reset_db || return 1
  run_approved "$P1APPLY" 'ci-0021a-p1' "$TMP/p1.out" || { echo "--- p1.out"; tail -n 20 "$TMP/p1.out"; return 1; }
  run_approved "$P2APPLY" 'ci-0021a-p2' "$TMP/p2.out" || { echo "--- p2.out"; tail -n 20 "$TMP/p2.out"; return 1; }
  run_approved "$D2APPLY" 'ci-0021d2' "$TMP/d2.out" || { echo "--- d2.out"; tail -n 20 "$TMP/d2.out"; return 1; }
  su_sql "$DB" "alter table public.order_items enable row level security"
  if [ "$1" = "with_tr" ]; then
    run_approved "$TRAPPLY" 'ci-0021tr' "$TMP/tr.out" || { echo "--- tr.out"; tail -n 20 "$TMP/tr.out"; return 1; }
  fi
}

# نسخة zell_create_order الحالية (P1، 14) في schema لوحدها للمقارنة بعد التطبيق.
load_old_copy() {
  su_sql "$DB" "create schema if not exists ci_old authorization postgres"
  extract_def "$CO14" "$P1APPLY" | sed '1s/public\.zell_create_order(/ci_old.zell_create_order(/' \
    | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/old_copy.out" 2>&1
}

# مصفوفة المقارنة: قديم (P1 في ci_old) / جديد من غير المعامل / جديد بـ standard / جديد بـ express — كل نداء في subtransaction
# بيترجع، وإعداد المقدم بيتغيّر كل حالة، والموعد المفضّل كل تالت حالة، والإعداد فيه سريع ومدة عادي للقاهرة والجيزة.
PARITY_SQL=$(cat <<'SQL'
create or replace function pg_temp.ci_try(p_sql text) returns text language plpgsql as $f$
declare
  r jsonb;
  v text;
begin
  begin
    execute p_sql into r;
    v := 'OK ' || (r - 'order_number' - 'receipt_expires_at')::text
         || ' ROW ' || coalesce((select (to_jsonb(o) - 'id' - 'order_number' - 'created_at' - 'updated_at' - 'receipt_expires_at'
                                   - 'confirmation_fee_piastres' - 'shipping_method' - 'shipping_days_min' - 'shipping_days_max')::text
                                   from public.orders o where o.order_number = r ->> 'order_number'), 'none')
         || ' ITEMS ' || (select coalesce(jsonb_agg(to_jsonb(i) - 'id' - 'order_id' - 'created_at' order by i.id), '[]'::jsonb)::text
                            from public.order_items i join public.orders o on o.id = i.order_id
                           where o.order_number = r ->> 'order_number')
         || ' |FEE| ' || coalesce((select o.confirmation_fee_piastres || '/' || public.zell_payment_fee_calc(
                                            (select s.confirmation_fee from public.zell_payment_settings s where s.id),
                                            o.total_piastres, o.shipping_piastres,
                                            exists (select 1 from public.order_items i where i.order_id = o.id and i.sale_unit = 'meter'),
                                            o.installation_requested)
                                     from public.orders o where o.order_number = r ->> 'order_number'), 'none')
         || ' |SNAP| ' || coalesce((select coalesce(o.shipping_method, '-') || '/' || coalesce(o.shipping_days_min::text, '-') || '/'
                                           || coalesce(o.shipping_days_max::text, '-') || '/' || o.shipping_piastres
                                      from public.orders o where o.order_number = r ->> 'order_number'), 'none');
    raise exception using errcode = 'ZZ999';
  exception
    when sqlstate 'ZZ999' then null;
    when others then v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  return v;
end
$f$;
create or replace function pg_temp.ci_call(p_fn text, p_items text, p_gov text, p_area text, p_inst boolean, p_coupon text, p_phone text,
                                           p_pref text, p_method text)
returns text language sql as $f$
  select format('select %s(p_items => %L::jsonb, p_customer_name => %L, p_customer_phone => %L, p_governorate => %L, p_address => %L, '
                || 'p_notes => %L, p_idempotency_key => %L, p_request_hash => %L, p_checkout_session_hash => %L, p_receipt_token_hash => %L%s%s%s%s%s)',
                p_fn, p_items, 'عميل المقارنة', p_phone, p_gov, 'عنوان المقارنة طويل كفاية', 'ملاحظة', 'ci-parity-key-' || p_phone,
                repeat('a', 64), repeat('b', 64), repeat('c', 64),
                case when p_area is null then '' else format(', p_area => %L', p_area) end,
                case when p_inst then ', p_installation => true' else '' end,
                case when p_coupon is null then '' else format(', p_coupon_code => %L', p_coupon) end,
                case when p_pref is null then '' else format(', p_preferred_delivery => %L::jsonb', p_pref) end,
                case when p_method is null then '' else format(', p_shipping_method => %L', p_method) end);
$f$;
create temporary table ci_parity (n integer, ok boolean, outcome text, fee_pos boolean, ex_ok boolean, detail text);
do $m$
declare
  carts text[] := array[
    '[{"productId":1,"lengthCm":300}]', '[{"productId":1,"lengthCm":350,"widthCm":100}]', '[{"productId":1,"lengthCm":300,"widthCm":50}]',
    '[{"productId":3,"quantity":2}]', '[{"productId":1,"lengthCm":300},{"productId":3,"quantity":1}]', '[{"productId":1,"lengthCm":2000}]',
    '[{"productId":1,"lengthCm":1000},{"productId":1,"lengthCm":500,"widthCm":100}]', '[{"productId":1,"lengthCm":325}]',
    '[{"productId":2,"lengthCm":300}]', '[{"productId":1,"lengthCm":300,"widthCm":150}]', '[{"productId":3,"quantity":11}]', '[]',
    '[{"productId":3,"quantity":10}]'];
  combos text[] := array['القاهرة||f', 'الجيزة||f', 'القاهرة|المعادي|f', 'القاهرة|المعادي|t', 'القاهرة|مدينة نصر|t', 'الجيزة|المعادي|f', 'أسوان||f', 'القاهرة|الزمالك|f'];
  coupons text[] := array[null, 'PCT10', 'FIX20', 'NOPE1', 'OLD10'];
  cfgs text[] := array[
    '{"enabled": false}',
    '{"enabled": true, "scope": "all", "method": "fixed", "fixed_piastres": 5000}',
    '{"enabled": true, "scope": "made_to_measure", "method": "percent", "percent_bp": 1000}',
    '{"enabled": true, "scope": "with_installation", "method": "shipping", "shipping_fallback_piastres": 3000}',
    '{"enabled": true, "scope": "above_amount", "method": "fixed", "fixed_piastres": 250000, "threshold_piastres": 100000}',
    '{"enabled": true, "scope": "all", "method": "shipping", "shipping_fallback_piastres": 4000}',
    '{"enabled": true, "scope": "all", "method": "percent", "percent_bp": 3333}'];
  v_pref text := '{"date": "' || to_char((now() at time zone 'Africa/Cairo')::date + 3, 'YYYY-MM-DD') || '", "period": "morning", "note": "بعد العصر"}';
  n integer := 0;
  v_old text; v_new text; v_std text; v_exp text; v_gov text; v_area text; v_inst boolean; v_phone text; v_fee text; v_p text;
  v_snap text; v_esnap text; v_ok boolean; v_ex boolean;
begin
  update public.zell_shipping_options
     set express_enabled = true,
         governorates = '{"القاهرة": {"standard_days_min": 2, "standard_days_max": 4, "express_enabled": true, "express_price_piastres": 11000, "express_days_min": 1, "express_days_max": 1},
                          "الجيزة": {"standard_days_min": null, "standard_days_max": null, "express_enabled": true, "express_price_piastres": 8000, "express_days_min": 1, "express_days_max": 2}}'::jsonb
   where id;
  for i in 1 .. array_length(carts, 1) loop
    for j in 1 .. array_length(combos, 1) loop
      for k in 1 .. array_length(coupons, 1) loop
        n := n + 1;
        update public.zell_payment_settings set confirmation_fee = cfgs[1 + n % array_length(cfgs, 1)]::jsonb where id;
        v_gov := split_part(combos[j], '|', 1);
        v_area := nullif(split_part(combos[j], '|', 2), '');
        v_inst := split_part(combos[j], '|', 3) = 't';
        v_phone := '010' || lpad(n::text, 8, '0');
        v_p := case when n % 3 = 0 then v_pref end;
        v_old := pg_temp.ci_try(pg_temp.ci_call('ci_old.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, v_p, null));
        v_new := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, v_p, null));
        v_std := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, v_p, 'standard'));
        v_exp := pg_temp.ci_try(pg_temp.ci_call('public.zell_create_order', carts[i], v_gov, v_area, v_inst, coupons[k], v_phone, v_p, 'express'));
        v_fee := split_part(split_part(v_new, ' |FEE| ', 2), ' |SNAP| ', 1);
        v_snap := case v_gov when 'القاهرة' then 'standard/2/4/' when 'الجيزة' then 'standard/-/-/' else '?' end;
        v_esnap := case v_gov when 'القاهرة' then 'express/1/1/11000' when 'الجيزة' then 'express/1/2/8000' else '?' end;
        -- العادي ومن غير المعامل = القديم بالحرف (الرد والصف والسطور والمقدم)، واللقطة standard بمدة المحافظة.
        v_ok := split_part(v_old, ' |SNAP| ', 1) = split_part(v_new, ' |SNAP| ', 1)
                and split_part(v_old, ' |SNAP| ', 1) = split_part(v_std, ' |SNAP| ', 1)
                and (v_old like 'ERR %'
                     or (split_part(v_old, ' |SNAP| ', 2) like '-/-/-/%'
                         and split_part(v_new, ' |SNAP| ', 2) = v_snap || split_part(split_part(v_old, ' |SNAP| ', 2), '/', 4)
                         and split_part(v_std, ' |SNAP| ', 2) = split_part(v_new, ' |SNAP| ', 2)));
        -- السريع: نفس الرفض بالحرف، أو نفس الطلب والشحن = سعر السريع الكامل (مفيش حد مجاني) والمقدم بنفس الحساب.
        v_ex := case when v_old like 'ERR %' then v_exp = v_old
                     else v_exp like 'OK %' and split_part(v_exp, ' |SNAP| ', 2) = v_esnap
                          and split_part(split_part(split_part(v_exp, ' |FEE| ', 2), ' |SNAP| ', 1), '/', 1)
                              = split_part(split_part(split_part(v_exp, ' |FEE| ', 2), ' |SNAP| ', 1), '/', 2)
                          and (split_part(split_part(v_exp, ' ROW ', 1), 'OK ', 2)::jsonb -> 'subtotal_piastres')
                              = (split_part(split_part(v_old, ' ROW ', 1), 'OK ', 2)::jsonb -> 'subtotal_piastres')
                          and (split_part(split_part(v_exp, ' ROW ', 1), 'OK ', 2)::jsonb -> 'discount_piastres')
                              = (split_part(split_part(v_old, ' ROW ', 1), 'OK ', 2)::jsonb -> 'discount_piastres') end;
        insert into ci_parity values (
          n, v_ok, split_part(v_old, ' ', 1) || ' ' || split_part(v_old, ' ', 2),
          v_new like 'OK %' and split_part(v_fee, '/', 1) <> '0', v_ex,
          left(v_old || ' || ' || v_new || ' || ' || v_exp, 600));
      end loop;
    end loop;
  end loop;
  update public.zell_payment_settings set confirmation_fee = '{"enabled": false}'::jsonb where id;
  update public.zell_shipping_options set express_enabled = false, governorates = '{}'::jsonb where id;
end
$m$;
select count(*) || '|' || count(*) filter (where not ok) || '|' || count(*) filter (where outcome like 'OK %') || '|'
       || count(*) filter (where fee_pos) || '|' || count(distinct outcome) || '|' || count(*) filter (where not ex_ok) || '|'
       || coalesce((select detail from ci_parity where not ok or not ex_ok order by n limit 1), '')
  from ci_parity;
SQL
)

init_cluster

# ── S0: الشكل والملفات ──
if python3 "$SHAPE" --selftest > "$TMP/shape_self.out" 2>&1 && python3 "$SHAPE" "$PTEST" "$VERIFY" "$FLOWS" > "$TMP/shape.out" 2>&1; then ok=yes; else ok=no; fi
record "S01 txn shape: ptest + verify + flows" "$ok" "$(cat "$TMP/shape_self.out" "$TMP/shape.out" | tail -n 5 | tr '\n' ' ')"
M1=$(body_md5 "$APPLY" '0021EX BODY'); M2=$(body_md5 "$PTEST" '0021EX BODY')
ok=no; if [ "$M1" = "$M2" ] && [ "$M1" != "$EMPTY_MD5" ]; then ok=yes; fi
record "S02 migration body copied verbatim into ptest (md5)" "$ok" "apply=$M1 ptest=$M2"
ok=no
if [ "$(grep -c '^begin;$' "$APPLY")" = "1" ] && [ "$(grep -c '^commit;$' "$APPLY")" = "1" ] \
   && [ "$(grep -c '^begin;$' "$ROLLBACK")" = "1" ] && [ "$(grep -c '^commit;$' "$ROLLBACK")" = "1" ]; then ok=yes; fi
record "S03 apply / rollback: exactly one begin / commit" "$ok" "-"
C_OLD=$(extract_def "$CO14" "$P1APPLY" | codes); C_NEW=$(extract_def "$CO15" "$APPLY" | codes)
C_ADD=$(comm -13 <(printf '%s' "$C_OLD" | tr ' ' '\n' | sed '/^$/d') <(printf '%s' "$C_NEW" | tr ' ' '\n' | sed '/^$/d') | tr '\n' ' ')
C_DEL=$(comm -23 <(printf '%s' "$C_OLD" | tr ' ' '\n' | sed '/^$/d') <(printf '%s' "$C_NEW" | tr ' ' '\n' | sed '/^$/d') | tr '\n' ' ')
C_FILE=$(codes < "$APPLY")
# shellcheck disable=SC2086
C_EXP=$(printf '%s\n' $C_NEW 45404 45413 | sort -u | tr '\n' ' ')
ok=no; if [ "$C_ADD" = "45431 45432 " ] && [ -z "$C_DEL" ] && [ "$C_FILE" = "$C_EXP" ] && [ -n "$C_OLD" ]; then ok=yes; fi
record "S04 error codes: zell_create_order = P1 codes + 45431 / 45432 · the rest of the migration adds 45404 / 45413 (A1) only" "$ok" "add=$C_ADD del=$C_DEL file=$C_FILE"
OTHER=$(grep -rlE '4543[12]' "$ROOT/backend" 2> /dev/null | grep -v '/0021ex_' | grep -v '\.md$' | tr '\n' ' ')
ok=no; if [ -z "$OTHER" ]; then ok=yes; fi
record "S05 45431 / 45432 unused in any other database code file under backend/ (0021ex_* and Markdown docs excluded)" "$ok" "$OTHER"
diff --minimal <(extract_def "$CO14" "$P1APPLY") <(extract_def "$CO15" "$APPLY") > "$TMP/body.diff"
DDEL=$(grep -c '^<' "$TMP/body.diff"); DADD=$(grep -c '^>' "$TMP/body.diff")
ok=no; if [ "$DDEL" = "3" ] && [ "$DADD" = "61" ] && grep -q '^< CREATE OR REPLACE FUNCTION public.zell_create_order(' "$TMP/body.diff"; then ok=yes; fi
record "S06 new zell_create_order = the P1 definition + the EXPRESS edits only (diff: 3 changed lines, 61 new)" "$ok" "del=$DDEL add=$DADD $(grep '^<' "$TMP/body.diff" | head -n 5 | tr '\n' ' ' | cut -c1-400)"

# ── S1: قبل التطبيق (شكل Production) و ptest ──
if ! prep with_tr; then record "S10 prep" "no" "see output"; fi
BEFORE=$(impact)
V0=$(verdicts_old)
FP0=$(co_fp)
ok=no
if [ "$V0" = "$ALL7" ] && [ "$(ex_state)" = "0|0|0|0|14" ] && [ "$(rf "$FP0" 1)" = "$OLD_MD5" ] && [ "$(rf "$FP0" 2)" = "$OLD_DEF_MD5" ] \
   && [ "$(rf "$FP0" 3)" = "$OLD_DEF_SHA" ] && [ "$(rf "$FP0" 4)" = "14" ] && [ "$(rf "$FP0" 5)" = "postgres" ] \
   && [ "$(rf "$BEFORE" 4)" = "$OLD_MD5" ] && [ "$(rf "$BEFORE" 5)" = "postgres" ]; then ok=yes; fi
record "S10 baseline = Production shape (7 verify PASS), no EX objects, zell_create_order = R1 (md5 · functiondef md5 · sha256 · 14 args · owner postgres)" "$ok" "V=$V0 state=$(ex_state) fp=$FP0 impact=$BEFORE"
run_ptest ci; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "8" ] && [ "$(rf "$S" 8)" = "0" ] && [ "$(rf "$S" 10)" = "0" ]; then ok=yes; fi
record "S11 ptest ci profile -> PASS (8 pass, no skips)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
run_ptest production; E=$?; S=$(summary_of "$TMP/ptest.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "7" ] && [ "$(rf "$S" 8)" = "0" ] && [ "$(rf "$S" 10)" = "1" ]; then ok=yes; fi
record "S12 ptest production profile -> PASS (7 pass), expected skip T07" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/ptest.out") tail=$(tail -n 3 "$TMP/ptest.out" | tr '\n' ' ' | cut -c1-600)"
ok=no; if [ "$(ex_state)" = "0|0|0|0|14" ] && [ "$(impact)" = "$BEFORE" ] && [ "$(co_fp)" = "$FP0" ]; then ok=yes; fi
record "S13 ptest leaves nothing behind (no EX objects, impact + zell_create_order fingerprint unchanged)" "$ok" "state=$(ex_state) before=$BEFORE after=$(impact)"
q "create table public.zell_shipping_options (id boolean)" > /dev/null
VM=$(v3 | cut -d'|' -f1-2)
q "drop table public.zell_shipping_options" > /dev/null
ok=no; if [ "$VM" = "FAIL|FAIL" ] && [ "$(v3 | cut -d'|' -f1-2)" = "PASS|PASS" ]; then ok=yes; fi
record "S14 mixed state (options table + 14 args) -> D and P1 verify FAIL; back to the before shape -> PASS" "$ok" "mixed=$VM"

# ── S2: التطبيق ──
run_file "$APPLY" "$TMP/noapproval.out"; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/noapproval.out" 'ZELL_0021EX_APPROVAL_MISSING' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S20 apply without the approval line -> refused, nothing changed" "$ok" "E=$E"
psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" -f <(approved "$APPLY" 'ci-0021ex') > "$TMP/wrongcaller.out" 2>&1; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/wrongcaller.out" 'ZELL_0021EX_WRONG_CALLER' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S21 apply by another role (not postgres) -> refused (WRONG_CALLER)" "$ok" "E=$E"
apply_ex; E=$?
AFTER=$(impact); EXV=$(verify_ex); EXP_AFTER=$(impact_after "$BEFORE")
ok=no; if [ "$E" -eq 0 ] && [ "$(ex_state)" = "1|1|4|3|15" ] && [ "$AFTER" = "$EXP_AFTER" ] && [ "$(rf "$EXV" 7)" = "PASS" ]; then ok=yes; fi
record "S22 apply -> 2 tables + 4 functions + 3 columns + zell_create_order (15), EX verify PASS (10), impact = before except field 4 = the new md5" "$ok" "E=$E state=$(ex_state) before=$BEFORE after=$AFTER exp=$EXP_AFTER EX=$EXV fails=$(fails_of "$TMP/exv.out") $(grep -m3 -E 'ERROR|ZELL' "$TMP/apply.out" | tr '\n' ' ' | cut -c1-600)"
V1=$(verdicts_old)
ok=no; if [ "$V1" = "$ALL7" ]; then ok=yes; fi
record "S23 A1 · D (V02 = 15 args) · P1 (V06 = new md5) · P2 · 0021-P · D2 · TR (4 zell_checkout_*) verify PASS after EX" "$ok" "V=$V1 $(fails_of "$TMP/v.out")"
FP1=$(co_fp)
ok=no
if [ "$(rf "$FP1" 1)" = "$NEW_MD5" ] && [ "$(rf "$FP1" 4)" = "15" ] && [ "$(rf "$FP1" 5)" = "postgres" ] && [ "$(rf "$FP1" 6)" = "true" ] \
   && [ "$(rf "$FP1" 7)" = "$(rf "$FP0" 7)" ] && [ "$(rf "$FP1" 8)" = "$(rf "$FP0" 8)" ] \
   && [ "$(q "select pg_get_function_identity_arguments('public.zell_create_order($SIG14, text)'::regprocedure)")" = "p_items jsonb, p_customer_name text, p_customer_phone text, p_governorate text, p_address text, p_notes text, p_idempotency_key text, p_request_hash text, p_checkout_session_hash text, p_receipt_token_hash text, p_area text, p_installation boolean, p_coupon_code text, p_preferred_delivery jsonb, p_shipping_method text" ]; then ok=yes; fi
record "S24 zell_create_order (15): new md5, owner postgres, security definer, search_path and EXECUTE grants exactly as before" "$ok" "fp0=$FP0 fp1=$FP1"
apply_ex; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_ALREADY_APPLIED' && [ "$(impact)" = "$AFTER" ]; then ok=yes; fi
record "S25 apply twice -> refused (ALREADY_APPLIED)" "$ok" "E=$E"
run_ptest production; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/ptest.out" 'ZELL_0021EX_PTEST_PRE_APPLY_ONLY'; then ok=yes; fi
record "S26 ptest after apply -> PRE_APPLY_ONLY" "$ok" "E=$E"

# ── S3: فحوص التحقق بالحالتين: مفيش بصمة مجهولة ولا overload ولا خليط ──
extract_def "$CO15" "$APPLY" | awk 'NR == 1 {sub(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION")} {print} /^AS \$function\$$/ && !d {print "-- ci tamper"; d = 1}' \
  | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/tamper.out" 2>&1
VT=$(v3)
extract_def "$CO15" "$APPLY" | awk 'NR == 1 {sub(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION")} {print}' \
  | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/restore.out" 2>&1
ok=no; if [ "$VT" = "PASS|FAIL|FAIL" ] && [ "$(v3)" = "PASS|PASS|PASS" ] && [ "$(co_fp)" = "$FP1" ]; then ok=yes; fi
record "S30 changed body (unknown md5) -> P1 + EX verify FAIL; restored verbatim -> PASS, fingerprint back" "$ok" "tampered=$VT now=$(v3) $(tail -n 2 "$TMP/tamper.out" | tr '\n' ' ')"
extract_def "$CO14" "$P1APPLY" | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/overload.out" 2>&1
VO=$(v3)
q "drop function public.zell_create_order($SIG14)" > /dev/null
ok=no; if [ "$(rf "$VO" 1)" != "PASS" ] && [ "$(rf "$VO" 2)" = "FAIL" ] && [ "$(rf "$VO" 3)" = "FAIL" ] && [ "$(v3)" = "PASS|PASS|PASS" ]; then ok=yes; fi
record "S31 overload (14 + 15) -> D verify not PASS (errors on two rows), P1 + EX verify FAIL; dropped -> PASS" "$ok" "overload=$VO now=$(v3)"
q "alter table public.zell_shipping_options rename to ci_hidden_options" > /dev/null
VX=$(v3 | cut -d'|' -f1-2)
q "alter table public.ci_hidden_options rename to zell_shipping_options" > /dev/null
ok=no; if [ "$VX" = "FAIL|FAIL" ] && [ "$(v3)" = "PASS|PASS|PASS" ]; then ok=yes; fi
record "S32 mixed state (15 args without the options table) -> D and P1 verify FAIL; restored -> PASS" "$ok" "mixed=$VX"

# ── S4: السلوك ──
load_old_copy; E=$?
R=$(q "$PARITY_SQL" | tail -n 1)
ok=no
if [ "$E" -eq 0 ] && [ "$(rf "$R" 1)" = "520" ] && [ "$(rf "$R" 2)" = "0" ] && [ "$(rf "$R" 3)" -ge 50 ] && [ "$(rf "$R" 4)" -ge 1 ] \
   && [ "$(rf "$R" 5)" -ge 5 ] && [ "$(rf "$R" 6)" = "0" ]; then ok=yes; fi
record "S40 old (P1) / new matrix, 520 cases x 4 calls: no parameter = standard = old (response · row · lines · deposit), snapshot standard + days; express = full price, no free shipping, same rejections" "$ok" "E=$E R=$(printf '%s' "$R" | cut -c1-900) $(tail -n 2 "$TMP/old_copy.out" | tr '\n' ' ')"
run_file "$FLOWS" "$TMP/flows.out"; E=$?; S=$(summary_of "$TMP/flows.out")
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$S" 9)" = "PASS" ] && [ "$(rf "$S" 7)" = "38" ] && [ "$(rf "$S" 8)" = "0" ]; then ok=yes; fi
record "S41 flows (F01–F42) -> PASS (38 pass, 0 fail)" "$ok" "E=$E S=$S fails=$(fails_of "$TMP/flows.out") tail=$(tail -n 3 "$TMP/flows.out" | tr '\n' ' ' | cut -c1-600)"
ROW=$(q "select express_enabled || '|' || governorates::text || '|' || (select count(*) from public.zell_shipping_options_log) || '|' || (select count(*) from public.orders where shipping_method is not null) from public.zell_shipping_options")
ok=no; if [ "$ROW" = "false|{}|0|0" ] && [ "$(rf "$(verify_ex)" 7)" = "PASS" ]; then ok=yes; fi
R2=$(q "$IMPACT_SQL")
record "S42 matrix + flows left nothing (options = apply values, log empty, no orders), EX verify PASS" "$ok" "row=$ROW impact=$R2"
R=$(psql -X -q -tA -v ON_ERROR_STOP=1 -U "$SUPER" -d "$DB" 2>&1 <<'SQL'
do $c$
declare
  r record;
  v text := '';
begin
  set local session_replication_role = replica;
  for r in select * from (values (1, 'express', null::integer, null::integer), (2, 'fast', null, null), (3, 'standard', 5, 3),
                                 (4, null, 1, 2), (5, 'standard', 1, null), (6, 'standard', 0, 61),
                                 (7, 'express', 1, 2), (8, 'standard', null, null), (9, null, null, null), (10, 'standard', 0, 60)) t(n, m, a, b) loop
    begin
      insert into public.orders (order_number, status, customer_name, customer_phone, governorate, address,
        subtotal_piastres, shipping_piastres, total_piastres, shipping_method, shipping_days_min, shipping_days_max)
      values ('FLM-CXEX' || substr('ABCDEFGHJK', r.n, 1) || 'Z', 'new', 'عميل', '01011111111', 'القاهرة', 'عنوان طويل كفاية',
              60000, 5000, 65000, r.m, r.a, r.b);
      v := v || 'ok,';
    exception when others then
      v := v || sqlstate || ',';
    end;
  end loop;
  raise exception 'CIRES %', v;
end
$c$;
SQL
)
ok=no; if printf '%s' "$R" | grep -q 'CIRES 23514,23514,23514,23514,23514,23514,ok,ok,ok,ok,'; then ok=yes; fi
record "S43 orders shape check: method standard / express / NULL only · days both or none, 0 <= min <= max <= 60 · days need a method · express needs days" "$ok" "$(printf '%s' "$R" | grep -o 'CIRES.*' | head -n 1)"
R=$(srq <<'SQL'
select public.zell_create_order(p_items => '[{"productId":1,"lengthCm":300}]'::jsonb, p_customer_name => 'عميل CI', p_customer_phone => '01099999999',
         p_governorate => 'القاهرة', p_address => 'عنوان CI طويل كفاية', p_notes => null, p_idempotency_key => 'ci-0021ex-committed-0001',
         p_request_hash => repeat('a', 64), p_checkout_session_hash => repeat('b', 64), p_receipt_token_hash => repeat('c', 64),
         p_shipping_method => 'standard') ->> 'shipping_piastres';
SQL
)
RA=$(q "set role anon; select public.zell_create_order(p_items => '[]'::jsonb, p_customer_name => 'x', p_customer_phone => 'x', p_governorate => 'x', p_address => 'x', p_notes => null, p_idempotency_key => 'x', p_request_hash => 'x', p_checkout_session_hash => 'x', p_receipt_token_hash => 'x', p_shipping_method => 'express')")
RU=$(q "set role authenticated; select public.zell_create_order(p_items => '[]'::jsonb, p_customer_name => 'x', p_customer_phone => 'x', p_governorate => 'x', p_address => 'x', p_notes => null, p_idempotency_key => 'x', p_request_hash => 'x', p_checkout_session_hash => 'x', p_receipt_token_hash => 'x', p_shipping_method => 'express')")
SN=$(q "select shipping_method || '|' || coalesce(shipping_days_min::text, '-') || '|' || shipping_piastres from public.orders where idempotency_key = 'ci-0021ex-committed-0001'")
ok=no
if [ "$R" = "5000" ] && [ "$SN" = "standard|-|5000" ] && printf '%s' "$RA" | grep -q 'permission denied' && printf '%s' "$RU" | grep -q 'permission denied'; then ok=yes; fi
record "S44 service_role calls by name with p_shipping_method (committed order: standard, no days) · anon / authenticated denied" "$ok" "R=$R snap=$SN anon=$(printf '%s' "$RA" | head -c 160) auth=$(printf '%s' "$RU" | head -c 160)"
PRE=$(impact); ST=$(ex_state)
rollback_ex; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021EX_RB_HAS_ORDERS' && [ "$(ex_state)" = "$ST" ] && [ "$(impact)" = "$PRE" ]; then ok=yes; fi
record "S45 rollback after an order was created -> refused (HAS_ORDERS), nothing changed" "$ok" "E=$E $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-400)"

# ── S46: شحن العرض في المتجر (packages/core) = الداتابيز (EXPRESS-SHIPPING W2) ──
if node --experimental-strip-types "$CIDIR/0021ex_core_parity.mjs" > "$TMP/parity.sql" 2> "$TMP/parity.err"; then
  R=$(psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f "$TMP/parity.sql" 2>&1 | tail -n 1)
else
  R="node failed: $(tail -n 5 "$TMP/parity.err" | tr '\n' ' ')"
fi
ok=no; if [ "$(rf "$R" 1)" = "240" ] && [ "$(rf "$R" 2)" = "0" ]; then ok=yes; fi
record "S46 display shipping (packages/core: standard price · express offer · days) = zell_create_order on 240 cases (20 settings x 2 governorates x 3 subtotals x 2 methods)" "$ok" "$(printf '%s' "$R" | cut -c1-600)"

# ── S5: الرجوع ──
if ! prep with_tr; then record "S50 prep" "no" "see output"; fi
PRE=$(impact); FPPRE=$(co_fp)
apply_ex; E1=$?
run_file "$ROLLBACK" "$TMP/rbna.out"; E=$?
ok=no; if [ "$E1" -eq 0 ] && [ "$E" -ne 0 ] && has "$TMP/rbna.out" 'ZELL_0021EX_RB_APPROVAL_MISSING' && [ "$(ex_state)" = "1|1|4|3|15" ]; then ok=yes; fi
record "S50 rollback without the approval line -> refused, nothing changed" "$ok" "E1=$E1 E=$E"
rollback_ex; E=$?
V2=$(verdicts_old); FPRB=$(co_fp)
ok=no
if [ "$E" -eq 0 ] && [ "$(ex_state)" = "0|0|0|0|14" ] && [ "$FPRB" = "$FPPRE" ] && [ "$FPRB" = "$FP0" ] && [ "$(rf "$FPRB" 1)" = "$OLD_MD5" ] \
   && [ "$(rf "$FPRB" 2)" = "$OLD_DEF_MD5" ] && [ "$(rf "$FPRB" 3)" = "$OLD_DEF_SHA" ] && [ "$(impact)" = "$PRE" ] && [ "$PRE" = "$BEFORE" ] \
   && [ "$V2" = "$ALL7" ]; then ok=yes; fi
record "S51 clean rollback -> EX objects gone, zell_create_order = R1 (md5 · functiondef md5 · sha256 · owner · grants), impact = before, 7 verify PASS (D / P1 back to 14 + 811d…)" "$ok" "E=$E state=$(ex_state) fp=$FPRB pre=$PRE now=$(impact) V=$V2 $(tail -n 3 "$TMP/rb.out" | tr '\n' ' ')"
apply_ex; E=$?; EXV=$(verify_ex)
ok=no; if [ "$E" -eq 0 ] && [ "$(rf "$EXV" 7)" = "PASS" ] && [ "$(verdicts_old)" = "$ALL7" ] && [ "$(co_fp)" = "$FP1" ]; then ok=yes; fi
record "S52 re-apply after a clean rollback -> EX verify PASS, same fingerprint" "$ok" "E=$E EX=$EXV fails=$(fails_of "$TMP/exv.out")"
rollback_ex; E=$?
cp "$TMP/rb.out" "$TMP/rb1.out"
rollback_ex; E2=$?
ok=no; if [ "$E" -eq 0 ] && [ "$E2" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021EX_RB_NOT_APPLIED' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S53 rollback twice -> second refused (NOT_APPLIED)" "$ok" "E=$E E2=$E2 $(tail -n 2 "$TMP/rb1.out" | tr '\n' ' ')"
apply_ex; E1=$?
psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/save.out" 2>&1 <<SQL
begin;
select pg_catalog.set_config('request.jwt.claims', '{"sub": "$OWNER_ID", "role": "authenticated"}', true);
set local role authenticated;
select public.zell_shipping_options_save((public.zell_shipping_options_get() ->> 'updated_at')::timestamptz, true,
  '{"القاهرة": {"express_enabled": true, "express_price_piastres": 12000, "express_days_min": 1, "express_days_max": 2, "standard_days_min": 3, "standard_days_max": 5}}'::jsonb);
commit;
SQL
E=$?
CHK=$(q "set role service_role; select (public.zell_shipping_options_checkout() -> 'governorates' -> 'القاهرة' ->> 'express_price_piastres') || '|' || (public.zell_shipping_options_checkout() ->> 'express_enabled')")
EXV=$(verify_ex)
PRE=$(impact); ST=$(ex_state)
rollback_ex; E2=$?
ok=no
if [ "$E1" -eq 0 ] && [ "$E" -eq 0 ] && [ "$CHK" = "12000|true" ] && [ "$(rf "$EXV" 7)" = "PASS" ] && [ "$E2" -ne 0 ] && has "$TMP/rb.out" 'ZELL_0021EX_RB_HAS_CONFIG_DATA' \
   && [ "$(ex_state)" = "$ST" ] && [ "$(impact)" = "$PRE" ] && [ "$(q "select count(*) from public.zell_shipping_options_log")" = "1" ]; then ok=yes; fi
record "S54 committed owner save -> checkout reads it, EX verify PASS (V07 = last log); rollback refused (HAS_CONFIG_DATA), nothing changed" "$ok" "E1=$E1 E=$E chk=$CHK EX=$EXV E2=$E2 $(tr '\n' ' ' < "$TMP/save.out" | cut -c1-300) $(grep -m2 -E 'ERROR|ZELL' "$TMP/rb.out" | tr '\n' ' ' | cut -c1-300)"

# ── S6: حراس الـ preflight ──
if ! prep with_tr; then record "S60 prep" "no" "see output"; fi
q "create function public.ci_code_taken() returns text language sql as \$c\$ select 'ZELL_X 45431' \$c\$" > /dev/null
apply_ex; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_CODE_TAKEN' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S60 45431 already used by another function -> refused (CODE_TAKEN), nothing changed" "$ok" "E=$E"
q "drop function public.ci_code_taken()" > /dev/null
extract_def "$CO14" "$P1APPLY" | awk '{print} /^AS \$function\$$/ && !d {print "-- ci drift"; d = 1}' \
  | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/drift.out" 2>&1
apply_ex; E=$?
extract_def "$CO14" "$P1APPLY" | psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" > "$TMP/undrift.out" 2>&1
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_CREATE_ORDER_DRIFT' && [ "$(co_fp)" = "$FP0" ]; then ok=yes; fi
record "S61 zell_create_order not the R1 body -> refused (CREATE_ORDER_DRIFT), nothing changed" "$ok" "E=$E fp=$(co_fp)"
q "create function public.zell_create_order(p_x integer) returns jsonb language sql as \$c\$ select null::jsonb \$c\$" > /dev/null
apply_ex; E=$?
q "drop function public.zell_create_order(integer)" > /dev/null
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_CREATE_ORDER_OVERLOADS' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S62 a second zell_create_order -> refused (CREATE_ORDER_OVERLOADS)" "$ok" "E=$E"
su_sql "$DB" "alter function public.zell_create_order($SIG14) owner to zell_order_writer"
apply_ex; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_CREATE_ORDER_OWNER' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S63 zell_create_order owner not postgres -> refused (CREATE_ORDER_OWNER)" "$ok" "E=$E"
if ! prep without_tr; then record "S64 prep" "no" "see output"; fi
apply_ex; E=$?
ok=no; if [ "$E" -ne 0 ] && has "$TMP/apply.out" 'ZELL_0021EX_PREREQ_MISSING' && [ "$(ex_state)" = "0|0|0|0|14" ]; then ok=yes; fi
record "S64 apply before TR -> refused (PREREQ_MISSING), nothing changed" "$ok" "E=$E"

echo "ZELL_0021EX_SQL_CI_RESULT pass=$PASS fail=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
