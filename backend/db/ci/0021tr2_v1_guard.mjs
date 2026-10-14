/**
 * TRACK-ORDER v2 W1 — توافق حارس v1 المنشور مع رد v2 (العقد TRACK-ORDER-v2 §٢-١): CI بس.
 *
 * الاستخدام (من backend/db/ci/0021tr2_sql_ci.sh):
 *   node backend/db/ci/0021tr2_v1_guard.mjs ROOT V1SRC V1_TSV V2_TSV
 *     ROOT    جذر الريبو (علشان typescript من devDependencies بتاعة المتجر — مفيش dependency جديدة)
 *     V1SRC   مجلد فيه apps/storefront/lib/orders/trackOrder.ts و packages/core/src من كوميت v1 (git archive، والـ blob
 *             بيتثبّت في الـ shell قبل النداء)
 *     V1_TSV  رد v1 لكل طلب قبل التطبيق:  <order_number>\t<json>
 *     V2_TSV  رد v2 لنفس الطلبات بعد التطبيق (وبعد شحنات ورسايل حقيقية)
 *
 * زي apps/storefront/scripts/run-cases.mjs: بيحوّل الملفات لـ CommonJS في مجلد مؤقت (@zell/core في node_modules المؤقت)،
 * وبيشغّل parseTrackedOrder فعليًا. لكل طلب لازم:
 *   • الحارس على v1 ≠ null وعلى v2 ≠ null، والنتيجتين متطابقين بالحرف (same)
 *   • مفاتيح v1 من رد v2 = رد v1 بالحرف (raw_same)
 *   • رد v2 بحالة غلط = null (control_null — يثبت إن الحارس اتشغّل فعلًا)
 * سطر النتيجة:  ZELL_TR2_V1_GUARD orders=<n> nonnull=<n> same=<n> raw_same=<n> control_null=<n>
 * والخروج بكود 1 لو أي طلب ماعدّاش، أو لو مفيش طلبات، أو لو مجموعة الطلبات مختلفة بين الملفين.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [root, v1src, v1tsv, v2tsv] = process.argv.slice(2)
if (!root || !v1src || !v1tsv || !v2tsv) {
  console.error('usage: 0021tr2_v1_guard.mjs ROOT V1SRC V1_TSV V2_TSV')
  process.exit(2)
}

const ts = createRequire(join(root, 'apps', 'storefront', 'package.json'))('typescript')

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
    if (result.diagnostics && result.diagnostics.length > 0) throw new Error('transpile failed: ' + srcDir + '/' + file)
    writeFileSync(join(outDir, file.replace(/\.ts$/, '.js')), result.outputText)
  }
}

function readTsv(path) {
  const out = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab < 0) throw new Error('bad line in ' + path)
    out.set(line.slice(0, tab), JSON.parse(line.slice(tab + 1)))
  }
  return out
}

function canon(value) {
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canon(value[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

const outRoot = mkdtempSync(join(tmpdir(), 'zell-tr2-v1-guard-'))
let exitCode = 1
try {
  writeFileSync(join(outRoot, 'package.json'), '{ "type": "commonjs" }\n')
  const require = createRequire(join(outRoot, 'index.js'))
  const coreOut = join(outRoot, 'node_modules', '@zell', 'core')
  transpileDir(join(v1src, 'packages', 'core', 'src'), coreOut)
  writeFileSync(join(coreOut, 'package.json'), '{ "name": "@zell/core", "type": "commonjs", "main": "index.js" }\n')
  const guardOut = join(outRoot, 'guard')
  transpileDir(join(v1src, 'apps', 'storefront', 'lib', 'orders'), guardOut)
  const parse = require(join(guardOut, 'trackOrder.js')).parseTrackedOrder
  if (typeof parse !== 'function') throw new Error('parseTrackedOrder missing')

  const v1 = readTsv(v1tsv)
  const v2 = readTsv(v2tsv)
  const counts = { orders: 0, nonnull: 0, same: 0, raw_same: 0, control_null: 0 }
  const sameSet = v1.size === v2.size && [...v1.keys()].every((k) => v2.has(k))
  for (const [num, r1] of v1) {
    counts.orders += 1
    const r2 = v2.get(num)
    const p1 = parse(r1)
    const p2 = parse(r2)
    if (p1 !== null && p2 !== null) counts.nonnull += 1
    else console.error('NULL ' + num + ' v1=' + (p1 === null) + ' v2=' + (p2 === null))
    if (p1 !== null && canon(p1) === canon(p2)) counts.same += 1
    else console.error('DIFF ' + num)
    const picked = {}
    if (r1 !== null && typeof r1 === 'object' && r2 !== null && typeof r2 === 'object') {
      for (const k of Object.keys(r1)) picked[k] = r2[k]
      if (canon(picked) === canon(r1)) counts.raw_same += 1
      else console.error('RAW ' + num)
      if (parse({ ...r2, status: 'not_a_status' }) === null) counts.control_null += 1
      else console.error('CONTROL ' + num)
    }
  }
  console.log('ZELL_TR2_V1_GUARD orders=' + counts.orders + ' nonnull=' + counts.nonnull + ' same=' + counts.same
    + ' raw_same=' + counts.raw_same + ' control_null=' + counts.control_null)
  const ok = sameSet && counts.orders > 0 && counts.nonnull === counts.orders && counts.same === counts.orders
    && counts.raw_same === counts.orders && counts.control_null === counts.orders
  if (!sameSet) console.error('ORDER SETS DIFFER')
  exitCode = ok ? 0 : 1
} finally {
  rmSync(outRoot, { recursive: true, force: true })
}
process.exitCode = exitCode
