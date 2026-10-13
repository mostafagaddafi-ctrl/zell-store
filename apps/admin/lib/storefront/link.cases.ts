/**
 * رابط المتجر في اللوحة — حالات الفحص والرابط الاحتياطي (pnpm --filter @zell/admin cases، suite storefront-link).
 */

import { STOREFRONT_LINK_FALLBACK, resolveStorefrontLink } from './link'

export type StorefrontLinkCaseFailure = { name: string; expected: string; actual: string }

const failures: StorefrontLinkCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const fallback = { href: STOREFRONT_LINK_FALLBACK, source: 'fallback' }
const fromEnv = (href: string) => ({ href, source: 'env' })

export function runStorefrontLinkCases(): { passed: number; failures: StorefrontLinkCaseFailure[] } {
  // من الإعداد
  check('L01 valid url + matching host = the configured store', resolveStorefrontLink('https://zellnow.me', 'zellnow.me'), fromEnv('https://zellnow.me'))
  check('L02 trailing slash, spaces and letter case are normalized', resolveStorefrontLink('  https://ZellNow.me/  ', ' ZELLNOW.ME '), fromEnv('https://zellnow.me'))
  check('L03 any shop domain works when the host matches (reusable)', resolveStorefrontLink('https://shop.example.com', 'shop.example.com'), fromEnv('https://shop.example.com'))

  // الرابط الاحتياطي
  check('L10 missing url = fallback', [resolveStorefrontLink(undefined, 'zellnow.me'), resolveStorefrontLink('   ', 'zellnow.me')], [fallback, fallback])
  check('L11 missing host = fallback', [resolveStorefrontLink('https://zellnow.me', undefined), resolveStorefrontLink('https://zellnow.me', '')], [fallback, fallback])
  check('L12 host mismatch = fallback', [resolveStorefrontLink('https://zellnow.me', 'admin.zellnow.me'), resolveStorefrontLink('https://evil.example', 'zellnow.me')], [fallback, fallback])
  check('L13 http = fallback', resolveStorefrontLink('http://zellnow.me', 'zellnow.me'), fallback)
  check('L14 credentials in the url = fallback', resolveStorefrontLink('https://user:pass@zellnow.me', 'zellnow.me'), fallback)
  check('L15 path, query or hash = fallback', [
    resolveStorefrontLink('https://zellnow.me/products', 'zellnow.me'),
    resolveStorefrontLink('https://zellnow.me/?x=1', 'zellnow.me'),
    resolveStorefrontLink('https://zellnow.me/#top', 'zellnow.me'),
  ], [fallback, fallback, fallback])
  check('L16 not a url / javascript: / protocol-relative = fallback', [
    resolveStorefrontLink('zellnow.me', 'zellnow.me'),
    resolveStorefrontLink('javascript:alert(1)', 'zellnow.me'),
    resolveStorefrontLink('//zellnow.me', 'zellnow.me'),
  ], [fallback, fallback, fallback])
  check('L17 the fallback itself passes the same check', resolveStorefrontLink(STOREFRONT_LINK_FALLBACK, 'zell-store-nine.vercel.app'), fromEnv(STOREFRONT_LINK_FALLBACK))

  return { passed, failures }
}
