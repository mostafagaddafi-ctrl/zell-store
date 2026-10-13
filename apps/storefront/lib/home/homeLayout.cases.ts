/**
 * HOME-MOBILE — حالات القراية وقرارات العرض (pnpm --filter @zell/storefront cases، suite home).
 */

import { DEFAULT_STORE_CONTENT, heroMobileLayoutOf, parseHomeMobileLayout } from '@zell/core'
import { MOBILE_IMAGE_PLACEHOLDER, homeMobileView } from './homeLayout'

export type HomeCaseFailure = { name: string; expected: string; actual: string }

const failures: HomeCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const hero = (mobileLayout?: unknown) =>
  mobileLayout === undefined ? { key: 'hero', visible: true, sortOrder: 1 } : { key: 'hero', visible: true, sortOrder: 1, mobileLayout }

export function runHomeLayoutCases(): { passed: number; failures: HomeCaseFailure[] } {
  // القراية
  check('R01 missing field = compact', heroMobileLayoutOf([hero(), { key: 'products', visible: true, sortOrder: 2 }]), 'compact')
  check('R02 invalid values = compact', [heroMobileLayoutOf([hero('FULL')]), heroMobileLayoutOf([hero(5)]), heroMobileLayoutOf([hero(null)]), heroMobileLayoutOf([hero('')])], [
    'compact',
    'compact',
    'compact',
    'compact',
  ])
  check('R03 compact', heroMobileLayoutOf([hero('compact')]), 'compact')
  check('R04 full', heroMobileLayoutOf([hero('full')]), 'full')
  check('R05 the field on another section has no effect', heroMobileLayoutOf([hero(), { key: 'products', visible: true, sortOrder: 2, mobileLayout: 'full' }]), 'compact')
  check('R06 sections missing / not a list = compact', [heroMobileLayoutOf(undefined), heroMobileLayoutOf({}), heroMobileLayoutOf([])], ['compact', 'compact', 'compact'])
  check('R07 order does not matter (products before hero)', heroMobileLayoutOf([{ key: 'products', visible: true, sortOrder: 1 }, { key: 'hero', visible: true, sortOrder: 2, mobileLayout: 'full' }]), 'full')
  check('R08 parse: only the two values', [parseHomeMobileLayout('compact'), parseHomeMobileLayout('full'), parseHomeMobileLayout(undefined)], ['compact', 'full', 'compact'])
  check('R09 defaults / fallback content = compact', DEFAULT_STORE_CONTENT.heroMobileLayout, 'compact')

  // العرض
  const compact = homeMobileView('compact')
  const full = homeMobileView('full')
  check('V01 compact: mobile nav on top, no title, below sm only', [compact.mobileTopNav, compact.mobileTopNavClassName], [true, 'border-b border-border pb-3 pt-4 sm:hidden'])
  check('V02 compact: the in-loop copy is hidden below sm, shown from sm (one visible copy at any size)', compact.loopNavClassName, 'hidden sm:block')
  check('V03 compact: hero compact + products padding changes below sm only', [compact.heroCompact, compact.productsClassName], [true, 'py-10 max-sm:pt-6 md:py-14'])
  check('V04 full: exactly as before (no top nav, in-loop copy everywhere, products py-10 md:py-14)', full, {
    mobileTopNav: false,
    mobileTopNavClassName: '',
    loopNavClassName: '',
    heroCompact: false,
    productsClassName: 'py-10 md:py-14',
  })
  check('V05 the mobile image placeholder is an inline data URI (no network request, not an empty src)', MOBILE_IMAGE_PLACEHOLDER.startsWith('data:image/'), true)

  return { passed, failures }
}
