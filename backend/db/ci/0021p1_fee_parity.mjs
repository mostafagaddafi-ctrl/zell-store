#!/usr/bin/env node
// 0021-A P1 — حالات مقارنة رسوم التأكيد: core (packages/core/src/confirmationFee.ts) مقابل الداتابيز (zell_payment_fee_calc).
// بيطبع TSV: الإعداد (JSON) · الإجمالي · الشحن · مقاس (t/f) · تركيب (t/f) · الرسوم من core. الـ CI بيحمّله ويقارن بالـ SQL.
// حتمي (مولّد أرقام ثابت البذرة)، وفيه حالات حدود وإعدادات مش صالحة (= 0 في الاتنين).
// التشغيل: node --experimental-strip-types backend/db/ci/0021p1_fee_parity.mjs > fee.tsv
import { confirmationFeePiastres } from '../../../packages/core/src/confirmationFee.ts'

let seed = 20261010
function rnd(n) {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
  return seed % n
}

const scopes = ['all', 'made_to_measure', 'with_installation', 'above_amount']
const methods = {
  percent: [1, 50, 250, 999, 1000, 3333, 5000, 9999, 10000].map((v) => ({ percent_bp: v })),
  fixed: [1, 99, 5000, 12345, 100000000].map((v) => ({ fixed_piastres: v })),
  shipping: [1, 3000, 99999].map((v) => ({ shipping_fallback_piastres: v })),
}
const thresholds = [1, 100000, 250000, 100000000]

const configs = []
for (const scope of scopes) {
  for (const [method, values] of Object.entries(methods)) {
    for (const value of values) {
      if (scope === 'above_amount') {
        for (const t of thresholds) configs.push({ enabled: true, scope, method, ...value, threshold_piastres: t })
      } else {
        configs.push({ enabled: true, scope, method, ...value })
      }
    }
  }
}
// مقفول، ونواقص، وقيم مش صالحة: كله = 0 أو بيتجاهل القيمة الغلط في الاتنين.
configs.push(
  { enabled: false },
  { enabled: false, scope: 'all', method: 'fixed', fixed_piastres: 5000 },
  { enabled: true, scope: 'all', method: 'percent' },
  { enabled: true, scope: 'all', method: 'percent', percent_bp: 0 },
  { enabled: true, scope: 'all', method: 'percent', percent_bp: 10001 },
  { enabled: true, scope: 'all', method: 'percent', percent_bp: 2.5 },
  { enabled: true, scope: 'all', method: 'fixed', fixed_piastres: '5000' },
  { enabled: true, scope: 'all', method: 'fixed', fixed_piastres: 100000001 },
  { enabled: true, scope: 'all', method: 'shipping' },
  { enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 5000 },
  { enabled: true, scope: 'above_amount', method: 'fixed', fixed_piastres: 5000, threshold_piastres: -5 },
  { enabled: true, scope: 'nope', method: 'fixed', fixed_piastres: 5000 },
  { enabled: true, scope: 'all', method: 'nope', fixed_piastres: 5000 },
  { enabled: 'true', scope: 'all', method: 'fixed', fixed_piastres: 5000 },
)

const edgeTotals = [0, 1, 99, 100, 101, 99999, 100000, 100001, 249999, 250000, 250001, 999999, 1000000, 2147483647]
const shippings = [0, 0, 1, 3000, 5000, 6000, 9000]
const lines = []
for (const cfg of configs) {
  const cases = edgeTotals.map((t) => t).concat(Array.from({ length: 40 }, () => rnd(3000000)))
  for (const total of cases) {
    const ship = shippings[rnd(shippings.length)]
    const mtm = rnd(2) === 1
    const inst = rnd(2) === 1
    const fee = confirmationFeePiastres(cfg, { totalPiastres: total, shippingPiastres: ship, madeToMeasure: mtm, installation: inst })
    lines.push([JSON.stringify(cfg), total, ship, mtm ? 't' : 'f', inst ? 't' : 'f', fee].join('\t'))
  }
}
process.stdout.write(lines.join('\n') + '\n')
