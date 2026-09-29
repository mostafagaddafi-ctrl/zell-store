import { MessageCircle } from 'lucide-react'

export function WhatsAppFab({ number, message }: { number: string; message: string }) {
  if (!number) return null
  const href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(message)

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل على واتساب"
      className="fixed bottom-24 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform active:scale-95"
    >
      <MessageCircle className="h-6 w-6" />
    </a>
  )
}
