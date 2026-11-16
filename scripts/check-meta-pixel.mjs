/**
 * META-PIXEL §٤-٢ — فحص هيكلي بعد بناء المتجر والخانة فاضية (من غير شبكة).
 *
 *   node scripts/check-meta-pixel.mjs
 *
 * كل فحص بيطبع META_PIXEL_CHECK <id> pass|fail <تفاصيل>، والآخر META_PIXEL_CHECK_RESULT pass=<n> fail=<n>.
 * أي فشل = خروج بكود 1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SF = path.join(ROOT, 'apps', 'storefront')
const ADMIN = path.join(ROOT, 'apps', 'admin')

let pass = 0
let fail = 0
function report(id, ok, detail) {
  if (ok) pass += 1
  else fail += 1
  console.log('META_PIXEL_CHECK ' + id + ' ' + (ok ? 'pass' : 'fail') + (detail ? ' ' + detail : ''))
}

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, filter, out)
    else if (filter(full)) out.push(full)
  }
  return out
}
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/')
const isCode = (file) => /\.(ts|tsx|mjs|js)$/.test(file) && !/\.cases\.ts$/.test(file)
const sfCode = walk(SF, isCode).filter((file) => !rel(file).startsWith('apps/storefront/scripts/'))
const read = (file) => readFileSync(file, 'utf8')

// C01 — HTML المبني مسبقًا من غير سكربت ميتا (الخانة فاضية في البناء)
{
  const appOut = path.join(SF, '.next', 'server', 'app')
  const htmls = []
  const collect = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) collect(full)
      else if (name.endsWith('.html')) htmls.push(full)
    }
  }
  collect(appOut)
  const bad = htmls.filter((file) => /fbevents|connect\.facebook\.net/.test(read(file)))
  report('C01', htmls.length > 0 && bad.length === 0, 'html=' + htmls.length + ' with_meta=' + bad.map(rel).join(','))
}

// C02 — مفيش NEXT_PUBLIC_ لميتا
{
  const files = [...sfCode, path.join(SF, '.env.example')].filter((file) => existsSync(file))
  const bad = files.filter((file) => /NEXT_PUBLIC_[A-Z_]*(META|PIXEL|FB)/.test(read(file)))
  report('C02', bad.length === 0, bad.map(rel).join(','))
}

// C03 — fbq وسكربت ميتا وinit/set في أماكنهم بس
{
  const RUNTIME = 'apps/storefront/lib/analytics/pixelRuntime.ts'
  const COMPONENT = 'apps/storefront/components/analytics/MetaPixel.tsx'
  const sdk = sfCode.filter((file) => read(file).includes('connect.facebook.net')).map(rel)
  const init = sfCode.filter((file) => /['"]init['"]/.test(read(file))).map(rel)
  const set = sfCode.filter((file) => /['"]set['"],\s*['"]autoConfig['"]/.test(read(file))).map(rel)
  const fbq = sfCode.filter((file) => /\bfbq\s*\(/.test(read(file))).map(rel)
  const ok =
    sdk.length === 1 && sdk[0] === RUNTIME &&
    init.length === 1 && init[0] === RUNTIME &&
    set.length === 1 && set[0] === RUNTIME &&
    fbq.every((file) => file === RUNTIME || file === COMPONENT)
  report('C03', ok, 'sdk=' + sdk.join(',') + ' init=' + init.join(',') + ' set=' + set.join(',') + ' fbq=' + fbq.join(','))
}

// C04 — مفيش Link أو router.push/replace لمسار محجوب برّه PixelSafeLink وnavigateToReceipt
{
  const bad = []
  for (const file of sfCode) {
    const text = read(file)
    for (const match of text.matchAll(/<Link\b[^>]*>/gs)) {
      if (/href=(["'{]\s*['"]?\/(track|order)\b|\{\s*trackItem\.href|\{\s*TRACK_HREF|\{\s*TRACK_PAGE_HREF)/.test(match[0])) bad.push(rel(file) + ':Link')
    }
    if (/router\.(push|replace)\(\s*['"\x60]\/(track|order)\b/.test(text)) bad.push(rel(file) + ':router')
    if (/router\.(push|replace)\(\s*['"]\/order\/['"]\s*\+/.test(text)) bad.push(rel(file) + ':router+')
  }
  report('C04', bad.length === 0, bad.join(','))
}

// C05 — Purchase قبل navigateToReceipt ومن غير await
{
  const text = read(path.join(SF, 'components', 'store', 'CheckoutForm.tsx'))
  const purchase = text.indexOf("trackPixel('Purchase'")
  const nav = text.indexOf('navigateToReceipt(router')
  const lines = text.split('\n').filter((line) => line.includes("trackPixel('Purchase'") || line.includes('navigateToReceipt(router'))
  report('C05', purchase > 0 && nav > purchase && lines.every((line) => !/\bawait\b/.test(line)), 'purchase=' + purchase + ' nav=' + nav)
}

// C06 — كل page.tsx متصنّف: 9 أشكال مسموحة + محجوبين
{
  const ALLOWED = ['/', '/products', '/collections', '/cart', '/checkout', '/installation-tools', '/product/[productId]', '/collection/[slug]', '/policies/[key]']
  const BLOCKED = ['/order/[orderNumber]', '/track']
  const appDir = path.join(SF, 'app')
  const routes = walk(appDir, (file) => /[\\/]page\.tsx$/.test(file)).map((file) => {
    const dir = path.relative(appDir, path.dirname(file)).split(path.sep).join('/')
    return dir === '' ? '/' : '/' + dir
  })
  const known = new Set([...ALLOWED, ...BLOCKED])
  const extra = routes.filter((route) => !known.has(route))
  const missing = [...known].filter((route) => !routes.includes(route))
  report('C06', extra.length === 0 && missing.length === 0, 'extra=' + extra.join(',') + ' missing=' + missing.join(','))
}

// C07 — searchParams بس في /installation-tools
{
  const users = sfCode.filter((file) => /searchParams|useSearchParams/.test(read(file))).map(rel)
  const allowed = ['apps/storefront/app/installation-tools/page.tsx']
  report('C07', users.every((file) => allowed.includes(file)), users.join(','))
}

// C08 — الأجزاء الداخلية (#…) من القايمة بس
{
  const hashes = new Set()
  for (const file of sfCode) for (const match of read(file).matchAll(/href=\{?['"]#([^'"]*)['"]/g)) hashes.add(match[1])
  report('C08', [...hashes].every((hash) => hash === 'products'), [...hashes].join(','))
}

// C09 — مفيش متتبع تاني، ومفيش Pixel في اللوحة
{
  const adminCode = walk(ADMIN, isCode).filter((file) => !rel(file).startsWith('apps/admin/scripts/'))
  const trackers = [...sfCode, ...adminCode].filter((file) => /\bgtag\(|googletagmanager|\bttq\b|analytics\.tiktok/.test(read(file))).map(rel)
  const adminPixel = adminCode.filter((file) => /pixelBridge|fbevents|MetaPixelLoader|analytics\/MetaPixel/.test(read(file))).map(rel)
  report('C09', trackers.length === 0 && adminPixel.length === 0, 'trackers=' + trackers.join(',') + ' admin=' + adminPixel.join(','))
}

console.log('META_PIXEL_CHECK_RESULT pass=' + pass + ' fail=' + fail)
process.exitCode = fail > 0 || pass === 0 ? 1 : 0
