/**
 * EXPRESS-SHIPPING §١٢ — حالات علامة وفلتر نوع الشحن في قايمة الطلبات (منطق خالص — pnpm --filter @zell/admin cases،
 * suite list-filters).
 */

import {
  SHIPPING_TYPE_FILTERS,
  SHIPPING_TYPE_FILTER_LABELS,
  SHIPPING_TYPE_LABELS,
  nextOrdersQuery,
  orderShippingType,
  readShippingTypeFilter,
  shippingFilterFromQuery,
  shippingTypeQueryPart,
} from './listFilters'

export type ListFiltersCaseFailure = { name: string; expected: string; actual: string }

const failures: ListFiltersCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

function params(query: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, value] of new URLSearchParams(query)) out[key] = [...(out[key] ?? []), value]
  return out
}

export function runListFiltersCases(): { passed: number; failures: ListFiltersCaseFailure[] } {
  // ── العلامة من لقطة الطلب ──
  check('L01 badge from the order snapshot: express · standard · NULL · unknown · wrong case · non-string', [
    orderShippingType('express'),
    orderShippingType('standard'),
    orderShippingType(null),
    orderShippingType(undefined),
    orderShippingType('fast'),
    orderShippingType('Express'),
    orderShippingType(1),
  ], ['express', 'standard', null, null, null, null, null])

  // ── قيمة الرابط ──
  check('L02 URL value: only the fixed list; missing · empty · wrong · wrong case · repeated (array) -> all', [
    readShippingTypeFilter('express'),
    readShippingTypeFilter('standard'),
    readShippingTypeFilter('all'),
    readShippingTypeFilter(undefined),
    readShippingTypeFilter(''),
    readShippingTypeFilter('null'),
    readShippingTypeFilter('EXPRESS'),
    readShippingTypeFilter(' express'),
    readShippingTypeFilter(['express', 'standard']),
    readShippingTypeFilter(['express']),
  ], ['express', 'standard', 'all', 'all', 'all', 'all', 'all', 'all', 'all', 'all'])
  check('L03 value from the current query string: once = read · repeated = all · missing = all', [
    shippingFilterFromQuery('shipping=express'),
    shippingFilterFromQuery('status=new&shipping=standard'),
    shippingFilterFromQuery('shipping=express&shipping=express'),
    shippingFilterFromQuery('shipping=express&shipping=standard'),
    shippingFilterFromQuery('status=new'),
    shippingFilterFromQuery('shipping=eq.express'),
  ], ['express', 'standard', 'all', 'all', 'all', 'all'])

  // ── جزء الاستعلام (قبل العدد والصفحات) ──
  check('L04 query part from the fixed list only; all = none; NULL is never matched by express or standard', [
    shippingTypeQueryPart('express'),
    shippingTypeQueryPart('standard'),
    shippingTypeQueryPart('all'),
    shippingTypeQueryPart(undefined),
  ], ['shipping_method=eq.express', 'shipping_method=eq.standard', null, null])
  check('L05 raw URL values never reach the query', [
    shippingTypeQueryPart('express&status=eq.new'),
    shippingTypeQueryPart('is.null'),
    shippingTypeQueryPart('standard,shipping_method.is.null'),
    shippingTypeQueryPart(['express']),
  ], [null, null, null, null])

  // ── الرابط بعد تغيير فلتر ──
  check('L06 picking a shipping type keeps search, status and follow-up, drops page', params(nextOrdersQuery('search=FLM&status=new&page=3', 'FLM', { shipping: 'express' })), {
    search: ['FLM'], status: ['new'], shipping: ['express'],
  })
  check('L07 shipping type with the follow-up filter: both kept, page dropped', params(nextOrdersQuery('followup=today&page=2', '', { shipping: 'standard' })), {
    followup: ['today'], shipping: ['standard'],
  })
  check('L08 back to all removes the parameter and keeps the rest', params(nextOrdersQuery('status=shipped&shipping=express&page=4', '', { shipping: 'all' })), {
    status: ['shipped'],
  })
  check('L09 changing status keeps the shipping type (and the existing status/follow-up rule)', [
    params(nextOrdersQuery('followup=overdue&shipping=express&page=2', '', { status: 'confirmed' })),
    params(nextOrdersQuery('status=new&shipping=standard', '', { followUp: 'today' })),
  ], [
    { shipping: ['express'], status: ['confirmed'] },
    { shipping: ['standard'], followup: ['today'] },
  ])
  check('L10 search submit keeps the shipping type, trims the text, drops page', params(nextOrdersQuery('shipping=express&page=5', '  010  ', {})), {
    shipping: ['express'], search: ['010'],
  })
  check('L11 an unknown or repeated shipping value in the URL is not carried forward', [
    params(nextOrdersQuery('shipping=fast&page=2', '', { status: 'new' })),
    params(nextOrdersQuery('shipping=express&shipping=standard', '', {})),
  ], [{ status: ['new'] }, {}])
  check('L12 existing rules unchanged without a shipping type: empty search removed, follow-up clears status', [
    nextOrdersQuery('search=x&page=2', '   ', {}),
    params(nextOrdersQuery('status=new', '', { followUp: 'overdue' })),
  ], ['', { followup: ['overdue'] }])

  // ── النصوص ──
  check('L13 fixed formal labels and the filter list', [SHIPPING_TYPE_LABELS, SHIPPING_TYPE_FILTER_LABELS.all, SHIPPING_TYPE_FILTERS], [
    { express: 'شحن سريع', standard: 'شحن عادي' },
    'كل أنواع الشحن',
    ['all', 'express', 'standard'],
  ])
  return { passed, failures }
}
