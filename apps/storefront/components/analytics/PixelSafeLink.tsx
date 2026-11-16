'use client'

/**
 * META-PIXEL §٢-٢ ع٢ — لينك لمسار محجوب (زي /track): في المستند المسلّح تنقل كامل لمستند جديد، وفي غيره next/link زي الأول.
 */
import Link from 'next/link'
import type { ComponentProps, MouseEvent } from 'react'
import { pixelNeedsFullNavigation } from '../../lib/analytics/pixelBridge'

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export function PixelSafeLink({ href, onClick, ...rest }: Props) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (onClick) onClick(event)
    if (event.defaultPrevented) return
    if (!pixelNeedsFullNavigation(new URL(href, window.location.href).href)) return
    event.preventDefault()
    window.location.assign(href)
  }
  return <Link href={href} {...rest} onClick={handleClick} />
}
