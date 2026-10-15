/**
 * TRACK-ORDER v2 W2-A — حالات الـ Server Action بنداءات وهمية (suite track، بتتجمّع من trackOrder.cases.ts).
 * العقد: docs/contracts/TRACK-ORDER-v2.md §١٧-١: الكود الغلط مابيناديش الداتابيز · الرد بيتنقّى قبل المتصفح ·
 * فشل واتساب مابيحوّلش الطلب الموجود لـ «مش موجود».
 */

import { TRACK_NOT_FOUND_MESSAGE } from './trackOrder'
import { runTrackLookup, type TrackLookupDeps, type TrackLookupResult } from './trackLookup'
import { sampleResponse } from './trackOrder.fixtures'

type Failure = { name: string; expected: string; actual: string }

const failures: Failure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

type Probe = { deps: TrackLookupDeps; lookups: string[]; whatsappCalls: number; logs: string[] }

function probe(
  answer: (orderNumber: string) => Promise<TrackLookupResult>,
  whatsapp: () => Promise<{ number: string; message: string }> = async () => ({ number: '201234567890', message: 'مرحبًا' }),
): Probe {
  const p: Probe = {
    lookups: [],
    whatsappCalls: 0,
    logs: [],
    deps: {
      lookup: async (orderNumber) => {
        p.lookups.push(orderNumber)
        return answer(orderNumber)
      },
      loadWhatsapp: async () => {
        p.whatsappCalls += 1
        return whatsapp()
      },
      log: (line) => {
        p.logs.push(line)
      },
    },
  }
  return p
}

const NOT_FOUND = { status: 'not_found', message: TRACK_NOT_FOUND_MESSAGE }
const found = async (): Promise<TrackLookupResult> => ({ ok: true, data: sampleResponse() })

export async function runTrackLookupCases(): Promise<{ passed: number; failures: Failure[] }> {
  const bad = probe(found)
  const badResults = [
    await runTrackLookup('MRFVB', bad.deps),
    await runTrackLookup('FLM-MRFVB0', bad.deps),
    await runTrackLookup(null, bad.deps),
    await runTrackLookup(12345, bad.deps),
    await runTrackLookup(' '.repeat(50), bad.deps),
  ]
  check('L01 invalid / missing / non-string code -> not found, and the database and WhatsApp are never called',
    [badResults, bad.lookups.length, bad.whatsappCalls], [new Array(5).fill(NOT_FOUND), 0, 0])

  const ok = probe(found)
  const okResult = await runTrackLookup(' flm mrfvb3 ', ok.deps)
  check('L02 the normalized number is what reaches the lookup, then WhatsApp is read once',
    [ok.lookups, ok.whatsappCalls, okResult.status], [['FLM-MRFVB3'], 1, 'found'])
  check('L03 found: WhatsApp link built from the settings with the order number',
    okResult.status === 'found' ? okResult.whatsappHref : null,
    'https://wa.me/201234567890?text=' + encodeURIComponent('مرحبًا\nرقم الطلب: FLM-MRFVB3'))

  const dirty = probe(async () => ({
    ok: true,
    data: sampleResponse({
      internal_notes: 'SECRET',
      idempotency_key: 'SECRET',
      customer: { name: 'n', phone: 'p', address: 'a', governorate: 'g', area: null, notes: 'SECRET' },
      updates: [{ id: 9, at: '2026-10-13T12:00:00+00:00', text: 'وصل', edited: false, hidden: true, created_by: 'SECRET' }],
    }),
  }))
  const dirtyResult = await runTrackLookup('FLM-MRFVB3', dirty.deps)
  check('L04 the response is cleaned before the browser: no unknown key anywhere', [
    dirtyResult.status,
    dirtyResult.status === 'found' ? JSON.stringify(dirtyResult).includes('SECRET') : null,
    dirtyResult.status === 'found' ? Object.keys(dirtyResult).sort() : null,
  ], ['found', false, ['order', 'status', 'whatsappHref']])

  const empty = probe(async () => ({ ok: true, data: null }))
  const failed = probe(async () => ({ ok: false, status: 503 }))
  const thrown = probe(async () => {
    throw new TypeError('network')
  })
  const other = probe(async () => ({ ok: true, data: sampleResponse({ order_number: 'FLM-ABCDEF' }) }))
  const shaped = probe(async () => ({ ok: true, data: { order_number: 'FLM-MRFVB3' } }))
  check('L05 – L09 null · RPC failure · thrown · another order · unexpected shape -> the same not found, no WhatsApp read', [
    await runTrackLookup('FLM-MRFVB3', empty.deps),
    await runTrackLookup('FLM-MRFVB3', failed.deps),
    await runTrackLookup('FLM-MRFVB3', thrown.deps),
    await runTrackLookup('FLM-MRFVB3', other.deps),
    await runTrackLookup('FLM-MRFVB3', shaped.deps),
    [empty, failed, thrown, other, shaped].map((p) => p.whatsappCalls),
  ], [NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, [0, 0, 0, 0, 0]])
  check('L10 logs carry error names / status only (never the code or customer data)', [failed.logs, thrown.logs, other.logs],
    [['[track] lookup failed :: status 503'], ['[track] rpc threw :: TypeError'], ['[track] unexpected projection shape']])

  const waDown = probe(found, async () => {
    throw new Error('settings down')
  })
  const waDownResult = await runTrackLookup('FLM-MRFVB3', waDown.deps)
  const waBad = probe(found, async () => ({ number: '2010-000-000', message: 'x' }))
  const waBadResult = await runTrackLookup('FLM-MRFVB3', waBad.deps)
  const waEmpty = probe(found, async () => ({ number: '', message: '' }))
  const waEmptyResult = await runTrackLookup('FLM-MRFVB3', waEmpty.deps)
  check('L11 WhatsApp settings failure / bad number / no number: the order is still found, only the button is hidden', [
    waDownResult.status, waDownResult.status === 'found' ? waDownResult.whatsappHref : 'x', waDown.logs,
    waBadResult.status, waBadResult.status === 'found' ? waBadResult.whatsappHref : 'x',
    waEmptyResult.status, waEmptyResult.status === 'found' ? waEmptyResult.whatsappHref : 'x',
  ], ['found', null, ['[track] whatsapp settings unavailable :: Error'], 'found', null, 'found', null])

  return { passed, failures }
}
