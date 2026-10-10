#!/usr/bin/env node
/**
 * 0020-S PR-2 — فاحص نداءات المخزون في اللوحة (CI). منطق خالص على الملفات، من غير شبكة ولا داتابيز.
 *
 * القواعد:
 *   A. صفر معامل الممثل القديم (ACTOR_TOKEN تحت) في أي ملف تحت apps/admin (كود أو تعليق أو نص)، ما عدا node_modules و .next.
 *   B. أي اسم zell_inv_* في الكود (برّه التعليقات) لازم يبقى zell_inv_session_*، وفي lib/inventory/sessionCall.ts بس.
 *      ملفات الحالات (*.cases.ts) والفاحص نفسه مستثنيين من B بس (بيانات اختبار، مش نداءات).
 *   C. lib/inventory/rpc.ts بيستورد createAuthClient من ../auth/supabaseServer، ومابيستوردش أي حاجة من ../data/client،
 *      ومافيهوش restRpc ولا SUPABASE_SERVICE_ROLE_KEY. يعني صفر نداء مخزون بـ service_role.
 *   D. sessionCall.ts فيه 21 اسم zell_inv_session_* مختلفين.
 *   E. رسالة UNAUTHENTICATED في sessionCall.ts = UNAUTHENTICATED_MESSAGE في lib/access/wrappers.ts بالحرف.
 *   F. lib/access/manifest.ts زي ما هو بالظبط (blob hash متثبت؛ اتحدّث في 0021-A A2 بإضافة 4 actions دورة الطلب، وفي 0021-A P2 بإضافة 8 actions الدفع وصفحة الدفع).
 *
 * الاستخدام: node apps/admin/scripts/check-inventory-session.mjs [--selftest]
 * سطر النتيجة: ZELL_INVENTORY_SESSION_CHECK ... findings=<n>   (خروج 1 لو findings > 0)
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ACTOR_TOKEN = 'p_' + 'actor'
const MANIFEST_BLOB = '5d6acea650550f9daca5a961ce79c75a4fc6abf0'
const SESSION_FILE = 'lib/inventory/sessionCall.ts'
const SELF_FILE = 'scripts/check-inventory-session.mjs'
const RPC_FILE = 'lib/inventory/rpc.ts'
const CODE_EXT = /\.(ts|tsx|mjs|js|cjs)$/
const TEXT_EXT = /\.(ts|tsx|mjs|js|cjs|json|md|css)$/

/** الكود من غير التعليقات (النصوص بتفضل). lexer بسيط: النصوص بالـ quotes التلاتة، وتعليقات السطر والبلوك. */
export function stripComments(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === String.fromCharCode(96)) {
      const quote = c
      out += c
      i += 1
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        if (quote !== String.fromCharCode(96) && source[i] === '\n') break
        out += source[i]
        i += 1
      }
      if (i < n) out += source[i]
      i += 1
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** القواعد A و B على ملف واحد. بيرجّع قايمة findings (نصوص). */
export function fileFindings(path, source) {
  const findings = []
  if (source.includes(ACTOR_TOKEN)) findings.push('A ' + path + ': ' + ACTOR_TOKEN)
  if (CODE_EXT.test(path) && !path.endsWith('.cases.ts') && path !== SELF_FILE) {
    const names = stripComments(source).match(/zell_inv_[a-z0-9_]*/g) ?? []
    for (const name of names) {
      if (path !== SESSION_FILE || !/^zell_inv_session_[a-z_]+$/.test(name)) {
        findings.push('B ' + path + ': ' + name)
      }
    }
  }
  return findings
}

export function rpcFindings(source) {
  const findings = []
  const code = stripComments(source)
  if (!/import\s*\{[^}]*\bcreateAuthClient\b[^}]*\}\s*from\s*'\.\.\/auth\/supabaseServer'/.test(code)) {
    findings.push('C rpc.ts: createAuthClient import missing')
  }
  if (/from\s*'\.\.\/data\/client'/.test(code)) findings.push('C rpc.ts: imports ../data/client')
  if (/\brestRpc\b/.test(code)) findings.push('C rpc.ts: restRpc')
  if (code.includes('SUPABASE_SERVICE_ROLE_KEY')) findings.push('C rpc.ts: SUPABASE_SERVICE_ROLE_KEY')
  return findings
}

export function sessionNames(source) {
  return [...new Set(stripComments(source).match(/'zell_inv_session_[a-z_]+'/g) ?? [])]
}

function messageConst(source, name) {
  const match = source.match(new RegExp(name + "\\s*=\\s*'([^']*)'"))
  return match ? match[1] : null
}

function blobHash(buffer) {
  return createHash('sha1').update('blob ' + buffer.length + '\0').update(buffer).digest('hex')
}

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else if (TEXT_EXT.test(entry)) files.push(full)
  }
  return files
}

function selftest() {
  const cases = [
    ['A caught', fileFindings('lib/x.ts', "const a = { " + ACTOR_TOKEN + ": 1 }").length === 1],
    ['A caught in a comment', fileFindings('lib/x.md', 'see ' + ACTOR_TOKEN).length === 1],
    ['B old name in code caught', fileFindings('lib/x.ts', "rpc('zell_inv_list_lots')").length === 1],
    ['B session name outside sessionCall caught', fileFindings('lib/x.ts', "rpc('zell_inv_session_list_lots')").length === 1],
    ['B session name in sessionCall ok', fileFindings(SESSION_FILE, "const a = 'zell_inv_session_list_lots'").length === 0],
    ['B old name in sessionCall caught', fileFindings(SESSION_FILE, "const a = 'zell_inv_list_lots'").length === 1],
    ['B name in comment ignored', fileFindings('lib/x.ts', '// zell_inv_list_lots\n/* zell_inv_get_opening */ const a = 1').length === 0],
    ['B cases file exempt', fileFindings('lib/inventory/x.cases.ts', "const a = 'zell_inv_list_lots'").length === 0],
    ['B string with // inside is not a comment', fileFindings('lib/x.ts', "const u = 'https://x' + 'zell_inv_list_lots'").length === 1],
    ['C clean rpc ok', rpcFindings("import { createAuthClient } from '../auth/supabaseServer'\n").length === 0],
    ['C data/client caught', rpcFindings("import { createAuthClient } from '../auth/supabaseServer'\nimport { restRpc } from '../data/client'\n").length === 2],
    ['C missing auth caught', rpcFindings('const a = 1').length === 1],
    ['D names counted', sessionNames("a = 'zell_inv_session_a'; b = 'zell_inv_session_b'; c = 'zell_inv_session_a'").length === 2],
  ]
  let bad = 0
  for (const [name, ok] of cases) {
    if (!ok) {
      bad += 1
      console.log('SELFTEST FAIL ' + name)
    }
  }
  console.log('ZELL_INVENTORY_SESSION_SELFTEST pass=' + (cases.length - bad) + ' fail=' + bad)
  return bad === 0
}

function main() {
  if (!selftest()) process.exit(1)
  if (process.argv.includes('--selftest')) return

  const findings = []
  let actorCount = 0
  let files = 0
  for (const full of walk(ADMIN_ROOT, [])) {
    const path = relative(ADMIN_ROOT, full).split(sep).join('/')
    const source = readFileSync(full, 'utf8')
    files += 1
    const found = fileFindings(path, source)
    actorCount += found.filter((f) => f.startsWith('A ')).length
    findings.push(...found)
  }

  const rpc = readFileSync(join(ADMIN_ROOT, RPC_FILE), 'utf8')
  const rpcFound = rpcFindings(rpc)
  findings.push(...rpcFound)

  const session = readFileSync(join(ADMIN_ROOT, SESSION_FILE), 'utf8')
  const names = sessionNames(session)
  if (names.length !== 21) findings.push('D sessionCall.ts: ' + names.length + ' session names (expected 21)')

  const wrappers = readFileSync(join(ADMIN_ROOT, 'lib/access/wrappers.ts'), 'utf8')
  const wrapperMessage = messageConst(wrappers, 'UNAUTHENTICATED_MESSAGE')
  const sessionMessage = messageConst(session, 'SESSION_UNAUTHENTICATED_MESSAGE')
  const messageOk = wrapperMessage !== null && wrapperMessage === sessionMessage
  if (!messageOk) findings.push('E UNAUTHENTICATED message differs')

  const manifestHash = blobHash(readFileSync(join(ADMIN_ROOT, 'lib/access/manifest.ts')))
  const manifestOk = manifestHash === MANIFEST_BLOB
  if (!manifestOk) findings.push('F manifest.ts changed (' + manifestHash + ')')

  for (const f of findings) console.log('FINDING ' + f)
  console.log(
    'ZELL_INVENTORY_SESSION_CHECK files=' + files +
      ' ' + ACTOR_TOKEN + '=' + actorCount +
      ' service_role_inventory_calls=' + (findings.filter((f) => f.startsWith('B ') || f.startsWith('C ')).length) +
      ' session_functions=' + names.length +
      ' unauth_message=' + (messageOk ? 'ok' : 'diff') +
      ' manifest_blob=' + (manifestOk ? 'unchanged' : 'changed') +
      ' findings=' + findings.length,
  )
  if (findings.length > 0) process.exit(1)
}

main()
