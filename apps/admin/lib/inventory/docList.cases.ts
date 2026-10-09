/**
 * حالات قوايم مستندات المخزون (UI): التبويبات · البحث · الروابط · المصطلحات. منطق خالص.
 * بتتشغّل بـ: pnpm --filter @zell/admin cases  (suite = doclist)
 */

import {
  DOC_LIST_WIDE_PAGE_SIZE,
  DOC_SEARCH_MAX,
  DOC_TABS,
  DOC_TAB_LABELS,
  dayMonthYear,
  docListHref,
  docMatches,
  emptyListTitle,
  normalizeForSearch,
  parseDocQuery,
  parseDocTab,
  tabAllows,
  tabServerStatus,
  usesWidePage,
} from './docList'
import { DOC_STATUS_LABELS, FORBIDDEN_WORDS, INVENTORY_LOTS_HINT, INVENTORY_LOTS_TITLE, type InventoryDocStatus } from './labels'

export type DocListCaseFailure = { name: string; expected: string; actual: string }
export type DocListCasesReport = { passed: number; failures: DocListCaseFailure[] }

export function runDocListCases(): DocListCasesReport {
  const failures: DocListCaseFailure[] = []
  let passed = 0
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  // ── التبويبات ──
  check('tabs order', DOC_TABS, ['active', 'draft', 'posted', 'discarded', 'voided', 'all'])
  check('default tab = active', parseDocTab(undefined, undefined), 'active')
  check('bad tab -> active', parseDocTab('x', undefined), 'active')
  check('tab param', parseDocTab('voided', undefined), 'voided')
  check('tab param array', parseDocTab(['posted', 'draft'], undefined), 'posted')
  check('legacy ?status= still works', parseDocTab(undefined, 'discarded'), 'discarded')
  check('tab wins over legacy status', parseDocTab('all', 'draft'), 'all')
  check('server status for active = null', tabServerStatus('active'), null)
  check('server status for all = null', tabServerStatus('all'), null)
  check('server status for draft', tabServerStatus('draft'), 'draft')
  const statuses: InventoryDocStatus[] = ['draft', 'posted', 'discarded', 'voided']
  check('active hides discarded and voided', statuses.map((s) => tabAllows('active', s)), [true, true, false, false])
  check('all shows everything', statuses.map((s) => tabAllows('all', s)), [true, true, true, true])
  check('single tab shows its status only', statuses.map((s) => tabAllows('discarded', s)), [false, false, true, false])
  check('wide page for active', usesWidePage('active', ''), true)
  check('wide page for search', usesWidePage('posted', 'PUR'), true)
  check('normal page otherwise', usesWidePage('posted', ''), false)
  check('wide page = db max', DOC_LIST_WIDE_PAGE_SIZE, 100)

  // ── المصطلحات ──
  check('discarded label has no «مسودة»', DOC_STATUS_LABELS.discarded.includes('مسودة'), false)
  check('discarded label', DOC_STATUS_LABELS.discarded, 'مستبعَد')
  check('tab labels distinct', new Set(Object.values(DOC_TAB_LABELS)).size, DOC_TABS.length)
  check('lots title', INVENTORY_LOTS_TITLE, 'دفعات المخزون')
  check('lots hint', INVENTORY_LOTS_HINT, 'الرولات والكميات الناتجة من الشراء أو رصيد أول المدة')
  const texts = [...Object.values(DOC_TAB_LABELS), INVENTORY_LOTS_TITLE, INVENTORY_LOTS_HINT]
  check('no forbidden words', texts.filter((t) => FORBIDDEN_WORDS.some((w) => t.includes(w))), [])
  check('no «المتبقي» before 0021-ب', texts.filter((t) => t.includes('المتبقي') || t.includes('متبقي')), [])

  // ── البحث ──
  check('query trimmed and collapsed', parseDocQuery('  PUR   0001 '), 'PUR 0001')
  check('query capped', parseDocQuery('x'.repeat(100)).length, DOC_SEARCH_MAX)
  check('query not a string', parseDocQuery(42), '')
  check('normalize alef/yaa/taa/diacritics', normalizeForSearch('أَحمد إسلام آمنة مصطفى'), 'احمد اسلام امنه مصطفي')
  check('normalize arabic digits', normalizeForSearch('٢٠٢٦'), '2026')
  check('dd/mm/yyyy', dayMonthYear('2026-10-09'), '09/10/2026')
  const doc = { docNo: 'PUR-000123', supplierName: 'مؤسسة أحمد للزجاج', date: '2026-10-09' }
  check('empty query matches', docMatches('', doc), true)
  check('doc number part', docMatches('000123', doc), true)
  check('doc number case-insensitive', docMatches('pur-0001', doc), true)
  check('supplier normalized', docMatches('احمد', doc), true)
  check('supplier with diacritics in query', docMatches('أَحْمد', doc), true)
  check('iso date', docMatches('2026-10', doc), true)
  check('dd/mm date', docMatches('09/10', doc), true)
  check('arabic digits date', docMatches('٢٠٢٦-١٠', doc), true)
  check('no match', docMatches('XYZ', doc), false)
  check('null supplier ok', docMatches('احمد', { ...doc, supplierName: null }), false)

  // ── الروابط ──
  check('href default', docListHref('/inventory/purchases', { tab: 'active', query: '', beforeId: null }), '/inventory/purchases')
  check(
    'href full',
    docListHref('/inventory/purchases', { tab: 'posted', query: 'احمد', supplierId: 7, beforeId: 40 }),
    '/inventory/purchases?tab=posted&q=' + encodeURIComponent('احمد').replace(/%20/g, '+') + '&supplier=7&before=40',
  )
  check('href null supplier omitted', docListHref('/inventory/openings', { tab: 'all', query: '', supplierId: null, beforeId: null }), '/inventory/openings?tab=all')

  // ── الحالات الفاضية ──
  check('empty search title', emptyListTitle('purchase', 'active', 'abc'), 'مفيش نتايج للبحث «abc»')
  check('empty active purchase', emptyListTitle('purchase', 'active', ''), 'مفيش فواتير نشطة')
  check('empty voided opening', emptyListTitle('opening', 'voided', ''), 'مفيش مستندات بحالة «' + DOC_STATUS_LABELS.voided + '»')

  return { passed, failures }
}
