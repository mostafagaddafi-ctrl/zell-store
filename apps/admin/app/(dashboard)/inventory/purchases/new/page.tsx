import type { Metadata } from 'next'
import Link from 'next/link'
import { EditorBlocked } from '../../../../../components/inventory/EditorBlocked'
import { PurchaseEditor } from '../../../../../components/inventory/PurchaseEditor'
import { PageHeader } from '../../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../../components/ui/Button'
import { pageWithAccess } from '../../../../../lib/access/instance'
import { loadPurchaseEditorData } from '../../../../../lib/data/inventoryEditor'
import { getPurchase } from '../../../../../lib/data/inventoryPurchases'
import { buildDuplicateSeed } from '../../../../../lib/inventory/purchaseDuplicate'
import { cairoToday } from '../../../../../lib/inventory/purchaseForm'
import { parseIdParam } from '../../../../../lib/inventory/purchases'

export const metadata: Metadata = { title: 'فاتورة شراء جديدة' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * فاتورة شراء جديدة (مسودة) — للمالك بس.
 * ?from=<docId> = تكرار فاتورة موجودة: النموذج بيتملى من الأصل (قراية بس) ويتراجع ويتعدّل قبل «حفظ».
 * مفيش إنشاء ولا ترحيل من غير الحفظ العادي، والأصل مابيتغيّرش (lib/inventory/purchaseDuplicate.ts).
 */
export default pageWithAccess('zell.inventory0020.view', async function NewPurchasePage(_ctx, { searchParams }: PageProps) {

  const params = await searchParams
  const fromId = parseIdParam(params['from'])
  const today = cairoToday(new Date())
  const [data, source] = await Promise.all([loadPurchaseEditorData(), fromId === null ? Promise.resolve(null) : getPurchase(fromId)])

  if (source !== null && !source.ok) {
    return (
      <>
        <PageHeader
          title="تكرار فاتورة شراء"
          actions={
            <Link href="/inventory/purchases" className={buttonClasses('secondary', 'sm')}>
              رجوع للمشتريات
            </Link>
          }
        />
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا الفاتورة الأصلية، فماعملناش نسخة.</p>
          <p className="text-muted">{source.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : source.message}</p>
          <p>
            <Link href="/inventory/purchases/new" className="text-brand hover:underline">
              فاتورة جديدة فاضية
            </Link>
          </p>
        </div>
      </>
    )
  }

  const seed =
    source !== null && source.ok && data.ok
      ? buildDuplicateSeed(source.data, today, {
          catalog: new Map(data.catalog.map((product) => [product.id, product])),
          activeSupplierIds: new Set(data.suppliers.map((supplier) => supplier.supplierId)),
          activeLocationIds: new Set(data.locations.map((location) => location.locationId)),
        })
      : null

  return (
    <>
      <PageHeader
        title={seed ? 'تكرار فاتورة ' + seed.sourceDocNo : 'فاتورة شراء جديدة'}
        description={
          seed
            ? 'مسودة جديدة من بيانات الفاتورة الأصلية، ولا تُحفظ إلا بعد مراجعتها والضغط على «حفظ». ولا تتغيّر الفاتورة الأصلية.'
            : 'بتتحفظ كمسودة الأول. الترحيل من صفحة المسودة بعد الحفظ والمعاينة.'
        }
      />
      {data.ok ? (
        seed ? (
          <PurchaseEditor
            draft={null}
            duplicate={seed}
            catalog={data.catalog}
            suppliers={data.suppliers}
            locations={data.locations}
            today={today}
          />
        ) : (
          <PurchaseEditor draft={null} catalog={data.catalog} suppliers={data.suppliers} locations={data.locations} today={today} />
        )
      ) : (
        <EditorBlocked reasons={data.reasons} />
      )}
    </>
  )
})
