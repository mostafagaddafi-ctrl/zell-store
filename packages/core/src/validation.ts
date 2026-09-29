/** تحقق المدخلات — مشترك بين الواجهة والسيرفر. */
import type { CheckoutValues } from './types'

/** تنظيف رقم الموبايل المصري: أرقام لاتينية فقط بصيغة 01XXXXXXXXX. */
export function normalizePhone(raw: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  let digits = ''
  for (const ch of raw.trim()) {
    const ai = arabicDigits.indexOf(ch)
    if (ai >= 0) digits += String(ai)
    else if (ch >= '0' && ch <= '9') digits += ch
  }
  if (digits.startsWith('0020')) digits = digits.slice(4)
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits
  return digits
}

export function isValidEgyptianPhone(raw: string): boolean {
  return /^01[0125][0-9]{8}$/.test(normalizePhone(raw))
}

export type CheckoutErrors = {
  customerName?: string
  customerPhone?: string
  governorate?: string
  address?: string
}

/** نفس القواعد المطبّقة في السيرفر — الواجهة بتعرضها بدري بس. */
export function validateCheckout(values: CheckoutValues, governorates: string[]): CheckoutErrors {
  const errors: CheckoutErrors = {}

  if (values.customerName.trim().length < 3) errors.customerName = 'اكتب الاسم بالكامل'
  if (!isValidEgyptianPhone(values.customerPhone)) errors.customerPhone = 'رقم موبايل مصري غير صحيح'

  if (!values.governorate) errors.governorate = 'اختر المحافظة'
  else if (governorates.length > 0 && !governorates.includes(values.governorate)) {
    errors.governorate = 'المحافظة دي مش ضمن مناطق الشحن المتاحة'
  }

  if (values.address.trim().length < 8) errors.address = 'اكتب العنوان بالتفصيل'

  return errors
}

export function hasErrors(errors: CheckoutErrors): boolean {
  return Object.keys(errors).length > 0
}
