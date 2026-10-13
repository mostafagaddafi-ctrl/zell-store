import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'
import { SignOutButton } from '../../../components/shell/SignOutButton'
import { Card } from '../../../components/ui/Field'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'غير مصرّح',
  robots: { index: false, follow: false },
}

/**
 * الحساب مسجّل دخول في Supabase بس مالوش صف مفعّل في admin_users.
 * بيحصل كمان لو الصلاحية اتسحبت والجلسة لسه شغالة.
 */
export default function ForbiddenPage() {
  return (
    <Card>
      <div className="space-y-3 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-danger" />
        <div className="space-y-1">
          <h1 className="text-sm font-bold text-fg">الحساب ده مش مصرّح له</h1>
          <p className="text-xs text-muted">
            تم الدخول بحساب موجود، لكنه لا يملك صلاحية الوصول إلى لوحة التحكم. إذا كان ذلك خطأ، يُرجى التواصل مع مالك المتجر.
          </p>
        </div>
        <SignOutButton />
      </div>
    </Card>
  )
}
