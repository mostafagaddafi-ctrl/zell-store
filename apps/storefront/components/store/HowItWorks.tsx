import type { StoreContent } from '@zell/core'

/** خطوات «إزاي أطلب» من «المحتوى» في اللوحة — أرقام بس، من غير أيقونات ولا كروت. */
export function HowItWorks({ title, steps }: { title: string; steps: StoreContent['orderSteps'] }) {
  return (
    <section className="border-y border-border py-8">
      {title ? <h2 className="mb-5 text-xl font-bold text-fg md:text-2xl">{title}</h2> : null}
      <ol className="grid gap-5 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={String(index) + step.title} className="flex items-start gap-3">
            <span className="mt-0.5 text-sm font-bold tabular-nums text-gold">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{step.title}</p>
              {step.description ? <p className="text-sm text-muted">{step.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
