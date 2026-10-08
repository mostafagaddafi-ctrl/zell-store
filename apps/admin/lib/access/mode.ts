/**
 * 0021-P — قراية ADMIN_ACCESS_MODE. منطق صافي من غير I/O.
 *
 *   غايب أو فاضي = legacy.
 *   legacy · shadow · enforce بالظبط (من غير مسافات ولا حروف كبيرة) = الوضع ده.
 *   أي قيمة تانية = legacy، و valid=false علشان «حالة النظام» تعرضها غلط بالأحمر.
 *
 * العقد: docs/contracts/0021-P-code.md §٣.
 */

export const ACCESS_MODES = ['legacy', 'shadow', 'enforce'] as const

export type AccessMode = (typeof ACCESS_MODES)[number]

export type AccessModeReading = { mode: AccessMode; raw: string; valid: boolean }

export function readAccessMode(raw: string | undefined): AccessModeReading {
  const value = raw ?? ''
  if (value === '') return { mode: 'legacy', raw: '', valid: true }
  if ((ACCESS_MODES as readonly string[]).includes(value)) return { mode: value as AccessMode, raw: value, valid: true }
  return { mode: 'legacy', raw: value, valid: false }
}
