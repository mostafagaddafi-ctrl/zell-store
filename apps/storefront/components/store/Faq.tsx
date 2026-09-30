import { Plus } from 'lucide-react'

const QUESTIONS = [
  {
    q: 'الفيلم بيتباع إزاي؟',
    a: 'بالمتر الطولي. الرول عرضه ٥٠ سم، فلو الشباك أعرض من كده بنقسمه شرايح والطول بيتحسب تلقائي. إنت بس تدخل مقاس الشباك.',
  },
  {
    q: 'التركيب بيتم إزاي؟',
    a: 'أدوات التركيب بتيجي مع الطلب مع شرح بالخطوات. الفيلم بيتركب بالمياه والصابون ومحتاجش فني.',
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
    <div className="divide-y divide-border border-y border-border">
      {QUESTIONS.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-fg">
            {item.q}
            <Plus className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-45" />
          </summary>
          <p className="max-w-2xl pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
