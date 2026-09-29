import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../lib/shadcn/accordion'

const ITEMS: Array<{ q: string; a: string }> = [
  {
    q: 'التركيب صعب؟ أنا مش صنايعي',
    a: 'لأ. بترشّ الزجاج بميّه فيها نقط صابون، تحطّ الفيلم وتحرّكه لحد ما يظبط، وتسحب المياه بالإسكويجي. الأدوات بتيجي مع الطلب ومعاها شرح بالصور.',
  },
  {
    q: 'ينفع أشيله بعدين؟',
    a: 'أيوه، الفيلم بيتشال من غير ما يأثر على الزجاج. سخّن الطرف شوية واسحبه بالراحة.',
  },
  {
    q: 'بيقعد قد إيه؟',
    a: 'الاستخدام الداخلي الطبيعي بيدّي عمر طويل. أكتر حاجة بتأثر هي التعرض المباشر والمستمر للشمس ونوع التنظيف — بلاش مواد كاشطة أو أمونيا.',
  },
  {
    q: 'هطلب كام متر؟',
    a: 'استخدم حاسبة المقاس فوق: اكتب عرض وارتفاع الزجاج وهي تحسبلك المتر المطلوب. العرض الثابت للفيلم 50 سم، فلو الشباك أعرض بنحسبها شرايح جنب بعض.',
  },
  {
    q: 'الدفع والتوصيل؟',
    a: 'الدفع كاش عند الاستلام، والتوصيل لكل محافظات مصر وسعره بيبان قبل ما تأكد الطلب حسب محافظتك.',
  },
]

export function Faq() {
  return (
    <section>
      <h2 className="text-base font-bold text-foreground">أسئلة بتتسأل كتير</h2>
      <Accordion type="single" collapsible className="mt-2">
        {ITEMS.map((item) => (
          <AccordionItem key={item.q} value={item.q}>
            <AccordionTrigger className="text-right text-sm font-semibold">{item.q}</AccordionTrigger>
            <AccordionContent className="text-sm leading-6 text-muted-foreground">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
