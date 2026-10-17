/**
 * POLICY-PAGES — حالات صفحات السياسات (منطق خالص — pnpm --filter @zell/storefront cases، suite policies). العقد §٧.
 * المنطق نفسه في @zell/core (المتجر واللوحة الاتنين): قراية المتجر · قراية المحرر · تحقق الحفظ · تقسيم النص · الـ sitemap.
 * حالات التحقق هنا لأن مشغّل حالات اللوحة مابيحمّلش @zell/core (استيراد الأنواع بس).
 */

import {
  DEFAULT_POLICY_DRAFTS as DRAFTS,
  NO_PUBLISHED_POLICIES,
  POLICY_KEYS,
  buildPolicyPages,
  isPolicyKey,
  parsePublishedPolicies,
  policyBodyIssue,
  policyCompanyRows,
  policyPath,
  publishedPolicyKeys,
  readPolicyDrafts,
  samePolicyPages,
  splitPolicyBody,
  type PolicyPages,
} from '@zell/core'
import { formatPolicyDate } from './policyView'

export type PolicyCaseFailure = { name: string; expected: string; actual: string }

const failures: PolicyCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const NOW = '2026-10-17T10:00:00.000Z'
const LATER = '2026-10-18T09:30:00.000Z'
const okPage = (over: Record<string, unknown> = {}) => ({ enabled: true, title: 'عنوان', body: '- بند', updatedAt: NOW, ...over })
const rawWith = (key: string, page: unknown, company: unknown = {}) => ({ company, pages: { [key]: page } })
const published = (raw: unknown) => Object.keys(parsePublishedPolicies(raw).pages)
const input = (over: Partial<Record<string, Record<string, unknown>>> = {}, company: Record<string, unknown> = {}) => ({
  company: { name: '', address: '', commercialRegister: '', taxNumber: '', ...company },
  pages: Object.fromEntries(
    POLICY_KEYS.map((key) => [key, { enabled: false, title: DRAFTS[key].title, body: DRAFTS[key].body, ...(over[key] ?? {}) }]),
  ),
})

export function runPolicyCases(): { passed: number; failures: PolicyCaseFailure[] } {
  // ── المفاتيح والمسارات ──
  check('K01 four fixed keys', POLICY_KEYS, ['terms', 'shipping', 'returns', 'privacy'])
  check('K02 isPolicyKey', [isPolicyKey('terms'), isPolicyKey('privacy'), isPolicyKey('about'), isPolicyKey(''), isPolicyKey(3)], [true, true, false, false, false])
  check('K03 path', policyPath('returns'), '/policies/returns')

  // ── قراية المتجر: مقفولة افتراضيًا ──
  check('R01 missing / null / array / string = all closed', [published(undefined), published(null), published([]), published('x')], [[], [], [], []])
  check('R02 pages missing or not object = all closed', [published({ company: {} }), published({ pages: [] }), published({ pages: 'x' })], [[], [], []])
  check('R03 page missing or not object = closed', [published({ pages: {} }), published(rawWith('terms', null)), published(rawWith('terms', []))], [[], [], []])
  check('R04 enabled must be true exactly', [
    published(rawWith('terms', okPage({ enabled: false }))),
    published(rawWith('terms', okPage({ enabled: 'true' }))),
    published(rawWith('terms', okPage({ enabled: 1 }))),
    published(rawWith('terms', okPage({ enabled: undefined }))),
    published(rawWith('terms', okPage())),
  ], [[], [], [], [], ['terms']])
  check('R05 unknown key ignored', published(rawWith('about', okPage())), [])

  // ── مركّبة: enabled true مع نص أو عنوان فاسد = مقفولة من غير محتوى ──
  const long = 'ا'.repeat(8001)
  const manyLines = Array.from({ length: 301 }, () => 'سطر').join('\n')
  check('C01 enabled + body missing / not string / empty / spaces / too long / too many lines = closed', [
    published(rawWith('privacy', okPage({ body: undefined }))),
    published(rawWith('privacy', okPage({ body: 5 }))),
    published(rawWith('privacy', okPage({ body: '' }))),
    published(rawWith('privacy', okPage({ body: '  \n \n ' }))),
    published(rawWith('privacy', okPage({ body: long }))),
    published(rawWith('privacy', okPage({ body: manyLines }))),
  ], [[], [], [], [], [], []])
  check('C02 enabled + title missing / not string / empty / spaces / longer than 80 = closed', [
    published(rawWith('returns', okPage({ title: undefined }))),
    published(rawWith('returns', okPage({ title: ['x'] }))),
    published(rawWith('returns', okPage({ title: '' }))),
    published(rawWith('returns', okPage({ title: '   ' }))),
    published(rawWith('returns', okPage({ title: 'ع'.repeat(81) }))),
  ], [[], [], [], [], []])
  check('C03 limits exactly: title 80 · body 8000 · 300 lines = published', [
    published(rawWith('terms', okPage({ title: 'ع'.repeat(80) }))),
    published(rawWith('terms', okPage({ body: 'ا'.repeat(8000) }))),
    published(rawWith('terms', okPage({ body: Array.from({ length: 300 }, () => 'سطر').join('\n') }))),
  ], [['terms'], ['terms'], ['terms']])
  const closedPage = parsePublishedPolicies(rawWith('privacy', okPage({ body: '' })))
  check('C04 closed page carries no content at all', JSON.stringify(closedPage).includes('عنوان'), false)
  check('C05 bad page does not close the others', Object.keys(parsePublishedPolicies({ pages: { terms: okPage(), privacy: okPage({ title: '' }), shipping: okPage() } }).pages), ['terms', 'shipping'])
  check('C06 published values trimmed, CRLF normalized', parsePublishedPolicies(rawWith('terms', okPage({ title: '  ع  ', body: '\r\n- أ\r\n- ب\r\n' }))).pages.terms, {
    key: 'terms', title: 'ع', body: '- أ\n- ب', updatedAt: NOW,
  })
  check('C07 updatedAt invalid = published without date', [
    parsePublishedPolicies(rawWith('terms', okPage({ updatedAt: 'x' }))).pages.terms?.updatedAt,
    parsePublishedPolicies(rawWith('terms', okPage({ updatedAt: 5 }))).pages.terms?.updatedAt,
  ], [null, null])
  check('C08 no default text in the store', published({ pages: { terms: { enabled: true } } }), [])

  // ── بيانات البائع ──
  const company = parsePublishedPolicies({ pages: {}, company: { name: ' شركة ', address: 5, commercialRegister: 'س'.repeat(201), taxNumber: '١٢٣' } }).company
  check('B01 bad seller field hidden alone', company, { name: 'شركة', address: '', commercialRegister: '', taxNumber: '١٢٣' })
  check('B02 seller rows filled only, fixed order', policyCompanyRows(company), [
    { label: 'اسم الشركة', value: 'شركة' },
    { label: 'رقم التسجيل الضريبي', value: '١٢٣' },
  ])
  check('B03 empty seller = no rows', policyCompanyRows(NO_PUBLISHED_POLICIES.company), [])

  // ── sitemap ──
  check('S01 sitemap keys = published only, fixed order', publishedPolicyKeys(parsePublishedPolicies({ pages: { privacy: okPage(), terms: okPage(), returns: okPage({ enabled: false }) } })), ['terms', 'privacy'])
  check('S02 nothing published = empty', publishedPolicyKeys(NO_PUBLISHED_POLICIES), [])

  // ── النص ──
  check('T01 paragraphs and lists', splitPolicyBody('مقدمة\nسطر تاني\n\n- أ\n- ب\nخاتمة'), [
    { kind: 'paragraph', text: 'مقدمة\nسطر تاني' },
    { kind: 'list', items: ['أ', 'ب'] },
    { kind: 'paragraph', text: 'خاتمة' },
  ])
  check('T02 blank line splits lists · "-" alone is text', splitPolicyBody('- أ\n\n- ب\n-\n'), [
    { kind: 'list', items: ['أ'] },
    { kind: 'list', items: ['ب'] },
    { kind: 'paragraph', text: '-' },
  ])
  check('T03 markup stays plain text', splitPolicyBody('<b>x</b> **y**'), [{ kind: 'paragraph', text: '<b>x</b> **y**' }])
  check('T04 body issues', [policyBodyIssue(3), policyBodyIssue(''), policyBodyIssue('ا'.repeat(8001)), policyBodyIssue(manyLines), policyBodyIssue('- أ')], ['type', 'empty', 'long', 'lines', null])

  // ── المحرر: الافتراضي بداية بس والمفتاح مقفول ──
  const fresh = readPolicyDrafts(undefined, DRAFTS)
  check('E01 no row = drafts, all closed, no dates', POLICY_KEYS.map((key) => [fresh.pages[key].enabled, fresh.pages[key].title === DRAFTS[key].title, fresh.pages[key].body === DRAFTS[key].body, fresh.pages[key].updatedAt]), POLICY_KEYS.map(() => [false, true, true, null]))
  const broken = readPolicyDrafts(rawWith('terms', okPage({ body: long })), DRAFTS)
  check('E02 enabled + bad body = draft body, switch off', [broken.pages.terms.enabled, broken.pages.terms.body === DRAFTS.terms.body, broken.pages.terms.title], [false, true, 'عنوان'])
  const kept = readPolicyDrafts(rawWith('shipping', okPage({ enabled: false, body: '' })), DRAFTS)
  check('E03 stored empty body kept (closed)', [kept.pages.shipping.body, kept.pages.shipping.enabled], ['', false])
  check('E04 valid stored page read as is', readPolicyDrafts(rawWith('terms', okPage()), DRAFTS).pages.terms, okPage())

  // ── تحقق الحفظ ──
  const first = buildPolicyPages(input({ terms: { enabled: true } }, { name: 'شركة' }), null, NOW)
  check('V01 first save: all pages dated now', first.ok ? POLICY_KEYS.map((key) => first.value.pages[key].updatedAt) : first, POLICY_KEYS.map(() => NOW))
  const stored = first.ok ? first.value : (null as unknown as PolicyPages)
  const onlyShipping = buildPolicyPages(input({ terms: { enabled: true }, shipping: { title: 'الشحن' } }, { name: 'شركة' }), stored, LATER)
  check('V02 only the changed page gets a new date', onlyShipping.ok ? POLICY_KEYS.map((key) => onlyShipping.value.pages[key].updatedAt) : onlyShipping, [NOW, LATER, NOW, NOW])
  const sellerOnly = buildPolicyPages(input({ terms: { enabled: true } }, { name: 'شركة أخرى' }), stored, LATER)
  check('V03 seller change dates terms only', sellerOnly.ok ? POLICY_KEYS.map((key) => sellerOnly.value.pages[key].updatedAt) : sellerOnly, [LATER, NOW, NOW, NOW])
  const same = buildPolicyPages(input({ terms: { enabled: true, title: '  ' + DRAFTS.terms.title + ' ' } }, { name: ' شركة ' }), stored, LATER)
  check('V04 trimming only = no change, same value', same.ok ? samePolicyPages(same.value, stored) : same, true)
  const fail = (raw: unknown) => {
    const result = buildPolicyPages(raw, null, NOW)
    return result.ok ? 'OK' : result.message
  }
  check('V05 enabling with empty body rejected', fail(input({ privacy: { enabled: true, body: '  ' } })), 'لا يمكن إظهار صفحة «سياسة الخصوصية» بنص فارغ.')
  check('V06 disabled page may have empty body', fail(input({ privacy: { body: '' } })), 'OK')
  check('V07 limits', [
    fail(input({ terms: { title: '' } })),
    fail(input({ terms: { title: 'ع'.repeat(81) } })),
    fail(input({ returns: { body: long } })),
    fail(input({ returns: { body: manyLines } })),
    fail(input({}, { address: 'ع'.repeat(201) })),
  ], [
    'اكتب عنوان صفحة «الشروط والأحكام».',
    'عنوان صفحة «الشروط والأحكام» أطول من 80 حرفًا.',
    'نص صفحة «الاستبدال والاسترجاع» أطول من 8000 حرف.',
    'نص صفحة «الاستبدال والاسترجاع» أكثر من 300 سطر.',
    'حقل «العنوان» أطول من 200 حرف.',
  ])
  check('V08 types', [
    fail(null),
    fail({ pages: {} }),
    fail(input({ shipping: { enabled: 'yes' } })),
    fail(input({ shipping: { body: 7 } })),
    fail({ ...input(), pages: { ...input().pages, terms: undefined } }),
  ], [
    'البيانات غير صحيحة.',
    'البيانات غير صحيحة.',
    'مفتاح إظهار صفحة «الشحن والتوصيل» غير صحيح.',
    'نص صفحة «الشحن والتوصيل» غير صحيح.',
    'بيانات صفحة «الشروط والأحكام» غير صحيحة.',
  ])
  check('V09 saved value publishes exactly the enabled pages', first.ok ? Object.keys(parsePublishedPolicies(first.value).pages) : first, ['terms'])
  check('V10 save ignores extra fields and incoming dates', (() => {
    const result = buildPolicyPages({ ...input(), extra: 1, pages: { ...input().pages, terms: { ...input().pages['terms'], updatedAt: 'x', html: '<b>' } } }, null, NOW)
    return result.ok ? Object.keys(result.value).concat(Object.keys(result.value.pages.terms)) : result
  })(), ['company', 'pages', 'enabled', 'title', 'body', 'updatedAt'])

  // ── النص الافتراضي المعتمد ──
  check('D01 drafts valid for publishing (titles · bodies)', POLICY_KEYS.map((key) => [DRAFTS[key].title.length > 0, policyBodyIssue(DRAFTS[key].body)]), POLICY_KEYS.map(() => [true, null]))
  check('D02 drafts have no open markers', POLICY_KEYS.some((key) => /[⟦⟧]|\*\*/.test(DRAFTS[key].body)), false)

  // ── التاريخ ──
  check('F01 date formatted · invalid = null', [typeof formatPolicyDate(NOW) === 'string' && (formatPolicyDate(NOW) ?? '') !== '', formatPolicyDate(null), formatPolicyDate('x')], [true, null, null])

  return { passed, failures }
}
