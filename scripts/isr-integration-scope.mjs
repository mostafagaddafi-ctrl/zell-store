#!/usr/bin/env node
/**
 * PRODUCT-ISR §٧ (docs/contracts/PRODUCT-ISR.md) — نطاق تشغيل job اختبار التكامل (storefront-isr-integration) في CI.
 *
 *   node scripts/isr-integration-scope.mjs --selftest
 *   node scripts/isr-integration-scope.mjs --event <github.event_name> [--base <pull_request.base.sha>]
 *
 * • workflow_dispatch → run=true · push (main) → run=true دايمًا · أي حدث تاني → run=true (fail-open).
 * • pull_request → run=true لو أي «ملف اتلمس» جوه النطاق (§٧-٢)، وغير كده run=false.
 *   «ملف اتلمس» = إضافة · تعديل · حذف · تغيير نوع · وطرفي أي نقل أو إعادة تسمية (القديم والجديد).
 * • جمع الفرق جوه السكربت: git -c core.quotepath=false diff --no-renames --name-only -z <base>...HEAD
 *   (من نقطة التفرّع؛ الـ checkout بـ fetch-depth: 0). الفرق مقدرش يتقري أو طلع فاضي → run=true (fail-open).
 * • --selftest: حالات ثابتة (§٧-٤) + ريبو git مؤقت بيختبر دالة الجمع نفسها (حذف · نقل في الاتجاهين · تلات ضوابط
 *   إعادة التسمية · range مش موجود). أي حالة فاشلة = خروج بكود 1.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** §٧-٢ — مدخلات الاختبار. */
const SCOPE_PREFIXES = ['apps/storefront/', 'packages/']
const SCOPE_FILES = [
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  '.github/workflows/ci.yml',
  'scripts/isr-integration-scope.mjs',
]

function inScope(file) {
  return SCOPE_FILES.includes(file) || SCOPE_PREFIXES.some((prefix) => file.startsWith(prefix))
}

/** كل المسارات اللي اتلمست في الـ range، أو null لو الفرق مقدرش يتقري. */
function collectChangedPaths(range, cwd) {
  if (typeof range !== 'string' || range === '') return null
  const result = spawnSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-renames', '--name-only', '-z', range], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return null
  return result.stdout.toString('utf8').split('\0').filter((entry) => entry !== '')
}

function decide(event, paths) {
  if (event === 'workflow_dispatch') return { run: true, reason: 'workflow_dispatch', matched: [] }
  if (event === 'push') return { run: true, reason: 'push to main (always)', matched: [] }
  if (event !== 'pull_request') return { run: true, reason: 'unknown event (fail-open): ' + String(event), matched: [] }
  if (paths === null) return { run: true, reason: 'diff unreadable (fail-open)', matched: [] }
  if (paths.length === 0) return { run: true, reason: 'empty diff (fail-open)', matched: [] }
  const matched = paths.filter(inScope)
  if (matched.length > 0) return { run: true, reason: 'touches what the test covers', matched }
  return { run: false, reason: 'no touched path is in scope', matched: [] }
}

// ── selftest ──
function selftest() {
  const failures = []
  let passed = 0
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push(name + ': expected ' + e + ', got ' + a)
  }
  const run = (event, paths) => decide(event, paths).run

  // §٧-٤ — حالات ثابتة على قايمة المسارات
  check('S01 docs only', run('pull_request', ['docs/contracts/PRODUCT-ISR.md', 'README.md']), false)
  check('S02 apps/admin only', run('pull_request', ['apps/admin/lib/actions.ts', 'apps/admin/package.json']), false)
  check('S03 backend/db only', run('pull_request', ['backend/db/migrations/0028_x.sql']), false)
  check('S04 a file in apps/storefront', run('pull_request', ['apps/storefront/lib/cart.tsx']), true)
  check('S05 packages/core', run('pull_request', ['packages/core/src/pricing.ts']), true)
  check('S06 pnpm-lock.yaml', run('pull_request', ['pnpm-lock.yaml']), true)
  check('S07 root package.json', run('pull_request', ['package.json']), true)
  check('S08 ci.yml', run('pull_request', ['.github/workflows/ci.yml']), true)
  check('S09 docs + a storefront file', run('pull_request', ['docs/maps/code-map.md', 'apps/storefront/app/layout.tsx']), true)
  check('S10 push', run('push', ['docs/x.md']), true)
  check('S11 workflow_dispatch', run('workflow_dispatch', null), true)
  check('S12 empty list (fail-open)', run('pull_request', []), true)
  check('S13 unreadable list (fail-open)', run('pull_request', null), true)
  check('S14 deletion of an in-scope file', run('pull_request', ['apps/storefront/lib/data/queries.ts']), true)
  check(
    'S15 move in -> out (both ends)',
    run('pull_request', ['apps/storefront/scripts/isr-integration/source.mjs', 'scripts/isr-source.mjs']),
    true,
  )
  check('S16 move out -> in (both ends)', run('pull_request', ['docs/note.md', 'apps/storefront/notes/note.md']), true)
  check('S17 move out -> out (both ends)', run('pull_request', ['docs/a.md', 'docs/b.md']), false)
  check('S18 pnpm-workspace.yaml and tsconfig.base.json', [run('pull_request', ['pnpm-workspace.yaml']), run('pull_request', ['tsconfig.base.json'])], [true, true])
  check('S19 the scope script itself', run('pull_request', ['scripts/isr-integration-scope.mjs']), true)
  check('S20 other root scripts are out of scope', run('pull_request', ['scripts/check-security-headers.mjs']), false)

  // §٧-٤ — دالة الجمع نفسها على ريبو git مؤقت (مش الريبو الحقيقي)
  const root = mkdtempSync(path.join(tmpdir(), 'isr-scope-selftest-'))
  const git = (args) => {
    const result = spawnSync(
      'git',
      ['-c', 'core.quotepath=false', '-c', 'user.name=isr-scope-selftest', '-c', 'user.email=isr-scope-selftest@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { cwd: root, encoding: 'utf8' },
    )
    if (result.error || result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + String(result.stderr || result.error))
    return result.stdout
  }
  const write = (rel, text) => {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  const body = (label) => Array.from({ length: 40 }, (_, i) => label + ' line ' + String(i)).join('\n') + '\n'
  const sorted = (list) => (list === null ? null : [...list].sort())

  try {
    git(['init', '-q'])
    write('apps/storefront/scripts/isr-integration/source.mjs', body('source'))
    write('apps/storefront/lib/extra.ts', body('extra'))
    write('docs/note.md', body('note'))
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'base'])
    const base = git(['rev-parse', 'HEAD']).trim()
    const branch = (name, change) => {
      git(['checkout', '-q', '-B', name, base])
      change()
      git(['add', '-A'])
      git(['commit', '-q', '-m', name])
      return git(['rev-parse', 'HEAD']).trim()
    }

    // (أ) حذف ملف جوه النطاق
    const deleted = branch('case-delete', () => git(['rm', '-q', 'apps/storefront/lib/extra.ts']))
    const pa = collectChangedPaths(base + '...' + deleted, root)
    check('G-a delete in scope: the collector lists the deleted path', pa, ['apps/storefront/lib/extra.ts'])
    check('G-a delete in scope: run=true', run('pull_request', pa), true)

    // (ب) نقل من جوه النطاق لبرّه (مثال المراجع) — تلات إثباتات على نفس الـ diff
    const OLD = 'apps/storefront/scripts/isr-integration/source.mjs'
    const NEW = 'scripts/isr-source.mjs'
    const movedOut = branch('case-move-out', () => {
      mkdirSync(path.join(root, 'scripts'), { recursive: true })
      git(['mv', OLD, NEW])
    })
    const rangeB = base + '...' + movedOut
    const statusLines = git(['diff', '-M', '--name-status', rangeB]).split('\n').filter((line) => line !== '')
    const hasRenameLine = statusLines.some((line) => {
      const parts = line.split('\t')
      return /^R\d+$/.test(parts[0] || '') && parts[1] === OLD && parts[2] === NEW
    })
    check('G-b proof 1: -M --name-status shows an R line with the old and the new path', hasRenameLine, true)
    const nameOnly = git(['diff', '-M', '--name-only', rangeB]).split('\n').filter((line) => line !== '')
    check('G-b proof 2: -M --name-only lists the new path without the old one', [nameOnly.includes(NEW), nameOnly.includes(OLD)], [true, false])
    const pb = collectChangedPaths(rangeB, root)
    check('G-b proof 3: the collector (--no-renames --name-only -z) returns both paths', sorted(pb), [OLD, NEW].sort())
    check('G-b proof 3: run=true', run('pull_request', pb), true)

    // (ج) نقل من برّه النطاق لجوه
    const IN = 'apps/storefront/notes/note.md'
    const movedIn = branch('case-move-in', () => {
      mkdirSync(path.join(root, 'apps/storefront/notes'), { recursive: true })
      git(['mv', 'docs/note.md', IN])
    })
    const pc = collectChangedPaths(base + '...' + movedIn, root)
    check('G-c move out -> in: the collector returns both paths', sorted(pc), ['docs/note.md', IN].sort())
    check('G-c move out -> in: run=true', run('pull_request', pc), true)

    // (د) تعديل ملف برّه النطاق بس
    const outside = branch('case-outside', () => write('docs/note.md', body('note') + 'changed\n'))
    const pd = collectChangedPaths(base + '...' + outside, root)
    check('G-d outside only: the collector lists docs/note.md', pd, ['docs/note.md'])
    check('G-d outside only: run=false', run('pull_request', pd), false)

    // (هـ) range مش موجود → null → fail-open
    const pe = collectChangedPaths(base + '...0000000000000000000000000000000000000000', root)
    check('G-e unreadable range: null and run=true (fail-open)', [pe, run('pull_request', pe)], [null, true])
  } catch (error) {
    failures.push('git fixture error: ' + String(error && error.message ? error.message : error))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  for (const failure of failures) console.error('ISR_SCOPE_SELFTEST_FAIL ' + failure)
  console.log('ISR_SCOPE_SELFTEST pass=' + String(passed) + ' fail=' + String(failures.length))
  return failures.length === 0 && passed > 0
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? '' : process.argv[index + 1] || ''
}

if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 1)
}

const event = argValue('--event')
const baseSha = argValue('--base')
const paths = event === 'pull_request' ? (baseSha === '' ? null : collectChangedPaths(baseSha + '...HEAD', process.cwd())) : null
const decision = decide(event, paths)
console.log('ISR_SCOPE event=' + event + ' run=' + String(decision.run) + ' reason=' + decision.reason)
if (paths !== null) console.log('ISR_SCOPE changed=' + String(paths.length) + ' matched=' + String(decision.matched.length))
for (const file of decision.matched) console.log('ISR_SCOPE_MATCH ' + file)
const output = process.env['GITHUB_OUTPUT']
if (output) appendFileSync(output, 'run=' + String(decision.run) + '\n')
