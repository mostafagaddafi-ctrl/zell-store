'use client'

/**
 * META-PIXEL — بيترسم في الـ layout دايمًا. بيعلّم المرور بالمسارات المحجوبة من أول المستند (ع١)، وبيحمّل MetaPixel لوحده
 * (dynamic) **بس** لما الـ ID صالح، فكوده مابيتشحنش ولا بيشتغل لما الخانة فاضية (مفيش أي طلب ولا كوكي ولا تغيير في التنقل).
 * §٢-٥: لو الـ ID اتفضّى أو بقى غلط والمستند مفتوح (router.refresh)، MetaPixel مابيترسمش تاني، فالوقف بيتعمل من هنا
 * (disablePixel): لو السكربت لسه ماتطلبش مابيتطلبش، والطابور بيتمسح، ومفيش أحداث جديدة لباقي عمر المستند.
 */
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { disablePixel, markPixelPath } from '../../lib/analytics/pixelBridge'

const MetaPixel = dynamic(() => import('./MetaPixel').then((mod) => mod.MetaPixel), { ssr: false })

export function MetaPixelLoader(props: { pixelId: string; productIds: string[]; collectionSlugs: string[] }) {
  const pathname = usePathname()
  const off = props.pixelId === ''
  useEffect(() => {
    markPixelPath(pathname)
  }, [pathname])
  useEffect(() => {
    if (off) disablePixel()
  }, [off])
  return off ? null : <MetaPixel {...props} />
}
