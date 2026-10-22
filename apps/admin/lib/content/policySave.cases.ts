/**
 * POLICY-PAGES — حالات حفظ «السياسات» في اللوحة (منطق خالص — pnpm --filter @zell/admin cases، suite policy-save).
 *
 * B1 (مراجعة #166–#169): الحالات بتشغّل savePolicyPagesWith، وهي نفس الدالة اللي savePolicyPages
 * (lib/mutations/policyPages.ts) بتنده عليها، بعمليات نقل محقونة بتسجّل كل نداء ومعاملاته وبترجع نتايج متحكَّم فيها.
 *
 * حدود الإثبات:
 * - بتثبت إن حفظ السياسات بيكتب جدول settings بالمفتاح policy_pages بس، وإن الكتابة المحمية بتبعت للحارس
 *   patchGuarded النسخة المتوقعة بالحرف والقيمة بس، وإن الحفظ بيتعامل صح مع نتيجة الحارس (CONFLICT · NOT_FOUND)
 *   من غير إعادة كتابة ولا محاولة غير محمية، ومع الإنشاء المتزامن، ومع اختلاف قراءة التأكيد، ومساري النجاح.
 * - مابتثبتش صحة خوارزمية patchGuarded نفسها (المقارنة بالميلي ثانية · الـ PATCH المشروط · السباق بين قراية النسخة
 *   والـ PATCH): البديل هنا بيسجّل المعاملات ويرجع النتيجة المطلوبة بس، من غير نسخ خوارزميته. ده اختبار مستقل
 *   للحارس المشترك.
 * - مفيش REST حقيقي ولا داتابيز. buildPolicyPages وsamePolicyPages وtimestamp هنا بدايل متحكَّم فيها
 *   (تحقق السياسات نفسه في suite policies في المتجر).
 */

import type { PolicyBuildResult, PolicyPages } from '@zell/core'
import type { MutationResult } from '../mutations'
import type { GuardFailure } from '../mutations/concurrency'
import { savePolicyPagesWith, type PolicyGuardedPatch, type PolicyPagesRead, type PolicySaveDeps } from './policySave'

export type PolicySaveCaseFailure = { name: string; expected: string; actual: string }

const failures: PolicySaveCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const KEY = 'policy_pages'
const NOW = '2026-10-17T05:00:00.000Z'
const LABEL = 'طابع آخر تعديل'
const CONFLICT_TEXT = 'CONFLICT_TEXT'
const INTERNAL: MutationResult<never> = { ok: false, code: 'INTERNAL', message: 'INTERNAL_TEXT' }
// نفس شكل updated_at من Postgres (ميكروثانية + المنطقة)، علشان أي تطبيع للنسخة المتوقعة يبان
const EXPECTED = '2026-10-17T04:11:51.123456+00:00'
const RAW = { from: 'editor' }

function pagesTitled(title: string): PolicyPages {
  const page = { enabled: false, title, body: 'نص', updatedAt: null }
  return {
    company: { name: '', address: '', commercialRegister: '', taxNumber: '' },
    pages: { terms: { ...page }, shipping: { ...page }, returns: { ...page }, privacy: { ...page } },
  }
}

const DRAFTS = pagesTitled('افتراضي')
const OLD = pagesTitled('قديم')
const NEW = pagesTitled('جديد')
const SAVED = pagesTitled('كما خُزّن')
const OTHER = pagesTitled('حفظ تاني')

const NO_ROW: PolicyPagesRead = { pages: DRAFTS, updatedAt: null, stored: null }
const ROW_OLD: PolicyPagesRead = { pages: OLD, updatedAt: EXPECTED, stored: OLD }
const ROW_SAVED: PolicyPagesRead = { pages: SAVED, updatedAt: '2026-10-17T05:00:00.654321+00:00', stored: SAVED }
const ROW_OTHER: PolicyPagesRead = { pages: OTHER, updatedAt: '2026-10-17T05:00:01.000001+00:00', stored: OTHER }

const GUARD_CONFLICT: GuardFailure = { ok: false, code: 'CONFLICT', message: 'GUARD_CONFLICT' }
const GUARD_NOT_FOUND: GuardFailure = { ok: false, code: 'NOT_FOUND', message: 'GUARD_NOT_FOUND' }

/** نص الحالة: نتيجة كل قراية بالترتيب، ونتايج متحكَّم فيها للتحقق والحارس والإضافة. */
type Script = {
  reads: Array<PolicyPagesRead | Error>
  build?: PolicyBuildResult
  same?: boolean
  insertError?: Error
  guard?: { ok: true } | GuardFailure
  guardError?: Error
}

type Harness = {
  deps: PolicySaveDeps
  log: string[]
  builds: Array<{ raw: unknown; stored: PolicyPages | null; nowIso: string }>
  stamps: Array<{ value: unknown; label: string }>
  inserts: Array<{ table: string; row: { key: string; value: PolicyPages } }>
  patches: PolicyGuardedPatch[]
  sames: Array<{ a: PolicyPages; b: PolicyPages }>
  internals: unknown[]
}

function harness(script: Script): Harness {
  const log: string[] = []
  const builds: Harness['builds'] = []
  const stamps: Harness['stamps'] = []
  const inserts: Harness['inserts'] = []
  const patches: Harness['patches'] = []
  const sames: Harness['sames'] = []
  const internals: unknown[] = []
  let readIndex = 0

  const deps: PolicySaveDeps = {
    key: KEY,
    read: async () => {
      log.push('read')
      const next = script.reads[readIndex]
      readIndex += 1
      if (next === undefined) throw new Error('قراية مش متوقعة')
      if (next instanceof Error) throw next
      return next
    },
    insert: async (table, row) => {
      log.push('insert')
      inserts.push({ table, row })
      if (script.insertError !== undefined) throw script.insertError
      return []
    },
    patchGuarded: async (args) => {
      log.push('patchGuarded')
      patches.push(args)
      if (script.guardError !== undefined) throw script.guardError
      return script.guard ?? { ok: true }
    },
    build: (raw, stored, nowIso) => {
      log.push('build')
      builds.push({ raw, stored, nowIso })
      return script.build ?? { ok: true, value: NEW }
    },
    same: (a, b) => {
      log.push('same')
      sames.push({ a, b })
      return script.same ?? true
    },
    timestamp: (value, label) => {
      log.push('timestamp')
      stamps.push({ value, label })
      return typeof value === 'string' && value !== ''
        ? { ok: true, value }
        : { ok: false, code: 'VALIDATION', message: 'STAMP_INVALID' }
    },
    internalFailure: (error) => {
      log.push('internal')
      internals.push(error)
      return INTERNAL
    },
    conflictMessage: CONFLICT_TEXT,
    now: () => NOW,
  }

  return { deps, log, builds, stamps, inserts, patches, sames, internals }
}

const GUARDED_WRITE = {
  table: 'settings',
  idColumn: 'key',
  idValue: KEY,
  expectedUpdatedAt: EXPECTED,
  changes: { value: NEW },
  select: 'key',
}

export async function runPolicySaveCases(): Promise<{ passed: number; failures: PolicySaveCaseFailure[] }> {
  {
    const h = harness({ reads: [ROW_OLD, ROW_SAVED] })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S01 update success: result = the confirmed stored pages and updatedAt', result, {
      ok: true,
      data: { pages: SAVED, updatedAt: ROW_SAVED.updatedAt },
    })
    check('S01 update success: order read → build → timestamp → patchGuarded → confirm read → compare', h.log, [
      'read',
      'build',
      'timestamp',
      'patchGuarded',
      'read',
      'same',
    ])
    check('S01 build gets raw as-is, stored from the first read, and now', h.builds, [{ raw: RAW, stored: OLD, nowIso: NOW }])
    check('S01 expected version goes to timestamp verbatim with its label', h.stamps, [{ value: EXPECTED, label: LABEL }])
    check('S01 one guarded write: settings · key = policy_pages · expected version verbatim · value · select key', h.patches, [
      GUARDED_WRITE,
    ])
    check('S01 guarded write changes exactly one field (value)', h.patches.map((p) => Object.keys(p.changes)), [['value']])
    check('S01 no insert', h.inserts, [])
    check('S01 confirmation compares the stored pages with the saved value', h.sames, [{ a: SAVED, b: NEW }])
  }

  {
    const h = harness({ reads: [NO_ROW, ROW_SAVED] })
    const result = await savePolicyPagesWith(h.deps, RAW, null)
    check('S02 create success: result = the confirmed stored pages and updatedAt', result, {
      ok: true,
      data: { pages: SAVED, updatedAt: ROW_SAVED.updatedAt },
    })
    check('S02 create success: order read → build → insert → confirm read → compare', h.log, [
      'read',
      'build',
      'insert',
      'read',
      'same',
    ])
    check('S02 build gets stored = null when there is no row', h.builds, [{ raw: RAW, stored: null, nowIso: NOW }])
    check('S02 one insert: settings · { key: policy_pages, value }', h.inserts, [
      { table: 'settings', row: { key: KEY, value: NEW } },
    ])
    check('S02 inserted row has exactly key and value', h.inserts.map((i) => Object.keys(i.row)), [['key', 'value']])
    check('S02 no guarded write and no version check', [h.patches, h.stamps], [[], []])
  }

  {
    const h = harness({ reads: [ROW_OLD], guard: GUARD_CONFLICT })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S03 stale version: the guard CONFLICT is returned as-is', result, GUARD_CONFLICT)
    check('S03 stale version: one guarded write, then stop (no retry · no insert · no confirm read)', h.log, [
      'read',
      'build',
      'timestamp',
      'patchGuarded',
    ])
    check('S03 stale version: the guarded write carried the expected version verbatim', h.patches, [GUARDED_WRITE])
    check('S03 stale version: no unguarded write', h.inserts, [])
  }

  {
    const h = harness({ reads: [ROW_OLD], guard: GUARD_NOT_FOUND })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S04 row gone: the guard NOT_FOUND is returned as-is', result, GUARD_NOT_FOUND)
    check('S04 row gone: no fallback insert and no second write', [h.log, h.inserts.length, h.patches.length], [
      ['read', 'build', 'timestamp', 'patchGuarded'],
      0,
      1,
    ])
  }

  {
    const h = harness({ reads: [NO_ROW, ROW_OTHER], insertError: new Error('duplicate key') })
    const result = await savePolicyPagesWith(h.deps, RAW, null)
    check('S05 concurrent create: insert failed and a row exists now = CONFLICT', result, {
      ok: false,
      code: 'CONFLICT',
      message: CONFLICT_TEXT,
    })
    check('S05 concurrent create: one insert, a re-read, then stop (no guarded write · no second insert)', h.log, [
      'read',
      'build',
      'insert',
      'read',
    ])
    check('S05 concurrent create: nothing written over the other row', [h.inserts.length, h.patches.length], [1, 0])
  }

  {
    const insertError = new Error('network')
    const h = harness({ reads: [NO_ROW, NO_ROW], insertError })
    const result = await savePolicyPagesWith(h.deps, RAW, null)
    check('S06 insert failed and still no row = INTERNAL', result, INTERNAL)
    check('S06 insert failed: no retry', h.log, ['read', 'build', 'insert', 'read', 'internal'])
    check('S06 insert failed: the original error goes to internalFailure', h.internals[0] === insertError, true)
  }

  {
    const h = harness({ reads: [ROW_OLD, ROW_OTHER], same: false })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S07 update: confirmation read differs = failure, not success', result, INTERNAL)
    check('S07 update: compare then fail', h.log, ['read', 'build', 'timestamp', 'patchGuarded', 'read', 'same', 'internal'])
    check('S07 update: compared the other stored pages with the saved value', h.sames, [{ a: OTHER, b: NEW }])
  }

  {
    const h = harness({ reads: [NO_ROW, ROW_OTHER], same: false })
    const result = await savePolicyPagesWith(h.deps, RAW, null)
    check('S08 create: confirmation read differs = failure, not success', result, INTERNAL)
    check('S08 create: compare then fail', h.log, ['read', 'build', 'insert', 'read', 'same', 'internal'])
  }

  {
    const h = harness({ reads: [NO_ROW, NO_ROW] })
    const result = await savePolicyPagesWith(h.deps, RAW, null)
    check('S09 create: confirmation read finds no row = failure', result, INTERNAL)
    check('S09 create: no row means no compare', h.log, ['read', 'build', 'insert', 'read', 'internal'])
  }

  {
    const readError = new Error('network')
    const h = harness({ reads: [ROW_OLD, readError] })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S10 confirmation read throws = failure', result, INTERNAL)
    check('S10 confirmation read throws: the error goes to internalFailure', [h.log, h.internals[0] === readError], [
      ['read', 'build', 'timestamp', 'patchGuarded', 'read', 'internal'],
      true,
    ])
  }

  {
    const guardError = new Error('network')
    const h = harness({ reads: [ROW_OLD], guardError })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S11 guard throws = failure with no retry and no unguarded write', [result, h.log, h.inserts.length], [
      INTERNAL,
      ['read', 'build', 'timestamp', 'patchGuarded', 'internal'],
      0,
    ])
  }

  {
    const h = harness({ reads: [ROW_OLD] })
    const result = await savePolicyPagesWith(h.deps, RAW, '')
    check('S12 invalid expected version = the timestamp failure, nothing written', [result, h.log, h.patches, h.inserts], [
      { ok: false, code: 'VALIDATION', message: 'STAMP_INVALID' },
      ['read', 'build', 'timestamp'],
      [],
      [],
    ])
  }

  {
    const h = harness({ reads: [ROW_OLD] })
    const result = await savePolicyPagesWith(h.deps, RAW, undefined)
    check('S13 only an explicit null creates: undefined goes to the version check, no insert', [result, h.stamps, h.inserts], [
      { ok: false, code: 'VALIDATION', message: 'STAMP_INVALID' },
      [{ value: undefined, label: LABEL }],
      [],
    ])
  }

  {
    const invalid: PolicyBuildResult = { ok: false, code: 'VALIDATION', message: 'BUILD_INVALID' }
    const h = harness({ reads: [ROW_OLD], build: invalid })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S14 validation failure is returned as-is, before any version check or write', [result, h.log], [
      invalid,
      ['read', 'build'],
    ])
  }

  {
    const h = harness({ reads: [new Error('network')] })
    const result = await savePolicyPagesWith(h.deps, RAW, EXPECTED)
    check('S15 first read throws = failure, before validation or any write', [result, h.log], [INTERNAL, ['read', 'internal']])
  }

  return { passed, failures }
}
