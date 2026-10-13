/**
 * مشغّل حالات المتجر — منطق خالص بس، من غير داتابيز ولا شبكة ولا متغيرات بيئة (0021-D2 W2).
 *
 * الاستخدام:  pnpm --filter @zell/storefront cases
 *
 * زي apps/admin/scripts/run-cases.mjs: بيحوّل ملفات كل مجلد في SUITES بـ TypeScript (موجود أصلًا في devDependencies —
 * مفيش dependency جديدة ولا تغيير في pnpm-lock.yaml) لـ CommonJS في مجلد مؤقت، وبيشغّل دالة الحالات فعليًا.
 * الفرق: ملفات المتجر بتستورد @zell/core، فالمشغّل بيحوّل packages/core/src كمان لـ node_modules/@zell/core المؤقت.
 *
 * ⚠️ الملفات اللي بتتشغّل لازم تكون خالية من server-only ومن أي استيراد قيمة برّه المجلد غير @zell/core
 *    (استيراد الأنواع بس مسموح لأنه بيتشال وقت التحويل).
 *
 * سطر النتيجة:  ZELL_STOREFRONT_CASES_RESULT pass=<n> fail=<n>
 * والخروج بكود 1 لو فيه أي فشل، أو لو مفيش ولا حالة اتشغّلت.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const coreSrc = join(appRoot, '..', '..', 'packages', 'core', 'src')

const SUITES = [
  { name: 'delivery', dir: 'lib/orders', entry: 'deliverySettings.cases.ts', run: 'runDeliverySettingsCases' },
  { name: 'install', dir: 'lib/install', entry: 'installChoice.cases.ts', run: 'runInstallChoiceCases' },
  { name: 'home', dir: 'lib/home', entry: 'homeLayout.cases.ts', run: 'runHomeLayoutCases' },
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

const outRoot = mkdtempSync(join(tmpdir(), 'zell-storefront-cases-'))
writeFileSync(join(outRoot, 'package.json'), '{ "type": "commonjs" }\n')
const require = createRequire(join(outRoot, 'index.js'))

let totalPass = 0
let totalFail = 0

try {
  const coreOut = join(outRoot, 'node_modules', '@zell', 'core')
  transpileDir(coreSrc, coreOut)
  writeFileSync(join(coreOut, 'package.json'), '{ "name": "@zell/core", "type": "commonjs", "main": "index.js" }\n')

  for (const suite of SUITES) {
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
    console.log('ZELL_STOREFRONT_CASES suite=' + suite.name + ' pass=' + report.passed + ' fail=' + report.failures.length)
    totalPass += report.passed
    totalFail += report.failures.length
  }
} finally {
  rmSync(outRoot, { recursive: true, force: true })
}

console.log('ZELL_STOREFRONT_CASES_RESULT pass=' + totalPass + ' fail=' + totalFail)
process.exitCode = totalFail > 0 || totalPass === 0 ? 1 : 0
