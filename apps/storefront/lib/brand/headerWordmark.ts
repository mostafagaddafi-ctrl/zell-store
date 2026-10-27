/**
 * LOGO-TEXT (قرار المالك 2026-10-27): هيدر المتجر بيعرض «my» + «ظل» بدل صورة اللوجو المرفوعة من اللوحة.
 *
 * «ظل» = الرسمة نفسها من صورة اللوجو الأصلية (docs/brand/zell-logo-horizontal.png، نفس ملف site_images id 3،
 * sha256 d5a549248e974e34d82c8d463f7a692ef3cbcb9f30790b3dc54d4ebbdcbd6a43) مقصوصة من الشمال للنص: الأعمدة 0–231 من 464
 * وكل الارتفاع 204 — من غير أيقونة الشباك (بتبدأ من العمود 248). «my» نص بخط المتجر ولون brand.
 * الترتيب (dir=ltr): «my» على الشمال و«ظل» في أقصى اليمين. أرقام الكمبيوتر = ظبط المالك في المعاينة،
 * والموبايل = نفس الظبط مصغّر (my ×0.85 · ظل والإزاحات والمسافة ×0.83، مقرّبة).
 * الحالات: headerWordmark.cases.ts (suite brand).
 */
export const HEADER_WORDMARK = {
  src: '/brand/zill-wordmark.png',
  width: 232,
  height: 204,
  sha256: '1a4061cf446e1672bfa75bd38ce16d5f3ef66e2e639ae27020c4b78f4bbf95eb',
  order: ['my', 'zill'],
  myText: 'my',
  desktop: { myPx: 24, myShiftPx: 1, zillHeightPx: 39, zillShiftPx: 4, gapPx: 3 },
  mobile: { myPx: 20, myShiftPx: 1, zillHeightPx: 32, zillShiftPx: 3, gapPx: 2 },
} as const

export type WordmarkSize = { myPx: number; myShiftPx: number; zillHeightPx: number; zillShiftPx: number; gapPx: number }

/** عرض «ظل» بالبكسل لارتفاع معيّن، بنفس نسبة الصورة المقصوصة. */
export function zillWidthPx(heightPx: number): number {
  return Math.round((heightPx * HEADER_WORDMARK.width) / HEADER_WORDMARK.height)
}
