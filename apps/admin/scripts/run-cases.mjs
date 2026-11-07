/**
 * مشغّل حالات اللوحة — منطق خالص بس، من غير داتابيز ولا شبكة ولا متغيرات بيئة.
 *
 * الاستخدام:  pnpm --filter @zell/admin cases
 *
 * بيحوّل ملفات كل مجلد في SUITES بـ TypeScript (موجود أصلًا في devDependencies — مفيش
 * dependency جديدة ولا تغيير في pnpm-lock.yaml) لـ CommonJS في مجلد مؤقت، وبعدين بيشغّل
 * دالة الحالات فعليًا ويطبع كل فشل بالتفصيل.
 *
 * ⚠️ الملفات اللي بتتشغّل لازم تكون خالية من server-only ومن أي استيراد قيمة برّه المجلد غير @zell/core
 *    (استيراد الأنواع بس مسموح لأنه بيتشال وقت التحويل). لو حد كسر القاعدة دي التشغيل بيفشل. استثناء: مجلدات
 *    also في الـ suite بتتحوّل قبلها (المجلد نفسه بس، من غير اللي جواه)، فاستيراد قيمة منها مسموح.
 * @zell/core: زي apps/storefront/scripts/run-cases.mjs، packages/core/src بيتحوّل لـ node_modules/@zell/core المؤقت.
 * link في الـ suite: حزم بالاسم من node_modules بتاع اللوحة بتتربط (symlink للمسار الحقيقي) في node_modules المؤقت،
 *    عشان الحالات تشغّل المكتبة الحقيقية (auth-cookies: @supabase/ssr وnext). من غير dependency جديدة.
 *
 * سطر النتيجة:  ZELL_ADMIN_CASES_RESULT pass=<n> fail=<n>
 * والخروج بكود 1 لو فيه أي فشل، أو لو مفيش ولا حالة اتشغّلت.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const coreSrc = join(appRoot, '..', '..', 'packages', 'core', 'src')

const SUITES = [
  { name: 'access', dir: 'lib/access', entry: 'access.cases.ts', run: 'runAccessCases' },
  { name: 'manifest', dir: 'lib/access', entry: 'manifest.cases.ts', run: 'runManifestCases' },
  { name: 'orders', dir: 'lib/orders', entry: 'orders.cases.ts', run: 'runOrderCases' },
  { name: 'payments', dir: 'lib/orders', entry: 'payments.cases.ts', run: 'runPaymentCases' },
  { name: 'delivery', dir: 'lib/orders', entry: 'deliverySettings.cases.ts', run: 'runDeliverySettingsCases' },
  { name: 'shipping-options', dir: 'lib/orders', entry: 'shippingOptions.cases.ts', run: 'runShippingOptionsCases' },
  { name: 'track-updates', dir: 'lib/orders', entry: 'trackUpdates.cases.ts', run: 'runTrackUpdatesCases' },
  { name: 'track-drafts', dir: 'lib/orders', entry: 'trackDrafts.cases.ts', run: 'runTrackDraftsCases' },
  { name: 'list-filters', dir: 'lib/orders', entry: 'listFilters.cases.ts', run: 'runListFiltersCases' },
  { name: 'home', dir: 'lib/content', entry: 'homeMobile.cases.ts', run: 'runHomeMobileCases' },
  { name: 'size-entry', dir: 'lib/content', entry: 'sizeEntry.cases.ts', run: 'runSizeEntryCases' },
  { name: 'size-texts', dir: 'lib/content', entry: 'sizeTexts.cases.ts', run: 'runSizeTextsCases' },
  { name: 'storefront-link', dir: 'lib/storefront', entry: 'link.cases.ts', run: 'runStorefrontLinkCases' },
  { name: 'policy-save', dir: 'lib/content', entry: 'policySave.cases.ts', run: 'runPolicySaveCases' },
  { name: 'product-delete', dir: 'lib/products', entry: 'deleteProduct.cases.ts', run: 'runProductDeleteCases' },
  { name: 'order-purge', dir: 'lib/orders', entry: 'purge.cases.ts', run: 'runOrderPurgeCases' },
  // IMAGE-DELETE C1 — حذف الصورة وسلّم التراجع في الرفع (ضياع رد التعيين أو الإدخال).
  { name: 'images', dir: 'lib/images', entry: 'images.cases.ts', run: 'runImageCases' },
  // أكواد الخصم: الحالات كانت بتتعمل typecheck بس ومابتتشغّلش (مراجعة أمنية 2026-11).
  { name: 'coupons', dir: 'lib/coupons', entry: 'form.cases.ts', run: 'runAdminCouponCases', also: ['lib', 'lib/orders'] },
  // COOKIES-HEADERS §٣ — كوكيز الجلسة المكتوبة فعليًا بالمكتبة الحقيقية وfetch مزيّف. آخر suite لأنها بتغيّر متغيرات البيئة وfetch (وبترجّعهم).
  { name: 'auth-cookies', dir: 'lib/auth', entry: 'cookies.cases.ts', run: 'runAuthCookieCases', link: ['@supabase/ssr', 'next'] },
]

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  isolatedModules: true,
}

function transpileDir(srcDir, outDir) {
  mkdirSync(outDir, { recursive: true })
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
    const source = readFileSync(join(srcDir, file), 'utf8')
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: COMPILER_OPTIONS })
    if (result.diagnostics && result.diagnostics.length > 0) {
      const text = ts.formatDiagnostics(result.diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => srcDir,
        getNewLine: () => '\n',
      })
      throw new Error('تحويل ' + srcDir + '/' + file + ' فشل:\n' + text)
    }
    writeFileSync(join(outDir, file.replace(/\.ts$/, '.js')), result.outputText)
  }
}

const outRoot = mkdtempSync(join(tmpdir(), 'zell-admin-cases-'))
const linked = new Set()

function linkPackage(name) {
  if (linked.has(name)) return
  const target = realpathSync(join(appRoot, 'node_modules', name))
  const link = join(outRoot, 'node_modules', name)
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'dir')
  linked.add(name)
}
writeFileSync(join(outRoot, 'package.json'), '{ "type": "commonjs" }\n')
const require = createRequire(join(outRoot, 'index.js'))

let totalPass = 0
let totalFail = 0

try {
  const coreOut = join(outRoot, 'node_modules', '@zell', 'core')
  transpileDir(coreSrc, coreOut)
  writeFileSync(join(coreOut, 'package.json'), '{ "name": "@zell/core", "type": "commonjs", "main": "index.js" }\n')

  for (const suite of SUITES) {
    for (const name of suite.link || []) linkPackage(name)
    for (const extra of suite.also || []) transpileDir(join(appRoot, extra), join(outRoot, extra))
    const outDir = join(outRoot, suite.dir)
    transpileDir(join(appRoot, suite.dir), outDir)

    const mod = require(join(outDir, suite.entry.replace(/\.ts$/, '.js')))
    const runner = mod[suite.run]
    if (typeof runner !== 'function') throw new Error(suite.entry + ' مافيهوش ' + suite.run)

    const report = await runner()
    for (const failure of report.failures) {
      console.error('FAIL [' + suite.name + '] ' + failure.name)
      console.error('  expected: ' + failure.expected)
      console.error('  actual:   ' + failure.actual)
    }
    console.log('ZELL_ADMIN_CASES suite=' + suite.name + ' pass=' + report.passed + ' fail=' + report.failures.length)
    totalPass += report.passed
    totalFail += report.failures.length
  }
} finally {
  rmSync(outRoot, { recursive: true, force: true })
}

console.log('ZELL_ADMIN_CASES_RESULT pass=' + totalPass + ' fail=' + totalFail)
process.exitCode = totalFail > 0 || totalPass === 0 ? 1 : 0
