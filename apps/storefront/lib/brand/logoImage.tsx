import type { ReactElement } from 'react'
import type { ImageResponse } from 'next/og'
import { logoHex, markGeometry, wordmarkGeometry } from './logo'

/**
 * اللوجو لصور ImageResponse (Satori) — نفس أرقام lib/brand/logo.ts بالظبط، بـ style بس (من غير Tailwind).
 * الإطار هنا border داخلي 1px (العرض بيشمله) بدل inset shadow اللي Satori مابيدعمهوش.
 *
 * ⚠️ نفس الملف بالحرف في apps/storefront/lib/brand/logoImage.tsx وapps/admin/lib/brand/logoImage.tsx.
 */

export function MarkImage({ size, letter, frame, rounded }: { size: number; letter: string; frame: boolean; rounded: boolean }): ReactElement {
  const g = markGeometry(size)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? g.radius : 0,
        background: logoHex('surface'),
        border: frame ? '1px solid ' + logoHex('frame') : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontFamily: 'Cairo',
          fontSize: g.letterSize,
          lineHeight: 1,
          marginTop: g.letterOffset,
          color: logoHex('ink'),
          fontWeight: 800,
        }}
      >
        {letter}
      </div>
      <div
        style={{
          display: 'flex',
          width: g.barWidth,
          height: g.barHeight,
          marginTop: g.barGap,
          background: logoHex('accent'),
          borderRadius: 9999,
        }}
      />
    </div>
  )
}

export function WordmarkImage({ name, size, letter }: { name: string; size: number; letter: string }): ReactElement {
  const w = wordmarkGeometry(size)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: w.gap }}>
      <MarkImage size={w.markSize} letter={letter} frame rounded />
      <div
        style={{
          display: 'flex',
          fontFamily: 'Cairo',
          fontSize: size,
          lineHeight: 1,
          fontWeight: 800,
          letterSpacing: size * w.letterSpacingEm,
          color: logoHex('ink'),
        }}
      >
        {name}
      </div>
    </div>
  )
}

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>['fonts']>

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@800&text='

/**
 * خط Cairo وزن 800 كملف لصور ImageResponse — بالحروف المطلوبة بس (subset من Google Fonts).
 * لو التحميل فشل (شبكة وقت البناء مثلًا) بيرجّع [] والصورة بتترسم بالخط الافتراضي بدل ما البناء يقع.
 */
export async function loadLogoFont(text: string): Promise<Fonts> {
  try {
    const css = await (await fetch(FONT_CSS_URL + encodeURIComponent(text))).text()
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1]
    if (!url) return []
    const response = await fetch(url)
    if (!response.ok) return []
    return [{ name: 'Cairo', data: await response.arrayBuffer(), weight: 800, style: 'normal' }]
  } catch {
    return []
  }
}
