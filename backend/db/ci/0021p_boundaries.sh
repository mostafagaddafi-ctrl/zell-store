#!/usr/bin/env bash
# 0021-P — حدود المحرك والمحوّل (CI).
#   • ملفات المحرك = backend/db/migrations/*_erp_*.sql ما عدا *_zell_erp_*.sql.
#   • ممنوع فيها (بعد شيل التعليقات) أي zell_ أو جداول ZELL (orders · order_items · admin_users · settings · products · product_widths).
#   • ممنوع أي ملف محرك غير 0021p_erp_access.sql يذكر erp_actor_status_v1 (المحوّل هو اللي يملك جسمها).
#   • الفاحص بيختبر نفسه على ملفات غلط عن قصد قبل ما يفحص الريبو.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

check_dir() {
  local dir="$1" f base code bad=0 n=0
  for f in "$dir"/*_erp_*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in *_zell_erp_*) continue ;; esac
    n=$((n + 1))
    code="$(sed -e 's/--.*$//' "$f")"
    if printf '%s\n' "$code" | grep -qE '(^|[^a-z0-9_])zell_|(^|[^a-z0-9_.])(orders|order_items|admin_users|settings|products|product_widths)([^a-z0-9_]|$)'; then
      echo "BOUNDARY FAIL $base references application objects"
      bad=1
    fi
    if [ "$base" != "0021p_erp_access.sql" ] && printf '%s\n' "$code" | grep -q 'erp_actor_status_v1'; then
      echo "BOUNDARY FAIL $base touches erp_actor_status_v1"
      bad=1
    fi
  done
  CHECKED=$n
  return $bad
}

SELF="$(mktemp -d)"
printf 'create function public.erp_x() returns int language sql as $f$ select count(*)::int from public.admin_users $f$;\n' > "$SELF/0099_erp_bad_table.sql"
if check_dir "$SELF" > /dev/null; then echo "SELFTEST FAIL table reference not caught"; exit 1; fi
rm -f "$SELF"/*.sql
printf 'create or replace function public.erp_actor_status_v1(p uuid) returns table (a boolean, b boolean) language sql as $f$ select true, true $f$;\n' > "$SELF/0099_erp_bad_iface.sql"
if check_dir "$SELF" > /dev/null; then echo "SELFTEST FAIL interface overwrite not caught"; exit 1; fi
rm -f "$SELF"/*.sql
printf -- '-- zell_ admin_users erp_actor_status_v1 in a comment only\nselect 1;\n' > "$SELF/0099_erp_comment_only.sql"
printf 'select public.zell_erp_x();\n' > "$SELF/0099_zell_erp_adapter.sql"
if ! check_dir "$SELF" > /dev/null; then echo "SELFTEST FAIL clean files rejected"; exit 1; fi
rm -rf "$SELF"
echo "BOUNDARY selftest ok"

if check_dir "$ROOT/backend/db/migrations"; then
  echo "ZELL_0021P_BOUNDARIES_RESULT engine_files=$CHECKED fail=0"
else
  echo "ZELL_0021P_BOUNDARIES_RESULT engine_files=$CHECKED fail=1"
  exit 1
fi
