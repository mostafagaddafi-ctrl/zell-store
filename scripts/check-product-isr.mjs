#!/usr/bin/env node
/**
 * PRODUCT-ISR §٢-٣ — فحص هيكلي **مكمّل** بعد بناء المتجر. مش دليل على المدة ولا التجديد؛
 * الدليل هو اختبار التكامل (apps/storefront/scripts/isr-integration). أي دليل ناقص = فشل صريح.
 *
 *   node scripts/check-product-isr.mjs --build-log <ملف لوج next build>
 *
 * بيتأكد من:
 *   ١. revalidate في صفحة المنتج رقم صريح واحد = REVALIDATE_SECONDS في lib/data/queries.ts.
 *   ٢. generateStaticParams بترجّع [] (مابتعدّش منتجات)، ومفيش dynamic / fetchCache / dynamicParams.
 *   ٣. /product/[productId] موجود في dynamicRoutes في .next/prerender-manifest.json (ISR مش Dynamic).
 *   ٤. سطر /product/[productId] في لوج البناء فيه ● ومفيهوش ƒ.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = 'apps/storefront/app/product/[productId]/page.tsx'
const QUERIES = 'apps/storefront/lib/data/queries.ts'
const MANIFEST = 'apps/storefront/.next/prerender-manifest.json'
const ROUTE = '/product/[productId]'

const failures = []
const fail = (message) => failures.push(message)

function read(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file)
  if (!existsSync(full)) {
    fail('missing file: ' + file)
    return ''
  }
  return readFileSync(full, 'utf8')
}

// ١ + ٢ — الإعداد في الصفحة
const page = read(PAGE)
const pageRevalidate = [...page.matchAll(/^export const revalidate = (\d+)\s*$/gm)].map((m) => Number(m[1]))
if (pageRevalidate.length !== 1) fail('page must export exactly one numeric revalidate, found ' + String(pageRevalidate.length))

const queries = read(QUERIES)
const dataSeconds = [...queries.matchAll(/^export const REVALIDATE_SECONDS = (\d+)\s*$/gm)].map((m) => Number(m[1]))
if (dataSeconds.length !== 1) fail('queries.ts must export exactly one numeric REVALIDATE_SECONDS, found ' + String(dataSeconds.length))

if (pageRevalidate.length === 1 && dataSeconds.length === 1 && pageRevalidate[0] !== dataSeconds[0]) {
  fail('page revalidate (' + String(pageRevalidate[0]) + ') != REVALIDATE_SECONDS (' + String(dataSeconds[0]) + ')')
}

if (!/^export async function generateStaticParams\(\)[^{]*\{\s*return \[\]\s*\}/m.test(page)) {
  fail('generateStaticParams must exist and return an empty list')
}
for (const name of ['dynamic', 'fetchCache', 'dynamicParams']) {
  if (new RegExp('^export const ' + name + '\\b', 'm').test(page)) fail('page must not export ' + name)
}

// ٣ — ناتج البناء
const manifestText = read(MANIFEST)
if (manifestText !== '') {
  let manifest = null
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    fail('prerender-manifest.json is not valid JSON')
  }
  const entry = manifest && manifest.dynamicRoutes ? manifest.dynamicRoutes[ROUTE] : undefined
  if (entry === undefined) fail(ROUTE + ' is not in prerender-manifest dynamicRoutes (route is Dynamic, not ISR)')
  else console.log('PRODUCT_ISR_MANIFEST ' + JSON.stringify(entry))
}

// ٤ — لوج البناء
const logIndex = process.argv.indexOf('--build-log')
const logPath = logIndex === -1 ? '' : process.argv[logIndex + 1] || ''
if (logPath === '') {
  fail('--build-log <file> is required')
} else {
  const lines = read(logPath)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((line) => line.includes(' ' + ROUTE))
  if (lines.length === 0) fail('no ' + ROUTE + ' line in the build log')
  for (const line of lines) {
    console.log('PRODUCT_ISR_BUILD_LINE ' + line.trim())
    if (line.includes('ƒ')) fail('build log marks ' + ROUTE + ' as Dynamic (ƒ)')
    if (!line.includes('●')) fail('build log line for ' + ROUTE + ' has no ● (SSG/ISR) marker')
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error('PRODUCT_ISR_STRUCTURE_FAIL ' + message)
  console.log('PRODUCT_ISR_STRUCTURE fail=' + String(failures.length))
  process.exit(1)
}
console.log('PRODUCT_ISR_STRUCTURE pass revalidate=' + String(pageRevalidate[0]))
