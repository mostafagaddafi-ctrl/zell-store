/**
 * حالات «هتركّبه إزاي؟» في صفحة المنتج: سطر الاختيار الحالي، وظهور الأدوات بعد التغيير من «فني» لـ «بنفسي».
 * منطق خالص بيتشغّل فعلًا في CI (pnpm --filter @zell/storefront cases، suite install).
 */

import type { ChosenInstallMode, InstallMode } from '../cart'
import { installerRequiredFor, orderRequiresInstaller, parseInstallationConfig } from '@zell/core'
import {
  INSTALL_MODE_LABELS,
  currentInstallModeLine,
  installChoiceRequired,
  installModeAfterLinesChange,
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

/**
 * INSTALL-RESET — نفس خطوات الـ effect في CartProvider: أول خطوة = أول تشغيل بعد الجاهزية (previous = null)،
 * والعدد السابق بيتحدّث بعد كل انتقال. choose = اختيار العميل بعد الانتقال (setInstallMode).
 */
type CartStep = { count: number; choose?: ChosenInstallMode }
function modesAfter(stored: InstallMode, steps: CartStep[]): InstallMode[] {
  let previous: number | null = null
  let mode = stored
  const modes: InstallMode[] = []
  for (const step of steps) {
    mode = installModeAfterLinesChange(previous, step.count, mode)
    previous = step.count
    if (step.choose !== undefined) mode = step.choose
    modes.push(mode)
  }
  return modes
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
  check('I08 installer-only lines', [installerOnlyLine('product'), installerOnlyLine('cart')], ['المنتج ده متاح بفني.', 'طلبك فيه منتج بيتركّب مع فني تركيب بس.'])

  // INSTALL-RESET (docs/contracts/INSTALL-RESET.md): السلة تفضى بالشيل → unset زي clear()، وغير كده الاختيار زي ما هو
  check(
    'R01 non-empty -> empty (last line removed): self / installer / unset all become unset',
    [installModeAfterLinesChange(3, 0, 'self'), installModeAfterLinesChange(1, 0, 'installer'), installModeAfterLinesChange(2, 0, 'unset')],
    ['unset', 'unset', 'unset'],
  )
  check(
    'R02 non-empty -> non-empty (part removed, or same count): unchanged',
    [installModeAfterLinesChange(3, 2, 'self'), installModeAfterLinesChange(2, 1, 'installer'), installModeAfterLinesChange(2, 2, 'installer')],
    ['self', 'installer', 'installer'],
  )
  check(
    'R03 empty -> empty (choice made on the product page before the first add): unchanged',
    [installModeAfterLinesChange(0, 0, 'installer'), installModeAfterLinesChange(0, 0, 'self')],
    ['installer', 'self'],
  )
  check(
    'R04 empty -> non-empty (first add): unchanged',
    [installModeAfterLinesChange(0, 1, 'installer'), installModeAfterLinesChange(0, 2, 'self'), installModeAfterLinesChange(0, 1, 'unset')],
    ['installer', 'self', 'unset'],
  )
  check(
    'R05 first run after ready (previous = null) seeds the restored count without a reset, even with an empty restored cart',
    [installModeAfterLinesChange(null, 0, 'installer'), installModeAfterLinesChange(null, 0, 'self'), installModeAfterLinesChange(null, 2, 'self')],
    ['installer', 'self', 'self'],
  )
  check(
    'R06 load an old saved choice with an empty cart: stays (out of scope, contract §6 item 1) until a removal empties the cart',
    modesAfter('installer', [{ count: 0 }, { count: 1 }, { count: 0 }]),
    ['installer', 'installer', 'unset'],
  )
  check(
    'R07 repeated add/remove cycles: the previous count is updated after every transition',
    modesAfter('unset', [
      { count: 0, choose: 'installer' },
      { count: 1 },
      { count: 0 },
      { count: 1, choose: 'self' },
      { count: 2 },
      { count: 1 },
      { count: 0 },
      { count: 1 },
    ]),
    ['installer', 'installer', 'unset', 'self', 'self', 'self', 'unset', 'unset'],
  )
  check(
    'R08 batched removals in one event (3 lines -> 0 seen once after the batch): unset',
    modesAfter('self', [{ count: 3 }, { count: 0 }]),
    ['self', 'unset'],
  )

  return { passed, failures }
}
