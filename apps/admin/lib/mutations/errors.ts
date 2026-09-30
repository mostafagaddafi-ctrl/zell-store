import 'server-only'

import type { MutationResult } from '../mutations'

const INTERNAL_MESSAGE = 'حصل خطأ غير متوقع. حاول تاني، ولو اتكرر بلّغ.'

/**
 * ⚠️ الاستثناء **بيتجاهل عن قصد**.
 *
 * أي تفصيلة جاية من Supabase — اسم عمود، اسم قيد، جزء من استعلام،
 * رقم صف — ممنوعة تخرج للعميل. نص ثابت واحد لكل الأخطاء غير المتوقعة.
 * التفاصيل الحقيقية مكانها لوجات السيرفر.
 *
 * البارامتر موجود عشان نقطة النداء تبقى واضحة، ومابيتقراش.
 */
export function toInternalFailure(_error: unknown): MutationResult<never> {
  return { ok: false, code: 'INTERNAL', message: INTERNAL_MESSAGE }
}
