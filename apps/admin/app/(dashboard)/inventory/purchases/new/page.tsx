import type { Metadata } from 'next'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { PurchaseEditor } from '../../../../../components/inventory/PurchaseEditor'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { pageWithAccess } from '../../../../../lib/access/instance'
import { loadPurchaseEditorData } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'

export const metadata: Metadata = { title: 'فاتورة شراء جديدة' }
export const dynamic = 'force-dynamic'

/** فاتورة شراء جديدة (مسودة) — للمالك بس. */
export default pageWithAccess('zell.inventory0020.view', async function NewPurchasePage(_ctx) {

  const data = await loadPurchaseEditorData()

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
})
