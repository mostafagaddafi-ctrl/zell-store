import type { ReactNode } from 'react'
import { AdminShell, type AdminShellIdentity } from '../../components/shell/AdminShell'
import { adminData } from '../../lib/adminData'
import { layoutWithSession } from '../../lib/access/instance'
import { mutationsEnabled } from '../../lib/mutations'
import { ReadinessProvider } from '../../lib/readiness'

/**
 * كل المسارات المحمية تحت المجموعة دي.
 *
 * ⚠️ الحارس هنا **مش** كفاية لوحده: كل صفحة جوه المجموعة متغلّفة بنفسها
 * (pageWithAccess — 0021-P ب2). الـ layout في App Router ممكن مايعادش
 * التنفيذ مع كل تنقّل، فالاعتماد عليه وحده ثغرة. الـ layout هنا جلسة بس (layoutWithSession).
 *
 * ترتيب مقصود: الصلاحية الأول، وبعد كده أي قراءة من الداتابيز.
 */
export const dynamic = 'force-dynamic'

export default layoutWithSession(async function DashboardLayout(ctx, { children }: { children: ReactNode }) {
  const identity = ctx.identity
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
})
