import { MessageCircle } from 'lucide-react'

/** الزر العائم — بيرتفع فوق شريط الدفع الثابت عشان مايغطيهوش. */
export function WhatsAppFab({ href, raised = false }: { href: string; raised?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="تواصل معنا على واتساب"
      className={`fixed left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-retool-lg transition-all hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400 ${
        raised ? 'bottom-24' : 'bottom-4'
      }`}
    >
      <MessageCircle className="h-5 w-5" />
    </a>
  )
}
