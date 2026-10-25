import Link from 'next/link'
import { buttonClasses } from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-app flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-extrabold text-fg">الصفحة مش موجودة</h1>
      <p className="text-sm text-muted">يمكن المنتج اتشال أو الرابط قديم.</p>
      <Link href="/" className={buttonClasses('primary', 'md')}>
        رجوع للمتجر
      </Link>
    </div>
  )
}
