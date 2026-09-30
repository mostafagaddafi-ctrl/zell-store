import 'server-only'

/**
 * نتيجة التعديل الموحّدة.
 *
 * UNAUTHENTICATED و FORBIDDEN **نتايج متوقعة** برضه:
 * الأولى يعني مفيش جلسة، والتانية يعني في جلسة بس الحساب مش في
 * admin_users أو موقوف. الاتنين بيرجعوا من requireAdminAction
 * **قبل** أي فحص تاني.
 *
 * CONFLICT نتيجة متوقعة مش استثناء — بتحصل لما optimistic concurrency
 * يلاقي إن السجل اتغيّر.
 *
 * DISABLED كذلك حالة تشغيلية متوقعة — التعديلات موقوفة بعلم الجاهزية،
 * وده مش خطأ داخلي.
 *
 * أي استثناء غير متوقع بيتحول INTERNAL من غير أي تفاصيل تقنية تخرج للعميل.
 */
export type MutationErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DISABLED'
  | 'STORAGE_ERROR'
  | 'INTERNAL'

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
 * حارس كل Server Action — طبقة دفاع تانية.
 * الواجهة بتعطّل الأزرار من العلم قبل أي نداء، فالحارس ده مايفترضش
 * إنه هو خط الدفاع الأول.
 *
 * ⚠️ الترتيب مهم: الصلاحية الأول (requireAdminAction) وبعدين العلم.
 * العكس بيقول لمستخدم مش مسجّل إن "التعديلات موقوفة"، وده تسريب
 * معلومة عن حالة النظام لمجهول.
 */
export function guardMutations(): MutationResult<never> | null {
  if (mutationsEnabled()) return null
  return { ok: false, code: 'DISABLED', message: DISABLED_MESSAGE }
}
