/**
 * 0021-P — تفسير علم التعديلات ADMIN_MUTATIONS_ENABLED. منطق صافي من غير I/O.
 *
 * نفس شرط lib/mutations.ts بالحرف: (القيمة ?? '').trim() === 'true'. واتنقل هنا علشان يتختبر في حالات
 * اللوحة (true · false · غايب · قيمة غلط). mutationsEnabled() في lib/mutations.ts بتناديه، فمفيش تغيير في السلوك.
 */
export function mutationsFlagEnabled(raw: string | undefined): boolean {
  return (raw ?? '').trim() === 'true'
}
