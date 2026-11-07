#!/usr/bin/env node
// backend/db/ci/call_contract.selftest.mjs — self-test for the name-map parser in call_contract.mjs. No dependency, no
// database: writes a small apps/ tree to a temp dir per case, runs the real script on it, and checks the exit code, the
// function names in the generated SQL and the output. Runs in the build job on every PR (the SQL jobs run
// call_contract.mjs only when their path filters match).
// Result line: ZELL_CALL_CONTRACT_SELFTEST_RESULT pass=<n> fail=<n>; exit 1 on any failure or if nothing ran.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'call_contract.mjs')
const POLICY = { excluded_paths: [], exceptions: [], forbidden: [] }

function run(source, args = [], policyObj = POLICY) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zell-call-contract-selftest-'))
  try {
    const file = path.join(root, 'apps', 'a', 'lib', 'x.ts')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    const policy = path.join(root, 'policy.json')
    fs.writeFileSync(policy, JSON.stringify(policyObj))
    const sql = path.join(root, 'out.sql')
    let code = 0
    let out = ''
    try {
      out = execFileSync(process.execPath, [script, '--root', root, '--policy', policy, '--sql', sql, ...args], { encoding: 'utf8' })
    } catch (e) {
      code = typeof e.status === 'number' ? e.status : 1
      out = String(e.stdout || '')
    }
    const text = fs.existsSync(sql) ? fs.readFileSync(sql, 'utf8') : ''
    const names = [...text.matchAll(/', '((?:zell|erp)_[a-z0-9_]+)', /g)].map((m) => m[1])
    return { code, out, names }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const LATER_SOURCE = "export async function a() { return supabase.rpc('zell_a', {}) }\nexport async function b() { return supabase.rpc('zell_b', {}) }\n"
const LATER_POLICY = { ...POLICY, later: [{ migration: 'm1.sql', names: ['zell_a'] }, { migration: 'm2.sql', names: ['zell_b'] }] }

const CASES = [
  {
    name: 'multi-line map: every entry is checked (comments with commas, trailing comma, as const)',
    source: [
      'export const FNS = {',
      "  a: 'zell_a', // comment, with a comma",
      "  /* block, with a comma */ b: 'zell_b',",
      "  c: 'erp_c',",
      '} as const',
      "export const TEXT = { hello: 'hi, there', x: 'y' }",
      'export async function go(fn: keyof typeof FNS) { return supabase.rpc(FNS[fn], { p_x: 1 }) }',
      '',
    ].join('\n'),
    code: 0,
    names: 'zell_a,zell_b,erp_c',
    out: /^MAP FNS apps\/a\/lib\/x\.ts:1 names=3$/m,
  },
  {
    name: 'one-line map: both names are checked',
    source: "export const ONE = { a: 'zell_a', b: 'zell_b' }\nexport async function go(fn: 'a') { return supabase.rpc(ONE[fn], {}) }\n",
    code: 0,
    names: 'zell_a,zell_b',
    out: /^MAP ONE apps\/a\/lib\/x\.ts:1 names=2$/m,
  },
  {
    name: 'map with a non-literal value = MAP_UNPARSED (fails)',
    source: "const v = 'q'\nexport const BAD = { a: 'zell_a', b: v }\n",
    code: 1,
    names: '',
    out: /^MAP_UNPARSED apps\/a\/lib\/x\.ts:2 BAD$/m,
  },
  {
    name: 'map with a name outside zell_/erp_ = MAP_UNPARSED (fails)',
    source: "export const MIX = { a: 'zell_a', b: 'other_b' }\n",
    code: 1,
    names: '',
    out: /^MAP_UNPARSED apps\/a\/lib\/x\.ts:1 MIX$/m,
  },
  {
    name: 'text object without zell_/erp_ values is not a map',
    source: "export const TEXT = { a: 'hello', b: 'x, y' }\n",
    code: 0,
    names: '',
    out: /"maps":\[\]/,
  },
  // later (IMAGE-DELETE C1): --later skip = كل later · --later skip:<migration> = الـ migration دي بس · migration مش معروفة = فشل
  {
    name: 'later default (check): every later name is checked',
    source: LATER_SOURCE,
    policy: LATER_POLICY,
    code: 0,
    names: 'zell_a,zell_b',
    out: /"checks":2/,
  },
  {
    name: 'later skip: every later name is skipped',
    source: LATER_SOURCE,
    policy: LATER_POLICY,
    args: ['--later', 'skip'],
    code: 0,
    names: '',
    out: /^LATER apps\/a\/lib\/x\.ts:2 zell_b \(m2\.sql\)$/m,
  },
  {
    name: 'later skip:m2.sql: only that migration is skipped, the other is checked',
    source: LATER_SOURCE,
    policy: LATER_POLICY,
    args: ['--later', 'skip:m2.sql'],
    code: 0,
    names: 'zell_a',
    out: /^LATER apps\/a\/lib\/x\.ts:2 zell_b \(m2\.sql\)$/m,
  },
  {
    name: 'later skip:<unknown migration> = LATER_UNKNOWN (fails), nothing skipped',
    source: LATER_SOURCE,
    policy: LATER_POLICY,
    args: ['--later', 'skip:m9.sql'],
    code: 1,
    names: 'zell_a,zell_b',
    out: /^LATER_UNKNOWN m9\.sql$/m,
  },
]

let pass = 0
let fail = 0
for (const c of CASES) {
  const r = run(c.source, c.args || [], c.policy || POLICY)
  const problems = []
  if (r.code !== c.code) problems.push('exit ' + r.code + ' (expected ' + c.code + ')')
  if (r.names.join(',') !== c.names) problems.push('names [' + r.names.join(',') + '] (expected [' + c.names + '])')
  if (!c.out.test(r.out)) problems.push('output does not match ' + c.out)
  if (problems.length === 0) {
    pass++
    console.log('SELFTEST PASS ' + c.name)
  } else {
    fail++
    console.log('SELFTEST FAIL ' + c.name + ' :: ' + problems.join(' · '))
    console.log(r.out)
  }
}
console.log('ZELL_CALL_CONTRACT_SELFTEST_RESULT pass=' + pass + ' fail=' + fail)
process.exitCode = fail > 0 || pass === 0 ? 1 : 0
