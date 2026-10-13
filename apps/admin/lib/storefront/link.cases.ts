/**
 * رابط المتجر في اللوحة — الحالتين: إعداد صحيح = رابط · إعداد ناقص/مش صالح/مش متطابق = مفيش رابط خالص
 * (اللينكين بيستخبوا والتنبيه بيظهر). pnpm --filter @zell/admin cases، suite storefront-link.
 */

import { STOREFRONT_LINK_NOT_SET, resolveStorefrontLink } from './link'

export type StorefrontLinkCaseFailure = { name: string; expected: string; actual: string }

const failures: StorefrontLinkCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const ok = (href: string) => ({ ok: true, href })
const no = (reason: string) => ({ ok: false, reason })

export function runStorefrontLinkCases(): { passed: number; failures: StorefrontLinkCaseFailure[] } {
  // الإعداد صحيح ومتطابق = الرابطين بيظهروا
  check('L01 valid url + matching host = link shown', resolveStorefrontLink('https://zellnow.me', 'zellnow.me'), ok('https://zellnow.me'))
  check('L02 trailing slash, spaces and letter case are normalized', resolveStorefrontLink('  https://ZellNow.me/  ', ' ZELLNOW.ME '), ok('https://zellnow.me'))
  check('L03 any shop domain works when the host matches (reusable)', resolveStorefrontLink('https://shop.example.com', 'shop.example.com'), ok('https://shop.example.com'))

  // الإعداد ناقص = مفيش رابط
  check('L10 missing url = no link', [resolveStorefrontLink(undefined, 'zellnow.me'), resolveStorefrontLink('   ', 'zellnow.me')], [no('missing'), no('missing')])
  check('L11 missing host = no link', [resolveStorefrontLink('https://zellnow.me', undefined), resolveStorefrontLink('https://zellnow.me', '')], [no('missing'), no('missing')])
  check('L12 both missing = no link', resolveStorefrontLink(undefined, undefined), no('missing'))

  // الإعداد مش صالح = مفيش رابط
  check('L13 http = no link', resolveStorefrontLink('http://zellnow.me', 'zellnow.me'), no('invalid'))
  check('L14 credentials in the url = no link', resolveStorefrontLink('https://user:pass@zellnow.me', 'zellnow.me'), no('invalid'))
  check('L15 path, query or hash = no link', [
    resolveStorefrontLink('https://zellnow.me/products', 'zellnow.me'),
    resolveStorefrontLink('https://zellnow.me/?x=1', 'zellnow.me'),
    resolveStorefrontLink('https://zellnow.me/#top', 'zellnow.me'),
  ], [no('invalid'), no('invalid'), no('invalid')])
  check('L16 not a url / javascript: / protocol-relative = no link', [
    resolveStorefrontLink('zellnow.me', 'zellnow.me'),
    resolveStorefrontLink('javascript:alert(1)', 'zellnow.me'),
    resolveStorefrontLink('//zellnow.me', 'zellnow.me'),
  ], [no('invalid'), no('invalid'), no('invalid')])

  // الإعداد مش متطابق = مفيش رابط
  check('L17 host mismatch = no link', [resolveStorefrontLink('https://zellnow.me', 'admin.zellnow.me'), resolveStorefrontLink('https://evil.example', 'zellnow.me')], [no('mismatch'), no('mismatch')])

  // مفيش رابط احتياطي، والتنبيه واضح
  check('L20 a failed result carries no link at all (no fallback store)', Object.keys(resolveStorefrontLink('', '')).sort(), ['ok', 'reason'])
  check('L21 the notice names both variables and the redeploy', [
    STOREFRONT_LINK_NOT_SET.includes('STOREFRONT_URL'),
    STOREFRONT_LINK_NOT_SET.includes('STOREFRONT_HOST'),
    STOREFRONT_LINK_NOT_SET.includes('Redeploy'),
  ], [true, true, true])

  return { passed, failures }
}
