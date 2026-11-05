/**
 * INSTALLER-SHIPPING C — حالات المتجر (suite installer-shipping، بتتشغّل فعلًا في CI: pnpm --filter @zell/storefront cases).
 *   • Checkout: الفني الجاهز = الشحن 0، ومن غير shippingMethod ولا قفل السريع ولا اختيار «عادي/سريع»؛ من غير فني جاهز = EXPRESS بالحرف.
 *   • المقدّم مع الفني على الشحن 0 (طريقة «shipping» = البديل).
 *   • العرض من اللقطة المحفوظة: طلب قديم بفني وشحن موجب (زي FLM-CRS5EA: شحن 80 + انتقال 80) = السطور القديمة بالظبط؛
 *     طلب بفني وشحن 0 = من غير سطر شحن و«توصيل وانتقال الفني»؛ طلب من غير فني بشحن 0 (حد مجاني) = زي النهارده.
 * منطق خالص؛ مقارنة core ↔ Postgres بعد 0025 على آلاف الحالات في CI: backend/db/ci/0025_core_parity.mjs.
 */

import {
  INSTALLER_DELIVERY_LABEL,
  chargedShippingPiastres,
  confirmationFeePiastres,
  installerDeliveryShown,
  parseShippingOptions,
  type ShippingQuoteInput,
} from '@zell/core'
import { checkoutShippingField, shippingBlockShown, shippingChoiceShown, shippingChoiceView, shippingSubmitField } from './shippingChoice'
import type { TrackedOrder } from './trackOrder'
import { trackMoneyLines } from './trackView'

export type InstallerShippingCaseFailure = { name: string; expected: string; actual: string }
export type InstallerShippingCaseReport = { passed: number; failures: InstallerShippingCaseFailure[] }

const failures: InstallerShippingCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const OPTIONS = parseShippingOptions({
  express_enabled: true,
  governorates: {
    'القاهرة': { standard_days_min: 2, standard_days_max: 4, express_enabled: true, express_price_piastres: 11000, express_days_min: 1, express_days_max: 1 },
    'الجيزة': { standard_days_min: 3, standard_days_max: 5, express_enabled: false },
  },
})

function quote(governorate: string, subtotalPiastres: number): ShippingQuoteInput {
  return { governorate, subtotalPiastres, rates: { 'القاهرة': 5000, 'الجيزة': 6000 }, defaultPiastres: 0, freeThresholdPiastres: 500000 }
}

function tracked(money: { items: number; discount?: number; shipping: number; installation: number; travel: number }, method: 'standard' | 'express' | null): TrackedOrder {
  const total = money.items - (money.discount ?? 0) + money.shipping + money.installation + money.travel
  return {
    status: 'new',
    shipping: method === null ? null : { method, daysMin: null, daysMax: null },
    money: {
      itemsPiastres: money.items,
      discountPiastres: money.discount ?? 0,
      shippingPiastres: money.shipping,
      installationPiastres: money.installation,
      travelPiastres: money.travel,
      totalPiastres: total,
      confirmationFeePiastres: 0,
      paidPiastres: 0,
      refundedPiastres: 0,
      netPaidPiastres: 0,
      remainingPiastres: total,
    },
  } as unknown as TrackedOrder
}

function lines(order: TrackedOrder): string[] {
  return trackMoneyLines(order).charges.map((line) => line.label + '=' + String(line.amountPiastres))
}

function checkoutCases(): void {
  check('I01 charged shipping: installer ready = 0, otherwise the method shipping as is (null = governorate not chosen yet)',
    [chargedShippingPiastres(true, 5000), chargedShippingPiastres(false, 5000), chargedShippingPiastres(false, null), chargedShippingPiastres(true, 11000), chargedShippingPiastres(false, 0)],
    [0, 5000, null, 0, 0])
  check('I02 the one line label (owner decision Q3, no «مجاني»)', INSTALLER_DELIVERY_LABEL, 'توصيل وانتقال الفني')

  // مسودة قديمة فيها «سريع» والسريع متاح للقاهرة
  const cairoExpress = shippingChoiceView('express', quote('القاهرة', 90000), OPTIONS)
  check('I03 installer ready + draft express (available): no shippingMethod in the body, no choice, no block',
    [checkoutShippingField(cairoExpress, true), shippingChoiceShown(cairoExpress, true), shippingBlockShown(cairoExpress, true)],
    [{}, false, false])
  check('I04 not ready (installer chosen, area missing) or self: EXPRESS behaviour unchanged (express sent, choice shown)',
    [checkoutShippingField(cairoExpress, false), shippingSubmitField(cairoExpress), shippingChoiceShown(cairoExpress, false), cairoExpress.shippingPiastres],
    [{ shippingMethod: 'express' }, { shippingMethod: 'express' }, true, 11000])

  // «سريع» مختار والسريع مش متاح للجيزة
  const gizaExpress = shippingChoiceView('express', quote('الجيزة', 90000), OPTIONS)
  check('I05 express unavailable: with installer ready = no block and the order can be sent; without = blocked as before',
    [gizaExpress.blocked, checkoutShippingField(gizaExpress, true), shippingBlockShown(gizaExpress, true), checkoutShippingField(gizaExpress, false), shippingBlockShown(gizaExpress, false)],
    ['unavailable', {}, false, null, true])

  // القراية فشلت (options = null) و«سريع» مختار
  const unread = shippingChoiceView('express', quote('القاهرة', 90000), null)
  check('I06 options unreadable + express: installer ready = no block; otherwise blocked (unread) as before',
    [unread.blocked, shippingBlockShown(unread, true), checkoutShippingField(unread, true), shippingBlockShown(unread, false)],
    ['unread', false, {}, true])

  const standard = shippingChoiceView('standard', quote('القاهرة', 90000), OPTIONS)
  check('I07 standard choice: installer ready = body without shippingMethod (same as standard today); shipping shown as 0 in the summary',
    [checkoutShippingField(standard, true), checkoutShippingField(standard, false), chargedShippingPiastres(true, standard.shippingPiastres)],
    [{}, {}, 0])
}

function feeCases(): void {
  const shippingFee = { enabled: true, scope: 'all', method: 'shipping', shipping_fallback_piastres: 3000 }
  const installer = { totalPiastres: 97000, shippingPiastres: chargedShippingPiastres(true, 5000) ?? -1, madeToMeasure: true, installation: true }
  const self = { totalPiastres: 95000, shippingPiastres: 5000, madeToMeasure: true, installation: false }
  check('I08 deposit with installer uses shipping 0: method shipping -> fallback 3000; without installer -> shipping 5000',
    [confirmationFeePiastres(shippingFee, installer), confirmationFeePiastres(shippingFee, self)], [3000, 5000])
  const above = { enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 2500, threshold_piastres: 100000 }
  check('I09 above_amount: installer total 97000 (old 102000) drops under 100000 -> 0',
    [confirmationFeePiastres(above, installer), confirmationFeePiastres(above, { ...installer, totalPiastres: 102000, shippingPiastres: 5000 })], [0, 2500])
}

function displayCases(): void {
  check('I10 snapshot rule: installer + stored shipping 0 only',
    [installerDeliveryShown(true, 0), installerDeliveryShown(true, 8000), installerDeliveryShown(false, 0), installerDeliveryShown(false, 5000)],
    [true, false, false, false])
  check('I11 old installer order with positive stored shipping (FLM-CRS5EA: shipping 80 + travel 80): old lines exactly',
    lines(tracked({ items: 90000, shipping: 8000, installation: 4500, travel: 8000 }, null)),
    ['الأصناف=90000', 'الشحن=8000', 'التركيب=4500', 'انتقال الفني=8000'])
  check('I12 new installer order (stored shipping 0): no shipping line, one «توصيل وانتقال الفني» line with its value',
    lines(tracked({ items: 90000, shipping: 0, installation: 4500, travel: 2500 }, null)),
    ['الأصناف=90000', 'التركيب=4500', 'توصيل وانتقال الفني=2500'])
  check('I13 installer area with travel 0: the line stays with 0 (no «مجاني»)',
    lines(tracked({ items: 90000, shipping: 0, installation: 4500, travel: 0 }, null)),
    ['الأصناف=90000', 'التركيب=4500', 'توصيل وانتقال الفني=0'])
  check('I14 no installer, free shipping (stored 0): unchanged («الشحن» line with 0)',
    lines(tracked({ items: 600000, shipping: 0, installation: 0, travel: 0 }, 'standard')),
    ['الأصناف=600000', 'الشحن=0'])
  check('I15 no installer, express: unchanged',
    lines(tracked({ items: 90000, discount: 5000, shipping: 11000, installation: 0, travel: 0 }, 'express')),
    ['الأصناف=90000', 'الخصم=5000', 'الشحن السريع=11000'])
  const old = trackMoneyLines(tracked({ items: 90000, shipping: 8000, installation: 4500, travel: 8000 }, null))
  const fresh = trackMoneyLines(tracked({ items: 90000, shipping: 0, installation: 4500, travel: 2500 }, null))
  check('I16 the shown lines add up to the stored total (old and new installer orders)',
    [old.charges.reduce((sum, line) => sum + (line.minus ? -line.amountPiastres : line.amountPiastres), 0) === old.totalPiastres,
     fresh.charges.reduce((sum, line) => sum + (line.minus ? -line.amountPiastres : line.amountPiastres), 0) === fresh.totalPiastres],
    [true, true])
}

export async function runInstallerShippingCases(): Promise<InstallerShippingCaseReport> {
  checkoutCases()
  feeCases()
  displayCases()
  return { passed, failures }
}
