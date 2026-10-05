import { lineSpecs, type StoreProduct } from '@zell/core'
import { cn } from '../../lib/cn'
import { Num } from './Num'

/**
 * مواصفات سطر السلة بنفس الكلمات في السلة وCheckout:
 *   فيلم المقاس → «الطول: ٥ متر · عرض الرول: ١٢٠ سم»
 *   منتج بالعدد → «الكمية: ٢»
 * product لازم يكون بعد resolveCartLine (العرض المختار متطبّق). سطر صغير هادي بيلف على الشاشات الضيقة.
 */
export function LineSpecs({
  product,
  line,
  className,
}: {
  product: StoreProduct
  line: { lengthCm: number; quantity?: number }
  className?: string
}) {
  const specs = lineSpecs(product, line)
  return (
    <p className={cn('flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs leading-5 text-muted', className)}>
      {specs.map((spec, index) => (
        <span key={spec.label} className="whitespace-nowrap">
          {index > 0 ? <span aria-hidden="true">{'· '}</span> : null}
          {spec.label + ': '}
          <Num>{spec.value}</Num>
        </span>
      ))}
    </p>
  )
}
