'use client'

/**
 * META-PIXEL — بيترسم في الـ layout بس لما الـ ID صالح. بيعلّم المرور بالمسارات المحجوبة من أول المستند (ع١)،
 * وبيحمّل MetaPixel لوحده (dynamic) فكوده مابيتشحنش لما الخانة فاضية.
 */
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { markPixelPath } from '../../lib/analytics/pixelBridge'

const MetaPixel = dynamic(() => import('./MetaPixel').then((mod) => mod.MetaPixel), { ssr: false })

export function MetaPixelLoader(props: { pixelId: string; productIds: string[]; collectionSlugs: string[] }) {
  const pathname = usePathname()
  useEffect(() => {
    markPixelPath(pathname)
  }, [pathname])
  return <MetaPixel {...props} />
}
