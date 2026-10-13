import { cn } from '../../lib/cn'
import { logoLetter, markGeometry, wordmarkGeometry } from '../../lib/brand/logo'

/**
 * اللوجو: العلامة (LogoMark) والاسم الكامل (LogoWordmark) — أرقام مرجع المالك بالظبط (lib/brand/logo.ts)،
 * والألوان من التوكنز (bg-white · الإطار · brand · gold).
 *
 * ⚠️ نسخة مطابقة: apps/storefront/components/store/Logo.tsx وapps/admin/components/shell/Logo.tsx.
 *    الفرق الوحيد لون الإطار: هنا اللون بالحرف (توكن border في اللوحة 88%، فاللون مكتوب صريح علشان يطابق المتجر).
 */

const FRAME = 'shadow-[inset_0_0_0_1px_hsl(37_27%_90%)]'

export function LogoMark({ size, letter, className }: { size: number; letter: string; className?: string }) {
  const g = markGeometry(size)
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: g.radius }}
      className={cn('inline-flex shrink-0 flex-col items-center justify-center bg-white', FRAME, className)}
    >
      <span style={{ fontSize: g.letterSize, lineHeight: 1, marginTop: g.letterOffset }} className="font-extrabold text-brand">
        {letter}
      </span>
      <span style={{ width: g.barWidth, height: g.barHeight, marginTop: g.barGap }} className="rounded-full bg-gold" />
    </span>
  )
}

export function LogoWordmark({ name, size, className }: { name: string; size: number; className?: string }) {
  const w = wordmarkGeometry(size)
  return (
    <span dir="ltr" style={{ gap: w.gap }} className={cn('inline-flex items-center', className)}>
      <LogoMark size={w.markSize} letter={logoLetter(name)} />
      <span
        style={{ fontSize: size, lineHeight: 1, letterSpacing: String(w.letterSpacingEm) + 'em' }}
        className="whitespace-nowrap font-extrabold text-brand"
      >
        {name}
      </span>
    </span>
  )
}
