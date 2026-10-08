#!/usr/bin/env node
/**
 * 0021-P (ب2) — جدول الربط (lib/access/manifest.ts) = الكود بالحرف. العقد: docs/contracts/0021-P-code.md §٧.
 *
 * لكل page / layout / route method / Server Action محمي في اللوحة:
 *   نفس الغلاف · نفس الصلاحية (نص ثابت) · نفس mutates · نفس forbiddenMessage · نفس mapFailure.
 * ومفيش رمز محمي في الكود مش في الجدول، ولا رمز في الجدول مش في الكود (الجرد من check-access.mjs).
 * بيستخدم TypeScript الموجود أصلًا — مفيش dependency جديدة.
 *
 *   node scripts/check-access-manifest.mjs --root <appRoot>
 * سطر النتيجة: ZELL_ACCESS_MANIFEST ok entries=<n> …   أو   ZELL_ACCESS_MANIFEST fail mismatches=<n> (والخروج 1)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { checkAccess } from './check-access.mjs'

const EXPECTED_WRAPPER = {
  page: 'pageWithAccess',
  layout: 'layoutWithSession',
  route: 'routeWithAccess',
  action: 'actionWithAccess',
}

function parseArgs(argv) {
  let root = '.'
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--root') root = argv[++i] || '.'
  return { root: resolve(root) }
}

function loadManifest(root) {
  const source = readFileSync(join(root, 'lib/access/manifest.ts'), 'utf8')
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const dir = mkdtempSync(join(tmpdir(), 'zell-access-manifest-'))
  try {
    writeFileSync(join(dir, 'package.json'), '{ "type": "commonjs" }\n')
    writeFileSync(join(dir, 'manifest.js'), out.outputText)
    const req = createRequire(join(dir, 'index.js'))
    const list = req(join(dir, 'manifest.js')).ACCESS_MANIFEST
    if (!Array.isArray(list)) throw new Error('ACCESS_MANIFEST is not an array')
    return list
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function literalValue(node) {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isIdentifier(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return '<expression>'
}

function describeCall(expr) {
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return { wrapper: '<not-a-wrapper-call>' }
  const wrapper = expr.expression.text
  const args = expr.arguments
  const out = { wrapper, capability: null, mutates: false, forbiddenMessage: null, mapFailure: null }
  if (wrapper === 'layoutWithSession') return out
  const first = args[0]
  out.capability = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : '<not-literal>'
  if (wrapper === 'pageWithAccess') return out
  const options = args[1]
  if (!options || !ts.isObjectLiteralExpression(options)) {
    out.mutates = '<options-not-literal>'
    return out
  }
  out.mutates = '<missing>'
  for (const p of options.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
    const key = p.name.text
    if (key === 'mutates' || key === 'forbiddenMessage' || key === 'mapFailure') out[key] = literalValue(p.initializer)
  }
  return out
}

function readExport(root, file, symbol) {
  const text = readFileSync(join(root, file), 'utf8')
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  for (const st of sf.statements) {
    if (symbol === 'default' && ts.isExportAssignment(st) && !st.isExportEquals) return describeCall(st.expression)
    if (symbol === 'default' || !ts.isVariableStatement(st)) continue
    const exported = (ts.getModifiers(st) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === symbol) return describeCall(d.initializer)
    }
  }
  return null
}

function main() {
  const { root } = parseArgs(process.argv.slice(2))
  const manifest = loadManifest(root)
  const mismatches = []
  const bad = (key, field, expected, actual) => mismatches.push({ key, field, expected, actual })

  const inv = checkAccess(root).inventory
  const codeKeys = new Set()
  for (const p of inv.pages) if (p.status !== 'public') codeKeys.add('page ' + p.file + ' default')
  for (const l of inv.layouts) if (l.status !== 'public') codeKeys.add('layout ' + l.file + ' default')
  for (const r of inv.routes) if (r.status !== 'public') codeKeys.add('route ' + r.file + ' ' + r.method)
  for (const a of inv.actions) if (a.status !== 'public') codeKeys.add('action ' + a.file + ' ' + a.name)

  const manifestKeys = new Set()
  for (const e of manifest) {
    const key = e.kind + ' ' + e.file + ' ' + e.symbol
    if (manifestKeys.has(key)) bad(key, 'duplicate', 'once', 'twice')
    manifestKeys.add(key)
    if (!codeKeys.has(key)) bad(key, 'presence', 'in code', 'missing from code')
    const found = readExport(root, e.file, e.symbol)
    if (found === null) {
      bad(key, 'export', 'wrapper call', 'not found')
      continue
    }
    const expected = {
      wrapper: EXPECTED_WRAPPER[e.kind],
      capability: e.capability,
      mutates: e.mutates,
      forbiddenMessage: e.forbiddenMessage,
      mapFailure: e.mapFailure,
    }
    for (const field of Object.keys(expected)) {
      if (found[field] !== expected[field]) bad(key, field, expected[field], found[field])
    }
  }
  for (const key of codeKeys) if (!manifestKeys.has(key)) bad(key, 'presence', 'in manifest', 'missing from manifest')

  for (const m of mismatches) {
    console.log('ACCESS_MANIFEST_MISMATCH ' + m.key + ' ' + m.field + ' expected=' + JSON.stringify(m.expected) + ' actual=' + JSON.stringify(m.actual))
  }
  const by = (kind) => manifest.filter((e) => e.kind === kind).length
  if (mismatches.length > 0) {
    console.log('ZELL_ACCESS_MANIFEST fail mismatches=' + mismatches.length)
    process.exit(1)
  }
  console.log(
    'ZELL_ACCESS_MANIFEST ok entries=' + manifest.length + ' pages=' + by('page') + ' layouts=' + by('layout') +
      ' routes=' + by('route') + ' actions=' + by('action') + ' code=' + codeKeys.size,
  )
}

main()
