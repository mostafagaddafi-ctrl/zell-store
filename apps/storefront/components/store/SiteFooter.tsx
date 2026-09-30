import { MessageCircle } from 'lucide-react'
import { Container } from '../ui/Container'

/**
 * تواصل وسياسات بس. مفيش أقسام تسويقية ولا شبكات اجتماعية.
 *
 * السياسات معروضة كنص عادي مش روابط، لأن صفحاتها لسه مش موجودة —
 * رابط ميّت أسوأ من نص. تتحوّل لروابط أول ما الصفحات تتعمل.
 */
export function SiteFooter({
  storeName,
  whatsappNumber,
  whatsappMessage,
}: {
  storeName: string
  whatsappNumber: string
  whatsappMessage: string
}) {
  const whatsappHref = whatsappNumber
    ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage || '')
    : null
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-border bg-card">
      {/* مساحة تحت عشان الأشرطة اللاصقة في صفحات المنتج والسلة ما تغطّيش الفوتر */}
      <Container className="grid gap-8 py-10 pb-28 sm:grid-cols-2 md:pb-10">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-fg">{storeName}</p>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-accent"
            >
              <MessageCircle className="h-4 w-4" />
              تواصل على واتساب
            </a>
          ) : null}
        </div>

        <div className="space-y-3 sm:text-left">
          <p className="text-sm font-semibold text-fg">معلومات</p>
          <ul className="space-y-1.5 text-sm text-muted">
            <li>سياسة الشحن والتوصيل</li>
            <li>الاستبدال والاسترجاع</li>
            <li>سياسة الخصوصية</li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-border">
        <Container className="py-4">
          <p className="text-xs text-muted">
            © {year} {storeName}
          </p>
        </Container>
      </div>
    </footer>
  )
}
