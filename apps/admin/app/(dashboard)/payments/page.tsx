import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { PaymentMethodsManager } from '../../../components/payments/PaymentMethodsManager'
import { PaymentSettingsForm } from '../../../components/payments/PaymentSettingsForm'
import { Card } from '../../../components/ui/Field'
import { pageWithAccess } from '../../../lib/access/instance'
import { getPaymentAdminView } from '../../../lib/data/orderPayments'
import { PAYMENT_TEXT } from '../../../lib/orders/payments'

export const metadata: Metadata = { title: 'الدفع ورسوم التأكيد' }
export const dynamic = 'force-dynamic'

/** 0021-A P2 — إعدادات الدفع وطرقه (المالك بس — zell.orders.payments_admin). */
export default pageWithAccess('zell.orders.payments_admin', async function PaymentsPage(_ctx) {
  const { methods, settings } = await getPaymentAdminView()
  return (
    <>
      <PageHeader title="الدفع ورسوم التأكيد" description="رسوم التأكيد · البيع الآجل · أرقام الدفع · قالب واتساب · طرق الدفع" />
      <div className="grid gap-5 xl:grid-cols-2">
        {settings !== null ? (
          <PaymentSettingsForm settings={settings} />
        ) : (
          <Card title="رسوم التأكيد والدفع">
            <p className="text-xs text-muted">{PAYMENT_TEXT.unavailable}</p>
          </Card>
        )}
        {methods !== null ? (
          <PaymentMethodsManager methods={methods} />
        ) : (
          <Card title="طرق الدفع">
            <p className="text-xs text-muted">{PAYMENT_TEXT.unavailable}</p>
          </Card>
        )}
      </div>
    </>
  )
})
