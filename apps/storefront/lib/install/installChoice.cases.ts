/**
 * حالات «هتركّبه إزاي؟» في صفحة المنتج: سطر الاختيار الحالي، وظهور الأدوات بعد التغيير من «فني» لـ «بنفسي».
 * منطق خالص بيتشغّل فعلًا في CI (pnpm --filter @zell/storefront cases، suite install).
 */

import type { InstallMode } from '../cart'
import { installerRequiredFor, orderRequiresInstaller, parseInstallationConfig } from '@zell/core'
import {
  INSTALL_MODE_LABELS,
  currentInstallModeLine,
  installChoiceRequired,
  installerOnlyLine,
  revealToolsOnChange,
  showToolSuggestions,
} from './installChoice'

export type InstallCaseFailure = { name: string; expected: string; actual: string }

const failures: InstallCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/** حالة الصفحة بعد اختيار نهائي (الاختيار المحفوظ اتقري، والعميل اختار). */
function afterChoice(mode: InstallMode, addonCount: number) {
  return showToolSuggestions({ installer: mode === 'installer', choicePending: false, choiceRequired: mode === 'unset', addonCount })
}

export function runInstallChoiceCases(): { passed: number; failures: InstallCaseFailure[] } {
  // سطر الاختيار الحالي
  check('L01 not chosen yet (unset): no line', currentInstallModeLine('unset'), null)
  check(
    'L02 chosen before = self: the current value, for the whole order, changeable here',
    currentInstallModeLine('self'),
    'اختيارك الحالي: «هركّبه بنفسي» — للطلب كله، وتقدر تغيّره من هنا.',
  )
  check(
    'L03 chosen before = installer: the current value, for the whole order, changeable here',
    currentInstallModeLine('installer'),
    'اختيارك الحالي: «محتاج فني تركيب» — للطلب كله، وتقدر تغيّره من هنا.',
  )
  check('L04 the line uses the same titles as the options', [INSTALL_MODE_LABELS.self, INSTALL_MODE_LABELS.installer], ['هركّبه بنفسي', 'محتاج فني تركيب'])

  // التغيير من «فني» لـ «بنفسي»: الأدوات بتظهر (السلوك الحالي)
  check('T01 installer -> self with tools: reveal + scroll, and the tools are shown', [revealToolsOnChange('installer', 'self', 3), afterChoice('self', 3)], [true, true])
  check('T02 installer -> self, the line follows the new value', [currentInstallModeLine('installer'), currentInstallModeLine('self')], [
    'اختيارك الحالي: «محتاج فني تركيب» — للطلب كله، وتقدر تغيّره من هنا.',
    'اختيارك الحالي: «هركّبه بنفسي» — للطلب كله، وتقدر تغيّره من هنا.',
  ])
  check('T03 installer -> self without tools: nothing to reveal or show', [revealToolsOnChange('installer', 'self', 0), afterChoice('self', 0)], [false, false])
  check('T04 self -> installer: no reveal, tools hidden with the installer', [revealToolsOnChange('self', 'installer', 3), afterChoice('installer', 3)], [false, false])
  check('T05 self -> self (same choice): no reveal', revealToolsOnChange('self', 'self', 3), false)
  check('T06 first choice self (unset -> self): reveal like today', revealToolsOnChange('unset', 'self', 2), true)
  check('T07 tools hidden while the saved choice is loading or not chosen yet', [
    showToolSuggestions({ installer: false, choicePending: true, choiceRequired: false, addonCount: 3 }),
    showToolSuggestions({ installer: false, choicePending: false, choiceRequired: true, addonCount: 3 }),
  ], [false, false])

  // INSTALLER-ONLY (قرار المالك 2026-11-05): «فني فقط» لكل المنتجات أو لمنتجات معينة
  const ready = (extra: Record<string, unknown>) =>
    parseInstallationConfig({ enabled: true, feePerMeterPiastres: 1000, areas: { 'القاهرة': { 'مدينة نصر': 0 } }, ...extra })
  check('I01 old setting without mode = the customer chooses (nothing changes)', [ready({}).mode, ready({}).installerOnlyProductIds, installerRequiredFor(ready({}), 5)], ['choice', [], false])
  check(
    'I02 bad mode or bad ids are ignored',
    [ready({ mode: 'x' }).mode, ready({ mode: 'installer_products', installerOnlyProductIds: [5, 5, -1, 2.5, '7', 9] }).installerOnlyProductIds],
    ['choice', [5, 9]],
  )
  check('I03 installer_all: every film', [installerRequiredFor(ready({ mode: 'installer_all' }), 5), installerRequiredFor(ready({ mode: 'installer_all' }), 6)], [true, true])
  check(
    'I04 installer_products: only the listed films',
    [
      installerRequiredFor(ready({ mode: 'installer_products', installerOnlyProductIds: [5] }), 5),
      installerRequiredFor(ready({ mode: 'installer_products', installerOnlyProductIds: [5] }), 6),
    ],
    [true, false],
  )
  check(
    'I05 service off, no fee, or no area: never installer-only',
    [
      installerRequiredFor(ready({ mode: 'installer_all', enabled: false }), 5),
      installerRequiredFor(ready({ mode: 'installer_all', feePerMeterPiastres: null }), 5),
      installerRequiredFor(ready({ mode: 'installer_all', areas: {} }), 5),
    ],
    [false, false, false],
  )
  check(
    'I06 order: one installer-only film = the whole order; pieces never count',
    [
      orderRequiresInstaller(ready({ mode: 'installer_products', installerOnlyProductIds: [5] }), [{ id: 6 }, { id: 5 }]),
      orderRequiresInstaller(ready({ mode: 'installer_products', installerOnlyProductIds: [5] }), [{ id: 6 }]),
      orderRequiresInstaller(ready({ mode: 'installer_all' }), [{ id: 7, sale_unit: 'piece' }]),
    ],
    [true, false, false],
  )
  check(
    'I07 choice required: unset always; installer-only until the installer is picked',
    [
      installChoiceRequired({ showChoice: true, ready: true, mode: 'unset', installerOnly: false }),
      installChoiceRequired({ showChoice: true, ready: true, mode: 'self', installerOnly: false }),
      installChoiceRequired({ showChoice: true, ready: true, mode: 'self', installerOnly: true }),
      installChoiceRequired({ showChoice: true, ready: true, mode: 'installer', installerOnly: true }),
      installChoiceRequired({ showChoice: true, ready: false, mode: 'unset', installerOnly: true }),
      installChoiceRequired({ showChoice: false, ready: true, mode: 'unset', installerOnly: false }),
    ],
    [true, false, true, false, false, false],
  )
  check('I08 installer-only lines', [installerOnlyLine('product'), installerOnlyLine('cart')], ['المنتج ده بيتركّب مع فني تركيب بس.', 'طلبك فيه منتج بيتركّب مع فني تركيب بس.'])

  return { passed, failures }
}
