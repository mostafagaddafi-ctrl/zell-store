import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * حاويتين بس في المتجر كله:
 *   wide   = ١٢٠٠px — العرض والشبكات
 *   narrow = ٥٤٤px  — الفورمات والقراءة
 */
export function Container({
  size = 'wide',
  className,
  children,
}: {
  size?: 'wide' | 'narrow'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6',
        size === 'wide' ? 'max-w-content' : 'max-w-app',
        className,
      )}
    >
      {children}
    </div>
  )
}
