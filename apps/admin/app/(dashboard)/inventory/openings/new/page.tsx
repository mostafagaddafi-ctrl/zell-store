import type { Metadata } from 'next'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { OpeningEditor } from '../../../../../components/inventory/OpeningEditor'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { pageWithAccess } from '../../../../../lib/access/instance'
import { loadOpeningEditorData } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'

export const metadata: Metadata = { title: 'رصيد أول مدة جديد' }
export const dynamic = 'force-dynamic'

/** رصيد أول مدة جديد (مسودة) — للمالك بس. */
export default pageWithAccess('zell.inventory0020.view', async function NewOpeningPage(_ctx) {

  const data = await loadOpeningEditorData()

  return (
    <>
      <PageHeader title="رصيد أول مدة جديد" description="بيتحفظ كمسودة الأول. الترحيل من صفحة المسودة بعد الحفظ والمعاينة." />
      {data.ok ? (
        <OpeningEditor draft={null} catalog={data.catalog} locations={data.locations} today={cairoToday(new Date())} />
      ) : (
        <EditorBlocked reasons={data.reasons} backHref="/inventory/openings" backLabel="رجوع لرصيد أول المدة" />
      )}
    </>
  )
})
