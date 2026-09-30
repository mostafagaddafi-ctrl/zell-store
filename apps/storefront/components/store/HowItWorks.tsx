const STEPS = [
  { title: 'اختار النوع والمقاس', note: 'بمقاس الشباك أو بالمتر' },
  { title: 'أكّد الطلب', note: 'أربع خانات بس' },
  { title: 'ادفع عند الاستلام', note: 'تشوف الشحنة الأول' },
]

/** ثلاث خطوات قصيرة — أرقام بس، من غير أيقونات ولا كروت. */
export function HowItWorks() {
  return (
    <section className="border-y border-border py-8">
      <ol className="grid gap-5 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="mt-0.5 text-sm font-bold tabular-nums text-gold">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{step.title}</p>
              <p className="text-sm text-muted">{step.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
