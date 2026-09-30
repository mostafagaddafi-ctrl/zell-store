#!/usr/bin/env bash
#
# Vercel — Ignored Build Step
# ═══════════════════════════════════════════════════════════════
#
#   exit 0  →  تخطّي البناء
#   exit 1  →  تنفيذ البناء
#
# ⚠️ نطاق السكربت بالظبط:
#   بيقلّل **البناءات الكاملة**. وهو ما يضمنش إن Vercel مش هيحسب
#   النشر المتخطّى ضمن حدود الخطة — النشر بيتعمل والسكربت بيتنفّذ
#   جواه، اللي بيتوفّر هو خطوة البناء نفسها.
#
#   الحل التشغيلي الحقيقي هو **تقليل عدد الكوميتات المرفوعة**.
#   السكربت ده حاجز وقائي، مش بديل عن ده.
#
# ── نموذج الأمان ────────────────────────────────────────────────
#
#   1. علامة [force deploy]            → ابنِ
#   2. production                      → ابنِ **دايمًا** (مفيش فلترة مسارات)
#   3. معاينة برسالة wip أو [skip deploy] → تخطّى
#   4. معاينة نهائية:
#        • merge-base مع origin/main متاح → افحص مسارات الفرع كله
#        • مش متاح                        → ابنِ (مفيش رجوع لـ HEAD^)
#   5. أي غموض أو خطأ                   → ابنِ
#
#   القاعدة الحاكمة: بناء زيادة بيكلّف حصة. بناء ناقص بيسيب الإنتاج
#   على نسخة قديمة من غير ما حد ياخد باله. الخطأ الأول مقبول، والتاني لأ.
#
#   ملحوظة: HEAD^ **مش مستخدم نهائيًا**. لو كوميت wip غيّر ملفات
#   واتخطّى، مقارنة بالأب كانت هتفوّت التغيير ده. المقارنة بنقطة
#   التفرّع بتشوف الفرع كله.
#
# ── الاستخدام ──────────────────────────────────────────────────
#
#   bash <path>/scripts/vercel-ignore-build.sh storefront
#   bash <path>/scripts/vercel-ignore-build.sh admin
#
#   ⚠️ مجلد العمل اللي Vercel بيشغّل منه **مش مفترض هنا**.
#   قبل ضبط الأمر، شغّل التشخيص ده مرة واحدة كـ Ignored Build Step
#   وشوف اللوج:
#
#       pwd; git rev-parse --show-toplevel; exit 1
#
#   (exit 1 عشان البناء يكمل عادي أثناء التشخيص.)
#   وبعدين اضبط المسار على النتيجة. لو بيشغّل من جذر الريبو:
#
#       bash scripts/vercel-ignore-build.sh storefront
#
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

APP="${1:-}"

log()   { echo "[ignore-build] $*"; }
build() { log "BUILD — $1"; exit 1; }
skip()  { log "SKIP  — $1";  exit 0; }

# ── المسارات اللي تخص كل تطبيق ─────────────────────────────────
case "$APP" in
  storefront) WATCH=("apps/storefront/" "packages/core/") ;;
  admin)      WATCH=("apps/admin/"      "packages/core/") ;;
  *)          build "اسم تطبيق غير معروف: '$APP'" ;;
esac

# مدخلات بناء مشتركة — أي تغيير فيها يخص كل التطبيقات
WATCH+=("pnpm-lock.yaml" "pnpm-workspace.yaml" "package.json" "tsconfig.base.json")

MSG="${VERCEL_GIT_COMMIT_MESSAGE:-}"
ENVIRONMENT="${VERCEL_ENV:-preview}"
REF="${VERCEL_GIT_COMMIT_REF:-unknown}"

log "app=$APP env=$ENVIRONMENT ref=$REF"

# ── 1) تجاوز صريح — يكسب على أي قاعدة تانية ────────────────────
case "$MSG" in
  *"[force deploy]"*) build "علامة [force deploy] صريحة" ;;
esac

# ── 2) production بيبني دايمًا ─────────────────────────────────
# مفيش فلترة مسارات ولا قاعدة wip هنا. عدد نشرات الإنتاج قليل،
# وخطر تفويت نشرة أكبر بكتير من تكلفة بناء زيادة.
if [ "$ENVIRONMENT" = "production" ]; then
  build "نشر إنتاج — بيبني دايمًا"
fi

# ── 3) الكوميتات الوسيطة على المعاينات ─────────────────────────
case "$MSG" in
  wip*|*"[skip deploy]"*) skip "كوميت وسيط على $REF" ;;
esac

# ── 4) معاينة نهائية: افحص الفرع كله مقابل نقطة التفرّع ────────
if ! MERGE_BASE="$(git merge-base origin/main HEAD 2>/dev/null)" || [ -z "$MERGE_BASE" ]; then
  build "merge-base مع origin/main مش متاح (clone سطحي غالبًا)"
fi

if ! CHANGED="$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null)"; then
  build "فشل حساب الفروق مقابل $MERGE_BASE"
fi

if [ -z "$CHANGED" ]; then
  skip "الفرع مافيهوش أي تغيير مقابل origin/main"
fi

while IFS= read -r file; do
  [ -z "$file" ] && continue
  for prefix in "${WATCH[@]}"; do
    case "$file" in
      "$prefix"*) build "$file اتغيّر" ;;
    esac
  done
done <<< "$CHANGED"

skip "مفيش تغيير تحت: ${WATCH[*]}"
