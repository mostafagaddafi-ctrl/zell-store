/**
 * HOME-MOBILE — حالات اللوحة: القراية · التحقق · الحفظ والقراية مايضيّعوش الحقل (pnpm --filter @zell/admin cases، suite home).
 */

import { HOME_MOBILE_MESSAGES, HOME_MOBILE_OPTIONS, checkSectionMobileLayout, readHeroMobileLayout } from './homeMobile'

export type HomeCaseFailure = { name: string; expected: string; actual: string }

const failures: HomeCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

export function runHomeMobileCases(): { passed: number; failures: HomeCaseFailure[] } {
  // القراية (readSections)
  check('A01 missing = compact', readHeroMobileLayout(undefined), 'compact')
  check('A02 invalid = compact', [readHeroMobileLayout('FULL'), readHeroMobileLayout(1), readHeroMobileLayout(null), readHeroMobileLayout('')], ['compact', 'compact', 'compact', 'compact'])
  check('A03 compact / full', [readHeroMobileLayout('compact'), readHeroMobileLayout('full')], ['compact', 'full'])

  // التحقق (validateSections)
  check('A10 hero: compact / full accepted', [checkSectionMobileLayout('hero', 'compact'), checkSectionMobileLayout('hero', 'full')], [
    { ok: true, value: 'compact' },
    { ok: true, value: 'full' },
  ])
  check('A11 hero: missing = saved as compact', checkSectionMobileLayout('hero', undefined), { ok: true, value: 'compact' })
  check('A12 hero: invalid value = refused', [checkSectionMobileLayout('hero', 'FULL'), checkSectionMobileLayout('hero', 3)], [
    { ok: false, message: HOME_MOBILE_MESSAGES.invalid },
    { ok: false, message: HOME_MOBILE_MESSAGES.invalid },
  ])
  check('A13 the field on another section = refused; missing = nothing written', [
    checkSectionMobileLayout('products', 'full'),
    checkSectionMobileLayout('faq', undefined),
  ], [
    { ok: false, message: HOME_MOBILE_MESSAGES.heroOnly },
    { ok: true, value: null },
  ])

  // الحفظ والقراية مايضيّعوش الحقل: القيمة المقروءة بتعدّي التحقق زي ما هي
  const roundTrip = (stored: unknown) => {
    const read = readHeroMobileLayout(stored)
    const checked = checkSectionMobileLayout('hero', read)
    return checked.ok ? checked.value : 'refused'
  }
  check('A20 read -> save keeps the value (full stays full, compact stays compact, missing becomes compact)', [roundTrip('full'), roundTrip('compact'), roundTrip(undefined)], ['full', 'compact', 'compact'])

  // اللوحة
  check('A30 the two options, compact first', HOME_MOBILE_OPTIONS.map((option) => option.value + ':' + option.label), [
    'compact:مختصر — الأقسام الأول',
    'full:كامل — العنوان والوصف والزرار',
  ])

  return { passed, failures }
}
