import { ChevronDown } from 'lucide-react'

const QUESTIONS = [
  {
    q: 'الفيلم بيتباع إزاي؟',
    a: 'بالمتر الطولي. الرول عرضه ٥٠ سم، فلو الشباك أعرض من كده بنقسمه شرايح والطول بيتحسب تلقائي. إنت بس تدخل مقاس الشباك.',
  },
  {
    q: 'التركيب بيتم إزاي؟',
    a: 'أدوات التركيب بتيجي مع الطلب مجاناً مع شرح بالخطوات. الفيلم بيتركب بالمياه والصابون ومحتاجش فني.',
  },
  {
    q: 'الدفع إزاي؟',
    a: 'الدفع عند الاستلام لكل المحافظات. تشوف الشحنة وتدفع للمندوب.',
  },
  {
    q: 'لو المقاس غلط؟',
    a: 'كلّمنا على واتساب قبل ما تطلب وإحنا نحسبهولك. أقل طلب ٣ متر.',
  },
]

export function Faq() {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {QUESTIONS.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold text-fg">
            {item.q}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <p className="px-4 pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
