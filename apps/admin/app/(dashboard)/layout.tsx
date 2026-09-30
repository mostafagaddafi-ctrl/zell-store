import type { ReactNode } from 'react'
import { AdminShell, type AdminShellIdentity } from '../../components/shell/AdminShell'
import { adminData } from '../../lib/adminData'
import { requireAdminPage } from '../../lib/auth/guards'
import { mutationsEnabled } from '../../lib/mutations'
import { ReadinessProvider } from '../../lib/readiness'

/**
 * كل المسارات المحمية تحت المجموعة دي.
 *
 * ⚠️ الحارس هنا **مش** كفاية لوحده: كل صفحة جوه المجموعة بتنادي
 * requireAdminPage بنفسها. الـ layout في App Router ممكن مايعادش
 * التنفيذ مع كل تنقّل، فالاعتماد عليه وحده ثغرة.
 *
 * ترتيب مقصود: الصلاحية الأول، وبعد كده أي قراءة من الداتابيز.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const identity = await requireAdminPage()
  const summary = await adminData.getOrdersSummary()
  const enabled = mutationsEnabled()

  const shellIdentity: AdminShellIdentity = { email: identity.email, role: identity.role }

  return (
    <ReadinessProvider enabled={enabled}>
      <AdminShell newOrders={summary.newCount} identity={shellIdentity}>
        {children}
      </AdminShell>
    </ReadinessProvider>
  )
}
