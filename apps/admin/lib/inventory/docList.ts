/**
 * قوايم مستندات المخزون (المشتريات ورصيد أول المدة) — منطق خالص: التبويبات والبحث والروابط.
 *
 *   • من غير SQL: التبويب اللي هو حالة واحدة بيتبعت للداتابيز زي قبل. «النشط» (مسودة + مرحّل) و«الكل» = من غير فلتر
 *     حالة، وبعدين الفلترة هنا. الافتراضي «النشط»، فالمستبعَد والمُبطَل مستخبيين لحد ما حد يختار تبويبهم.
 *   • البحث (رقم المستند · المورد · التاريخ) على الصفحة اللي اتقرت: لحد 100 مستند، الأحدث أولًا، و«الأقدم» للباقي.
 *   • التطبيع بيشيل التشكيل والتطويل، ويوحّد أ/إ/آ → ا و ى → ي و ة → ه، والأرقام العربية → إنجليزي.
 */

import { DOC_STATUS_LABELS, type InventoryDocStatus } from './labels'

export type DocTab = 'active' | InventoryDocStatus | 'all'

export const DOC_TABS: readonly DocTab[] = ['active', 'draft', 'posted', 'discarded', 'voided', 'all']

export const DOC_TAB_LABELS: Readonly<Record<DocTab, string>> = {
  active: 'النشط',
  draft: DOC_STATUS_LABELS.draft,
  posted: DOC_STATUS_LABELS.posted,
  discarded: DOC_STATUS_LABELS.discarded,
  voided: DOC_STATUS_LABELS.voided,
  all: 'الكل',
}

export const DOC_LIST_PAGE_SIZE = 25
/** حد الداتابيز للصفحة (list_* بترفض أكتر من 100). */
export const DOC_LIST_WIDE_PAGE_SIZE = 100
export const DOC_SEARCH_MAX = 60

const STATUSES: readonly InventoryDocStatus[] = ['draft', 'posted', 'discarded', 'voided']

function first(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw
}

function isStatus(value: unknown): value is InventoryDocStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/** التبويب من ?tab=، ولو مش موجود من ?status= القديم (روابط قبل التعديل)، والافتراضي «النشط». */
export function parseDocTab(rawTab: unknown, rawLegacyStatus: unknown): DocTab {
  const tab = first(rawTab)
  if (tab === 'active' || tab === 'all' || isStatus(tab)) return tab
  const legacy = first(rawLegacyStatus)
  if (isStatus(legacy)) return legacy
  return 'active'
}

/** الحالة اللي بتتبعت للداتابيز (null = من غير فلتر). */
export function tabServerStatus(tab: DocTab): InventoryDocStatus | null {
  return tab === 'active' || tab === 'all' ? null : tab
}

export function tabAllows(tab: DocTab, status: InventoryDocStatus): boolean {
  if (tab === 'all') return true
  if (tab === 'active') return status === 'draft' || status === 'posted'
  return status === tab
}

export function parseDocQuery(raw: unknown): string {
  const value = first(raw)
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, DOC_SEARCH_MAX)
}

export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, ' ')
    .trim()
}

/** YYYY-MM-DD → DD/MM/YYYY (علشان اللي بيكتب التاريخ بالشكل ده يلاقيه). */
export function dayMonthYear(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  return match ? match[3] + '/' + match[2] + '/' + match[1] : isoDate
}

export type DocSearchFields = { docNo: string; supplierName: string | null; date: string }

export function docMatches(query: string, doc: DocSearchFields): boolean {
  const needle = normalizeForSearch(query)
  if (needle === '') return true
  return [doc.docNo, doc.supplierName ?? '', doc.date, dayMonthYear(doc.date)]
    .map(normalizeForSearch)
    .some((haystack) => haystack.includes(needle))
}

/** «النشط» والبحث بيقروا صفحة أوسع (100) علشان الفلترة هنا ماتسيبش الصفحة فاضية. */
export function usesWidePage(tab: DocTab, query: string): boolean {
  return tab === 'active' || query !== ''
}

export type DocListState = { tab: DocTab; query: string; supplierId?: number | null; beforeId: number | null }

export function docListHref(base: string, state: DocListState): string {
  const params = new URLSearchParams()
  if (state.tab !== 'active') params.set('tab', state.tab)
  if (state.query !== '') params.set('q', state.query)
  if (state.supplierId !== undefined && state.supplierId !== null) params.set('supplier', String(state.supplierId))
  if (state.beforeId !== null) params.set('before', String(state.beforeId))
  const query = params.toString()
  return query === '' ? base : base + '?' + query
}

/** عنوان الحالة الفاضية حسب الحالة (بحث · تبويب). */
export function emptyListTitle(kind: 'purchase' | 'opening', tab: DocTab, query: string): string {
  const noun = kind === 'purchase' ? 'فواتير' : 'مستندات'
  if (query !== '') return 'مفيش نتايج للبحث «' + query + '»'
  if (tab === 'active') return 'مفيش ' + noun + ' نشطة'
  if (tab === 'all') return 'مفيش ' + noun + ' لسه'
  return 'مفيش ' + noun + ' بحالة «' + DOC_TAB_LABELS[tab] + '»'
}
