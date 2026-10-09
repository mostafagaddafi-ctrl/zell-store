import 'server-only'

import { restGet, restPatch } from '../data/client'

export const CONFLICT_MESSAGE =
  'حد تاني عدّل السجل ده وإنت بتعدّل. اعمل تحديث للصفحة وشوف التغييرات قبل ما تحفظ تاني.'
export const NOT_FOUND_MESSAGE = 'السجل مش موجود. يمكن يكون اتمسح.'

/** رمز النسخة اللي بترجعه عمليات الحفظ الذرّية. */
export type SaveVersion = { updatedAt: string }

export type GuardFailure = { ok: false; code: 'CONFLICT' | 'NOT_FOUND'; message: string }

/**
 * مقارنة بدقة **الميلي ثانية**.
 *
 * Postgres بيخزّن ميكروثانية وJavaScript بيقرا ميلي. المقارنة النصية
 * المباشرة كانت هتدي تعارض وهمي لأي طابع عدّى على الواجهة ورجع،
 * فالمقارنة بتتم على القيمة الرقمية بعد Date.parse.
 */
export function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left)
  const b = Date.parse(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return a === b
}

type VersionRow = { updated_at: string }

/**
 * PATCH محمي بالتزامن التفاؤلي — خمس خطوات:
 *
 *   ١. اقرا updated_at الحالي من الداتابيز
 *   ٢. مفيش صف                       -> NOT_FOUND
 *   ٣. قارنه بالمتوقع بدقة الميلي     -> CONFLICT لو مختلف
 *   ٤. PATCH بفلتر updated_at = القيمة اللي **إحنا** قريناها
 *      (مش اللي جاية من العميل — دي الخطوة اللي بتقفل السباق)
 *   ٥. صفر صفوف متأثرة               -> CONFLICT (حد كتب بين ١ و ٤)
 *
 * الخطوة ٣ بتدي الدقة المطلوبة، والخطوة ٤ بتدي الذرّية. الاتنين
 * لازمين — ولا واحدة فيهم صح لوحدها.
 *
 * ومفيش trigger على updated_at، فالقيمة الجديدة بتتبعت صراحة.
 */
export async function patchGuarded<T>(args: {
  table: string
  idColumn: string
  idValue: string | number
  expectedUpdatedAt: string
  changes: Record<string, unknown>
  select?: string
}): Promise<{ ok: true; rows: T[] } | GuardFailure> {
  const filter = args.idColumn + '=eq.' + encodeURIComponent(String(args.idValue))

  const current = await restGet<VersionRow>(args.table, 'select=updated_at&' + filter + '&limit=1')
  const row = current.rows[0]
  if (!row) return { ok: false, code: 'NOT_FOUND', message: NOT_FOUND_MESSAGE }

  if (!sameInstant(args.expectedUpdatedAt, row.updated_at)) {
    return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
  }

  const parts = [filter, 'updated_at=eq.' + encodeURIComponent(row.updated_at)]
  if (args.select !== undefined) parts.push('select=' + args.select)

  const changes = { ...args.changes, updated_at: new Date().toISOString() }
  const affected = await restPatch<T>(args.table, parts.join('&'), changes)
  if (affected.length === 0) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }

  return { ok: true, rows: affected }
}
