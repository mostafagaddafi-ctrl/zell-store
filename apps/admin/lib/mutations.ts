import 'server-only'

/**
 * نتيجة التعديل الموحّدة.
 *
 * CONFLICT **نتيجة متوقعة** مش استثناء — بتحصل لما optimistic concurrency
 * يلاقي إن السجل اتغيّر. أي استثناء غير متوقع بيتحول INTERNAL من غير أي
 * تفاصيل تقنية تخرج للعميل.
 */
export type MutationErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'STORAGE_ERROR' | 'INTERNAL'

export type MutationResult<T> = { ok: true; data: T } | { ok: false; code: MutationErrorCode; message: string }

/**
 * علم الجاهزية — من متغيرات البيئة، مش من الكود ولا من vercel.json.
 * بيفضل false لحد ما تسجيل الدخول والمفاتيح وربط محتوى المتجر
 * والتحقق من الكتابة يخلصوا كلهم.
 */
export function mutationsEnabled(): boolean {
  return (process.env['ADMIN_MUTATIONS_ENABLED'] ?? '').trim() === 'true'
}

const DISABLED_MESSAGE =
  'التعديلات موقوفة دلوقتي. هتتفتح بعد ربط محتوى المتجر وتشغيل تسجيل الدخول والتحقق من الحفظ.'

/**
 * حارس كل Server Action.
 *
 * ملاحظة على العقد: مفيش كود مخصص لحالة «موقوف» في قائمة الأكواد،
 * فالحالة دي بترجع INTERNAL برسالة صريحة. الواجهة **مش بتعتمد** على ده —
 * هي بتعطّل الأزرار من العلم قبل أي نداء، والحارس طبقة دفاع تانية.
 * لو حبيتوا نضيف كود DISABLED للقائمة، أنا موافق وبفضّله.
 */
export function guardMutations(): MutationResult<never> | null {
  if (mutationsEnabled()) return null
  return { ok: false, code: 'INTERNAL', message: DISABLED_MESSAGE }
}
