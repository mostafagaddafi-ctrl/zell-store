import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { OpeningEditor } from '../../../../../components/inventory/OpeningEditor'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { requireAdminPage } from '../../../../../lib/auth/guards'
import { loadOpeningEditorData } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'

export const metadata: Metadata = { title: 'رصيد أول مدة جديد' }
export const dynamic = 'force-dynamic'

/** رصيد أول مدة جديد (مسودة) — للمالك بس. */
export default async function NewOpeningPage() {
  const identity = await requireAdminPage()
  if (identity.role !== 'owner') redirect('/403')

  const data = await loadOpeningEditorData(identity.userId)

  return (
    <>
      <PageHeader title="رصيد أول مدة جديد" description="بيتحفظ كمسودة الأول. الترحيل من صفحة المسودة بعد الحفظ والمعاينة." />
      {data.ok ? (
        <OpeningEditor draft={null} catalog={data.catalog} locations={data.locations} today={cairoToday(new Date())} />
      ) : (
        <EditorBlocked reasons={data.reasons} />
      )}
    </>
  )
}
