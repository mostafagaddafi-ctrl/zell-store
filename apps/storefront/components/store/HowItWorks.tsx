import type { StoreContent } from '@zell/core'

/**
 * خطوات «إزاي أطلب» من «المحتوى» في اللوحة — أرقام بس، من غير أيقونات ولا كروت.
 * على الموبايل (تحت sm): نفس الشكل الرأسي بمسافات أقل، والخط زي ما هو (قرار المالك 2026-10-16). من sm: زي قبل كده بالحرف.
 */
export function HowItWorks({ title, steps }: { title: string; steps: StoreContent['orderSteps'] }) {
  return (
    <section className="border-y border-border py-6 sm:py-8">
      {title ? <h2 className="mb-4 text-lg font-bold text-fg sm:mb-5 sm:text-xl md:text-2xl">{title}</h2> : null}
      <ol className="grid gap-3 sm:grid-cols-3 sm:gap-5">
        {steps.map((step, index) => (
          <li key={String(index) + step.title} className="flex items-start gap-2.5 sm:gap-3">
            <span className="mt-0.5 text-sm font-bold tabular-nums text-gold">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg max-sm:leading-snug">{step.title}</p>
              {step.description ? <p className="text-sm text-muted max-sm:leading-snug">{step.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
