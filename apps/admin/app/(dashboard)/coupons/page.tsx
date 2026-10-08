import type { Metadata } from 'next'
import Link from 'next/link'
import { CouponsList } from '../../../components/coupons/CouponsList'
import { CouponsToggle } from '../../../components/coupons/CouponsToggle'
import { PageHeader } from '../../../components/shell/PageHeader'
import { buttonClasses } from '../../../components/ui/Button'
import { pageWithAccess } from '../../../lib/access/instance'
import { countLiveCoupons, listCoupons, readCouponsSwitch } from '../../../lib/data/coupons'

export const metadata: Metadata = { title: 'أكواد الخصم' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * أكواد الخصم (0019 · PR5) — للمالك بس. الـadmin بيشوف بيانات الخصم جوه الطلبات بس.
 * ⚠️ إخفاء الصفحة مش الحماية: كل action بيتحقق من الدور على السيرفر (lib/couponActions).
 */
export default pageWithAccess('zell.coupons.view', async function CouponsPage(ctx, { searchParams }: PageProps) {
  const identity = ctx.identity

  const params = await searchParams
  const pageRaw = typeof params['page'] === 'string' ? Number(params['page']) : 1
  const [list, toggle, liveCount] = await Promise.all([listCoupons(pageRaw), readCouponsSwitch(), countLiveCoupons()])
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize))

  return (
    <>
      <PageHeader
        title="أكواد الخصم"
        description="الخصم على الأصناف بس — مش على الشحن ولا الفني. الداتابيز هي اللي بتحسم وقت الطلب."
      />

      <div className="space-y-5">
        <CouponsToggle enabled={toggle.enabled} liveCount={liveCount} />
        <CouponsList rows={list.rows} />

        {list.total > list.pageSize ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              صفحة {list.page} من {lastPage} · {list.total} كوبون
            </p>
            <div className="flex items-center gap-1.5">
              {list.page > 1 ? (
                <Link href={'/coupons?page=' + String(list.page - 1)} className={buttonClasses('secondary', 'sm')}>
                  السابق
                </Link>
              ) : null}
              {list.page < lastPage ? (
                <Link href={'/coupons?page=' + String(list.page + 1)} className={buttonClasses('secondary', 'sm')}>
                  التالي
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
})
