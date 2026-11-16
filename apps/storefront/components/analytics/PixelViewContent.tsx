'use client'

/** META-PIXEL §٢-٤ — ViewContent مرة لكل فتح منتج (الصفحة نفسها ISR والكاش زي ما هو). */
import { useEffect } from 'react'
import { trackPixel } from '../../lib/analytics/pixelBridge'
import { viewContentParams } from '../../lib/analytics/pixelEvents'

export function PixelViewContent({ productId, name }: { productId: number; name: string }) {
  useEffect(() => {
    trackPixel('ViewContent', viewContentParams(productId, name))
  }, [productId, name])
  return null
}
