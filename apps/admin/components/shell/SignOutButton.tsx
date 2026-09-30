import { LogOut } from 'lucide-react'
import { buttonClasses } from '../ui/Button'

/**
 * فورم POST حقيقي مش زرار onClick.
 * السبب: الخروج لازم يبقى POST، والفورم بيشتغل حتى من غير JavaScript.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form method="post" action="/auth/signout" className={className}>
      <button type="submit" className={buttonClasses('secondary', 'sm', 'w-full')}>
        <LogOut className="h-3.5 w-3.5" />
        تسجيل الخروج
      </button>
    </form>
  )
}
