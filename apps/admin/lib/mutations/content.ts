import 'server-only'

import { restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { validateContent, type ContentInput } from '../validation/content'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, type SaveVersion } from './concurrency'
import { toInternalFailure } from './errors'

const RPC = 'zell_save_content'

/**
 * حفظ محتوى المتجر — الستة مفاتيح مع بعض.
 *
 * الذرّية كلها جوه zell_save_content: بتقفل الصفوف بـ FOR UPDATE،
 * بتقارن أحدث updated_at بدقة الميلي ثانية، وبترجّع null من غير أي
 * كتابة لو النسخة قديمة.
 *
 * ⚠️ الفحص والكتابة في نفس المعاملة — وده اللي GET-ثم-UPSERT من
 * الكود ماكانش يقدر يوفّره.
 */
export async function saveContent(input: ContentInput, rawStamp: unknown): Promise<MutationResult<SaveVersion>> {
  const validated = validateContent(input)
  if (!validated.ok) return validated

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  const payload = validated.payload

  try {
    const changedAt = await restRpc<string | null>(RPC, {
      p_expected_updated_at: stamp.value,
      p_hero: payload.hero,
      p_order_steps: payload.orderSteps,
      p_faqs: payload.faqs,
      p_sections: payload.sections,
      p_footer_links: payload.footerLinks,
      p_trust_line: payload.trustLine,
      p_announcement: payload.announcement,
    })

    if (changedAt === null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    return { ok: true, data: { updatedAt: changedAt } }
  } catch (error) {
    return toInternalFailure(error)
  }
}
