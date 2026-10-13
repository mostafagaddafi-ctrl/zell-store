/**
 * لوجو المتجر — الأرقام بالظبط من مرجع المالك («Z كحلي وتحته شرطة دهبي»). منطق خالص.
 *
 * ⚠️ نفس الملف بالحرف في apps/storefront/lib/brand/logo.ts وapps/admin/lib/brand/logo.ts — أي تعديل يتعمل
 *    في الاتنين في نفس الـ PR. بيستخدمه: مكوّن اللوجو (Logo.tsx) وصور ImageResponse (lib/brand/logoImage.tsx).
 */

/** ألوان المتجر الحالية بالـ HSL (نفس توكنز apps/storefront/app/globals.css). */
export const LOGO_HSL = {
  surface: [0, 0, 100],
  frame: [37, 27, 90],
  ink: [212, 61, 22],
  accent: [39, 67, 52],
  page: [38, 44, 97],
} as const

export type LogoColor = keyof typeof LOGO_HSL

/** hsl → #rrggbb (صور ImageResponse بتاخد hex). */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return '#' + channel(0) + channel(8) + channel(4)
}

export function logoHex(color: LogoColor): string {
  const [h, s, l] = LOGO_HSL[color]
  return hslToHex(h, s, l)
}

/** العلامة: size = ضلع المربع بالبكسل. */
export function markGeometry(size: number) {
  return {
    radius: Math.max(3, Math.round(size * 0.22)),
    letterSize: Math.round(size * 0.6),
    letterOffset: -size * 0.04,
    barWidth: size * 0.44,
    barHeight: Math.max(1.5, size * 0.08),
    barGap: size * 0.03,
  }
}

/** الاسم الكامل: size = حجم خط الاسم بالبكسل. */
export function wordmarkGeometry(size: number) {
  return { markSize: Math.round(size * 1.45), gap: size * 0.4, letterSpacingEm: 0.06 }
}

/** حرف العلامة الثابت (الأيقونات بتتولّد من غير قراية بيانات). */
export const LOGO_LETTER = 'Z'

/** حرف العلامة من اسم المتجر (أول حرف، كبير)، وإلا LOGO_LETTER. */
export function logoLetter(name: string): string {
  const first = name.trim().charAt(0)
  return first === '' ? LOGO_LETTER : first.toUpperCase()
}
