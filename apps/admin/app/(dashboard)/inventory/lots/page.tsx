import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LotStatusBadge } from '../../../../components/inventory/InvStatusBadge'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../components/ui/Button'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { inputClasses } from '../../../../components/ui/Field'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { requireAdminPage } from '../../../../lib/auth/guards'
import { readInventoryProductNames } from '../../../../lib/data/reads'
import { formatDate } from '../../../../lib/format'
import { LOT_STATUS_LABELS } from '../../../../lib/inventory/labels'
import { locationLabel, parseLotStatusParam, productIdsOf, productLabel, type LotStatusFilter } from '../../../../lib/inventory/lots'
import { formatMetersAndCm, formatPiastresExact } from '../../../../lib/inventory/money'
import { parseIdParam } from '../../../../lib/inventory/purchases'
import { listLots } from '../../../../lib/mutations/inventoryOpenings'
import { loadLocationOptions } from '../../../../lib/mutations/inventoryPurchases'

export const metadata: Metadata = { title: 'الدفعات' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

type Filters = { status: LotStatusFilter; productId: number | null; locationId: number | null }

function lotsHref(filters: Filters, beforeId: number | null): string {
  const params = new URLSearchParams()
  if (filters.status !== 'active') params.set('status', filters.status)
  if (filters.productId !== null) params.set('product', String(filters.productId))
  if (filters.locationId !== null) params.set('location', String(filters.locationId))
  if (beforeId !== null) params.set('before', String(beforeId))
  const query = params.toString()
  return query === '' ? '/inventory/lots' : '/inventory/lots?' + query
}

const SOURCE_LABELS = { purchase: 'شراء', opening: 'رصيد أول المدة' } as const

/**
 * الدفعات (0020-UI · PR-C) — للمالك بس، وفيها التكاليف.
 * الأسماء بتتدمج على السيرفر بعدد ثابت من الطلبات (من غير N+1 ومن غير قراءة جداول 0020 مباشرة):
 *   list_lots + أسماء المنتجات الظاهرة (طلب واحد بفلتر ids) + list_locations (صفحات بحد أمان).
 * الاسم الغايب بيظهر «منتج #id» / «مخزن #id»، ولو قايمة المخازن أكبر من الحد بيظهر تنبيه.
 */
export default async function LotsPage({ searchParams }: PageProps) {
  const identity = await requireAdminPage()
  if (identity.role !== 'owner') redirect('/403')

  const params = await searchParams
  const filters: Filters = {
    status: parseLotStatusParam(params['status']),
    productId: parseIdParam(params['product']),
    locationId: parseIdParam(params['location']),
  }
  const beforeId = parseIdParam(params['before'])

  const [result, locations] = await Promise.all([
    listLots(identity.userId, { ...filters, beforeId }),
    loadLocationOptions(identity.userId, true),
  ])

  let productNames = new Map<number, string>()
  let namesFailed = false
  if (result.ok && result.data.items.length > 0) {
    try {
      productNames = await readInventoryProductNames(productIdsOf(result.data.items))
    } catch {
      namesFailed = true
    }
  }
  const locationNames = new Map<number, string>(
    locations.ok ? locations.data.items.map((location) => [location.locationId, location.name]) : [],
  )

  return (
    <>
      <PageHeader title="الدفعات" description="كل لفّة دفعة، وكل بند قطع دفعة — من الشراء ومن رصيد أول المدة، بتكلفتها النهائية." />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {(['active', 'voided'] as const).map((status) => (
          <Link
            key={status}
            href={lotsHref({ ...filters, status }, null)}
            className={buttonClasses(filters.status === status ? 'primary' : 'secondary', 'sm')}
          >
            {LOT_STATUS_LABELS[status]}
          </Link>
        ))}
        {filters.productId !== null ? (
          <Link href={lotsHref({ ...filters, productId: null }, null)} className={buttonClasses('secondary', 'sm')}>
            {productLabel(productNames, filters.productId)} · كل المنتجات
          </Link>
        ) : null}

        {locations.ok ? (
          <form method="get" action="/inventory/lots" className="ms-auto flex items-center gap-1.5">
            {filters.status !== 'active' ? <input type="hidden" name="status" value={filters.status} /> : null}
            {filters.productId !== null ? <input type="hidden" name="product" value={String(filters.productId)} /> : null}
            <select
              name="location"
              defaultValue={filters.locationId === null ? '' : String(filters.locationId)}
              className={inputClasses + ' w-48'}
              aria-label="المخزن"
            >
              <option value="">كل المخازن</option>
              {locations.data.items.map((location) => (
                <option key={location.locationId} value={String(location.locationId)}>
                  {location.name + (location.isActive ? '' : ' (موقوف)')}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClasses('secondary', 'sm')}>
              فلترة
            </button>
          </form>
        ) : null}
      </div>

      {locations.ok && !locations.data.complete ? (
        <p className="mb-3 text-xs text-muted">قايمة المخازن أكبر من الحد (500)، فبعض الأسماء ممكن تظهر برقم المخزن.</p>
      ) : null}
      {!locations.ok ? <p className="mb-3 text-xs text-muted">مقدرناش نقرا أسماء المخازن، فبتظهر بأرقامها.</p> : null}
      {namesFailed ? <p className="mb-3 text-xs text-muted">مقدرناش نقرا أسماء المنتجات، فبتظهر بأرقامها.</p> : null}

      {!result.ok ? (
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا الدفعات.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      ) : result.data.items.length === 0 ? (
        <EmptyState title="مفيش دفعات هنا" description="الدفعات بتتعمل لما فاتورة شراء أو رصيد أول مدة يترحّل." />
      ) : (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>كود الدفعة</TH>
                <TH>المصدر</TH>
                <TH>المنتج</TH>
                <TH>المخزن</TH>
                <TH>الكمية</TH>
                <TH>التكلفة النهائية</TH>
                <TH>الاستلام</TH>
                <TH>الحالة</TH>
              </TR>
            </THead>
            <tbody>
              {result.data.items.map((lot) => (
                <TR key={lot.lotId}>
                  <TD>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {lot.lotCode}
                    </bdi>
                  </TD>
                  <TD>{SOURCE_LABELS[lot.sourceKind]}</TD>
                  <TD>
                    <Link href={lotsHref({ ...filters, productId: lot.productId }, null)} className="hover:underline">
                      {productLabel(productNames, lot.productId)}
                    </Link>
                  </TD>
                  <TD>{locationLabel(locationNames, lot.locationId)}</TD>
                  <TD className="whitespace-nowrap">
                    {lot.lotKind === 'roll'
                      ? (lot.initialLengthCm !== null ? formatMetersAndCm(lot.initialLengthCm) : '—') +
                        (lot.widthCm !== null ? ' · عرض ' + String(lot.widthCm) + ' سم' : '')
                      : String(lot.initialQuantity ?? 0) + ' قطعة'}
                  </TD>
                  <TD className="whitespace-nowrap font-semibold">
                    {formatPiastresExact(lot.landedCostPiastres)}
                    {lot.costIsEstimated ? <span className="ms-1 text-xs font-normal text-muted">(تقديري)</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(lot.receivedOn)}</TD>
                  <TD>
                    <LotStatusBadge status={lot.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {beforeId !== null || result.data.nextBeforeId !== null ? (
            <div className="flex items-center justify-end gap-1.5">
              {beforeId !== null ? (
                <Link href={lotsHref(filters, null)} className={buttonClasses('secondary', 'sm')}>
                  الأحدث
                </Link>
              ) : null}
              {result.data.nextBeforeId !== null ? (
                <Link href={lotsHref(filters, result.data.nextBeforeId)} className={buttonClasses('secondary', 'sm')}>
                  الأقدم
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
