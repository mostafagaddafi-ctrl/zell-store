import 'server-only'

import { restRpc, sentinelOf } from '../data/client'
import type { MutationResult } from '../mutations'
import {
  validateIdentity,
  validateShipping,
  type IdentityInput,
  type ShippingInput,
} from '../validation/settings'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, type SaveVersion } from './concurrency'
import { toInternalFailure } from './errors'

const SHIPPING_RPC = 'zell_save_shipping'
const IDENTITY_RPC = 'zell_save_identity'

/**
 * الرموز دي **المفروض** ما توصلش: التحقق في lib/validation/settings.ts
 * مرآة لفحص الدالة. بنمسكها كشبكة أمان عشان لو الاتنين اختلفوا في
 * المستقبل يطلع VALIDATION مش "خطأ غير متوقع".
 */
const SHIPPING_REJECTED = 'قيم الشحن مرفوضة. راجع الأرقام وحاول تاني.'
const IDENTITY_REJECTED = 'بيانات المتجر مرفوضة. راجع الحقول وحاول تاني.'

export async function saveShipping(
  input: ShippingInput,
  rawStamp: unknown,
): Promise<MutationResult<SaveVersion>> {
  const validated = validateShipping(input)
  if (!validated.ok) return validated

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  const value = validated.value

  try {
    const changedAt = await restRpc<string | null>(SHIPPING_RPC, {
      p_expected_updated_at: stamp.value,
      p_rates: value.rates,
      p_default_piastres: value.defaultPiastres,
      p_free_threshold_piastres: value.freeThresholdPiastres,
      p_disabled: value.disabled,
    })

    if (changedAt === null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    return { ok: true, data: { updatedAt: changedAt } }
  } catch (error) {
    if (sentinelOf(error) === 'ZELL_INVALID_SHIPPING') {
      return { ok: false, code: 'VALIDATION', message: SHIPPING_REJECTED }
    }
    return toInternalFailure(error)
  }
}

/**
 * هوية المتجر — أربعة مفاتيح.
 *
 * ⚠️ اللوجو **مش** من ضمنهم. zell_save_identity مابتلمسش logo_url،
 * وطابع النسخة بيتحسب على الأربعة دول بس (شوف IDENTITY_SAVE_KEYS في
 * طبقة القراءة). لو الطابع كان بيتحسب على اللوجو كمان، أي تغيير
 * للوجو كان هيدي CONFLICT وهمي لحفظ الهوية.
 */
export async function saveIdentity(
  input: IdentityInput,
  rawStamp: unknown,
): Promise<MutationResult<SaveVersion>> {
  const validated = validateIdentity(input)
  if (!validated.ok) return validated

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  const value = validated.value

  try {
    const changedAt = await restRpc<string | null>(IDENTITY_RPC, {
      p_expected_updated_at: stamp.value,
      p_store_name: value.storeName,
      p_offer_text: value.offerText,
      p_whatsapp_number: value.whatsappNumber,
      p_whatsapp_message: value.whatsappMessage,
    })

    if (changedAt === null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    return { ok: true, data: { updatedAt: changedAt } }
  } catch (error) {
    if (sentinelOf(error) === 'ZELL_INVALID_IDENTITY') {
      return { ok: false, code: 'VALIDATION', message: IDENTITY_REJECTED }
    }
    return toInternalFailure(error)
  }
}
