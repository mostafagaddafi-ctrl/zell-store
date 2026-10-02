import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import type { StoreContent } from '@zell/core'
import { Container } from '../ui/Container'

/**
 * تواصل وسياسات بس. مفيش أقسام تسويقية ولا شبكات اجتماعية.
 *
 * الروابط من «المحتوى» في اللوحة. رابط من غير عنوان صفحة بيظهر نص
 * عادي — رابط ميّت أسوأ من نص — وبيتحوّل لرابط أول ما الأدمن يحط له
 * عنوان. الداخلي بيبدأ بـ / والخارجي https بس.
 */
export function SiteFooter({
  storeName,
  links,
  whatsappNumber,
  whatsappMessage,
}: {
  storeName: string
  links: StoreContent['footerLinks']
  whatsappNumber: string
  whatsappMessage: string
}) {
  const whatsappHref = whatsappNumber
    ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage || '')
    : null
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-border bg-card">
      <Container className="grid gap-8 py-10 sm:grid-cols-2">
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
            {links.map((link, index) => (
              <li key={String(index) + link.label}>
                {link.href === '' ? (
                  link.label
                ) : link.href.startsWith('/') ? (
                  <Link href={link.href} className="transition-colors hover:text-accent">
                    {link.label}
                  </Link>
                ) : (
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
                    {link.label}
                  </a>
                )}
              </li>
            ))}
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
