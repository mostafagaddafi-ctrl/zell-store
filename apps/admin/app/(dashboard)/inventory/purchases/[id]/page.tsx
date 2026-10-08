import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { DocStatusBadge } from '../../../../../components/inventory/InvStatusBadge'
import { PurchaseEditor } from '../../../../../components/inventory/PurchaseEditor'
import { PurchaseView } from '../../../../../components/inventory/PurchaseView'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../../components/ui/Button'
import { requireAdminPage } from '../../../../../lib/auth/guards'
import { loadPurchaseEditorData, loadViewCatalog } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'
import { parseIdParam } from '../../../../../lib/inventory/purchases'
import { getPurchase } from '../../../../../lib/data/inventoryPurchases'

export const metadata: Metadata = { title: 'فاتورة شراء' }
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

/**
 * فاتورة شراء — للمالك بس.
 *   • مسودة: النموذج (حفظ · معاينة · ترحيل · استبعاد). مفتاحه docId:version، فأي نسخة جديدة من
 *     السيرفر (بعد حفظ أو مصالحة) بتبني النموذج من البيانات الطازة.
 *   • مرحّل / مُبطَل / مستبعَد: عرض بس (والإبطال للمرحّل).
 */
export default async function PurchasePage({ params }: PageProps) {
  const identity = await requireAdminPage()
  if (identity.role !== 'owner') redirect('/403')

  const { id } = await params
  const docId = parseIdParam(id)
  if (docId === null) notFound()

  const result = await getPurchase(identity.userId, docId)
  if (!result.ok && result.code === 'NOT_FOUND') notFound()

  const back = (
    <Link href="/inventory/purchases" className={buttonClasses('secondary', 'sm')}>
      رجوع للمشتريات
    </Link>
  )

  if (!result.ok) {
    return (
      <>
        <PageHeader title="فاتورة شراء" actions={back} />
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا الفاتورة.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      </>
    )
  }

  const detail = result.data
  const { header } = detail

  if (header.status !== 'draft' || detail.draftPayload === null) {
    const catalog = await loadViewCatalog()
    return (
      <>
        <PageHeader title={'فاتورة شراء ' + header.docNo} actions={back} />
        <PurchaseView detail={detail} catalog={catalog} />
      </>
    )
  }

  const data = await loadPurchaseEditorData(identity.userId)

  return (
    <>
      <PageHeader
        title={'فاتورة شراء ' + header.docNo}
        description="مسودة: تقدر تعدّلها وتعاينها، وبعد الحفظ ترحّلها أو تستبعدها."
        actions={
          <>
            <DocStatusBadge status={header.status} />
            {back}
          </>
        }
      />
      {data.ok ? (
        <PurchaseEditor
          key={String(header.docId) + ':' + String(header.version)}
          draft={{ header, payload: detail.draftPayload }}
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
