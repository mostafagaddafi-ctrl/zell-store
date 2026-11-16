'use client'

/**
 * META-PIXEL — بيترسم في الـ layout دايمًا. بيعلّم المرور بالمسارات المحجوبة من أول المستند (ع١)، وبيحمّل MetaPixel لوحده
 * (dynamic) **بس** لما الـ ID صالح، فكوده مابيتشحنش ولا بيشتغل لما الخانة فاضية (مفيش أي طلب ولا كوكي ولا تغيير في التنقل).
 * §٢-٥: لو الـ ID اتفضّى أو بقى غلط والمستند مفتوح (router.refresh)، MetaPixel مابيترسمش تاني، فالوقف بيتعمل من هنا
 * (disablePixel): لو السكربت لسه ماتطلبش مابيتطلبش، والطابور بيتمسح، ومفيش أحداث جديدة لباقي عمر المستند.
 * B1: الإيقاف مش إلغاء حراسة — حراسة العنوان والتنقّل (في MetaPixel) بتفضل لحد قفل المستند، وتغيّر المسار بيوصلها من هنا.
 * أهلية المستند (مراجعة 05a11e7): أول قيمة ID في المتصفح بتثبّتها (pixelEligible)؛ مستند بدأ فاضي مابيتسلّحش أبدًا.
 */
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { disablePixel, markPixelPath, pixelEligible } from '../../lib/analytics/pixelBridge'

const MetaPixel = dynamic(() => import('./MetaPixel').then((mod) => mod.MetaPixel), { ssr: false })

export function MetaPixelLoader(props: { pixelId: string; productIds: string[]; collectionSlugs: string[] }) {
  const pathname = usePathname()
  // §٢-٥ — الأهلية بتتثبت من أول قيمة يشوفها المستند: بدأ فاضي أو غلط ⇐ مابيتسلّحش أبدًا حتى لو وصل ID صالح بعدين
  const off = !pixelEligible(props.pixelId)
  useEffect(() => {
    markPixelPath(pathname)
  }, [pathname])
  useEffect(() => {
    if (off) disablePixel()
  }, [off])
  return off ? null : <MetaPixel {...props} />
}
