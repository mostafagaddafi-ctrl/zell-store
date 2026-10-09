import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { DocStatusBadge } from '../../../../../components/inventory/InvStatusBadge'
import { OpeningEditor } from '../../../../../components/inventory/OpeningEditor'
import { OpeningView } from '../../../../../components/inventory/OpeningView'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../../components/ui/Button'
import { pageWithAccess } from '../../../../../lib/access/instance'
import { loadOpeningEditorData, loadViewCatalog } from '../../../../../lib/data/inventoryEditor'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'
import { parseIdParam } from '../../../../../lib/inventory/purchases'
import { getOpening } from '../../../../../lib/data/inventoryOpenings'

export const metadata: Metadata = { title: 'رصيد أول المدة' }
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

/**
 * رصيد أول المدة — للمالك بس.
 *   • مسودة: النموذج (مفتاحه docId:version، فأي نسخة جديدة من السيرفر بتبنيه من البيانات الطازة).
 *   • مرحّل / مُبطَل / مستبعَد: عرض بس (والإبطال للمرحّل).
 */
export default pageWithAccess('zell.inventory0020.view', async function OpeningPage(_ctx, { params }: PageProps) {

  const { id } = await params
  const docId = parseIdParam(id)
  if (docId === null) notFound()

  const result = await getOpening(docId)
  if (!result.ok && result.code === 'NOT_FOUND') notFound()

  const back = (
    <Link href="/inventory/openings" className={buttonClasses('secondary', 'sm')}>
      رجوع لرصيد أول المدة
    </Link>
  )

  if (!result.ok) {
    return (
      <>
        <PageHeader title="رصيد أول المدة" actions={back} />
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا المستند.</p>
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
        <PageHeader title={'رصيد أول المدة ' + header.docNo} actions={back} />
        <OpeningView detail={detail} catalog={catalog} />
      </>
    )
  }

  const data = await loadOpeningEditorData()

  return (
    <>
      <PageHeader
        title={'رصيد أول المدة ' + header.docNo}
        description="مسودة: تقدر تعدّلها وتعاينها، وبعد الحفظ ترحّلها أو تستبعدها."
        actions={
          <>
            <DocStatusBadge status={header.status} />
            {back}
          </>
        }
      />
      {data.ok ? (
        <OpeningEditor
          key={String(header.docId) + ':' + String(header.version)}
          draft={{ header, payload: detail.draftPayload }}
          catalog={data.catalog}
          locations={data.locations}
          today={cairoToday(new Date())}
        />
      ) : (
        <EditorBlocked reasons={data.reasons} backHref="/inventory/openings" backLabel="رجوع لرصيد أول المدة" />
      )}
    </>
  )
})
