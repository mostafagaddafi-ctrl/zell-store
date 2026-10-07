import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { PurchaseEditor } from '../../../../../components/inventory/PurchaseEditor'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { requireAdminPage } from '../../../../../lib/auth/guards'
import { loadPurchaseEditorData } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'

export const metadata: Metadata = { title: 'فاتورة شراء جديدة' }
export const dynamic = 'force-dynamic'

/** فاتورة شراء جديدة (مسودة) — للمالك بس. */
export default async function NewPurchasePage() {
  const identity = await requireAdminPage()
  if (identity.role !== 'owner') redirect('/403')

  const data = await loadPurchaseEditorData(identity.userId)

  return (
    <>
      <PageHeader
        title="فاتورة شراء جديدة"
        description="بتتحفظ كمسودة الأول. الترحيل من صفحة المسودة بعد الحفظ والمعاينة."
      />
      {data.ok ? (
        <PurchaseEditor
          draft={null}
          catalog={data.catalog}
          suppliers={data.suppliers}
          locations={data.locations}
          today={cairoToday(new Date())}
        />
      ) : (
        <EditorBlocked reasons={data.reasons} />
      )}
    </>
  )
}
