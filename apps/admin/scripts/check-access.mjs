#!/usr/bin/env node
/**
 * 0021-P (ب1) — فاحص الحراس بالـ AST. العقد: docs/contracts/0021-P-code.md §٦.
 *
 * القاعدة: كل page / layout / route method / Server Action لازم يتصدّر كنتيجة نداء غلاف
 * متستورد من موديول الأغلفة، بصلاحية مكتوبة نصًا وموجودة في قائمة الصلاحيات.
 * بيستخدم TypeScript الموجود أصلًا في devDependencies — مفيش dependency جديدة.
 *
 *   node scripts/check-access.mjs --root <appRoot> --mode enforce|report [--only prefixA,prefixB]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const DEFAULT_CONFIG = {
  scanDirs: ['app', 'lib', 'components'],
  accessModule: 'lib/access/instance',
  capabilitiesFile: 'lib/access/capabilities.ts',
  capabilitiesExport: 'ZELL_CAPABILITIES',
  publicFiles: [
    'app/layout.tsx',
    'app/(auth)/layout.tsx',
    'app/(auth)/login/page.tsx',
    'app/(auth)/login/actions.ts',
    'app/(auth)/403/page.tsx',
    'app/auth/signout/route.ts',
  ],
  rawGuardDirs: ['lib/auth/', 'lib/access/'],
  rawGuards: ['requireAdminPage', 'requireAdminAction', 'resolveAdminIdentity', 'readAdminRole'],
  mutationModules: ['lib/mutations/', 'lib/inventory/rpc'],
  mutationImporterDirs: ['lib/mutations/', 'lib/inventory/', 'lib/data/'],
}

const PAGE_WRAPPERS = new Set(['pageWithAccess'])
const LAYOUT_WRAPPERS = new Set(['layoutWithSession', 'pageWithAccess'])
const ROUTE_WRAPPERS = new Set(['routeWithAccess'])
const ACTION_WRAPPERS = new Set(['actionWithAccess', 'formActionWithAccess'])
const ALL_WRAPPERS = new Set([...PAGE_WRAPPERS, ...LAYOUT_WRAPPERS, ...ROUTE_WRAPPERS, ...ACTION_WRAPPERS])
const NO_CAPABILITY_WRAPPERS = new Set(['layoutWithSession'])
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const PAGE_CONFIG = new Set(['metadata', 'viewport', 'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration'])
const ROUTE_CONFIG = new Set(['dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration'])
const SOURCE_RE = /\.(tsx?|jsx?|mjs)$/

const toPosix = (p) => p.split(sep).join('/')
const stripModule = (p) => p.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\/index$/, '')

function walk(dir, out) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SOURCE_RE.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function hasModifier(node, kind) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return Boolean(mods && mods.some((m) => m.kind === kind))
}

function hasDirective(statements, text) {
  for (const stmt of statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === text) return true
      continue
    }
    return false
  }
  return false
}

function resolveSpecifier(root, fromFile, spec) {
  let abs = null
  if (spec.startsWith('.')) abs = resolve(dirname(fromFile), spec)
  else if (spec.startsWith('@/')) abs = resolve(root, spec.slice(2))
  if (abs === null) return 'pkg:' + spec
  return stripModule(toPosix(relative(root, abs)))
}

function collectImports(sf, root, file) {
  const bindings = new Map()
  const modules = []
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const module = resolveSpecifier(root, file, stmt.moduleSpecifier.text)
    const clause = stmt.importClause
    const declTypeOnly = Boolean(clause && clause.isTypeOnly)
    let valueImport = !clause
    if (clause && clause.name) {
      bindings.set(clause.name.text, { imported: 'default', module, typeOnly: declTypeOnly })
      if (!declTypeOnly) valueImport = true
    }
    const named = clause ? clause.namedBindings : undefined
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const typeOnly = declTypeOnly || el.isTypeOnly
        bindings.set(el.name.text, { imported: (el.propertyName || el.name).text, module, typeOnly })
        if (!typeOnly) valueImport = true
      }
    } else if (named && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, { imported: '*', module, typeOnly: declTypeOnly })
      if (!declTypeOnly) valueImport = true
    }
    modules.push({ module, valueImport, line: lineOf(sf, stmt) })
  }
  return { bindings, modules }
}

function collectExports(sf) {
  const items = []
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt)) {
      items.push({ kind: 'default-expr', name: 'default', expr: stmt.expression, node: stmt })
      continue
    }
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.isTypeOnly) items.push({ kind: 'reexport', name: 'reexport', node: stmt })
      continue
    }
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue
    if (ts.isFunctionDeclaration(stmt)) {
      items.push({ kind: isDefault ? 'default-fn' : 'function', name: isDefault ? 'default' : stmt.name ? stmt.name.text : 'anonymous', node: stmt })
      continue
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) items.push({ kind: 'variable', name: d.name.text, expr: d.initializer, node: d })
        else items.push({ kind: 'pattern', name: 'destructured', node: d })
      }
      continue
    }
    const name = stmt.name && ts.isIdentifier(stmt.name) ? stmt.name.text : 'other'
    items.push({ kind: isDefault ? 'default-other' : 'other', name: isDefault ? 'default' : name, node: stmt })
  }
  return items
}

function visitFunctions(node, cb) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) cb(node)
  ts.forEachChild(node, (child) => visitFunctions(child, cb))
}

function readCapabilities(root, config) {
  const file = join(root, config.capabilitiesFile)
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const caps = new Set()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === config.capabilitiesExport && node.initializer) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(init))) init = init.expression
      if (ts.isArrayLiteralExpression(init)) for (const el of init.elements) if (ts.isStringLiteralLike(el)) caps.add(el.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (caps.size === 0) throw new Error('capabilities list not found in ' + config.capabilitiesFile)
  return caps
}

function checkWrapper(expr, allowed, env, notWrapped) {
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) {
    return { rule: notWrapped, msg: 'export is not a call to an access wrapper' }
  }
  const local = expr.expression.text
  const binding = env.bindings.get(local)
  if (!binding || binding.typeOnly) {
    return { rule: ALL_WRAPPERS.has(local) ? 'WRAPPER_NOT_FROM_ACCESS_MODULE' : notWrapped, msg: local + ' is not imported from the access module' }
  }
  if (binding.module !== env.accessModule) {
    // اسم غلاف معروف من موديول تاني = تزوير محتمل؛ أي نداء تاني = مش ملفوف أصلًا.
    const rule = ALL_WRAPPERS.has(binding.imported) ? 'WRAPPER_NOT_FROM_ACCESS_MODULE' : notWrapped
    return { rule, msg: local + ' is imported from ' + binding.module }
  }
  if (!allowed.has(binding.imported)) return { rule: notWrapped, msg: binding.imported + ' is not allowed for this export' }
  if (NO_CAPABILITY_WRAPPERS.has(binding.imported)) return null
  const arg = expr.arguments[0]
  if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
    return { rule: 'CAPABILITY_NOT_LITERAL', msg: 'capability must be a string literal' }
  }
  if (!env.capabilities.has(arg.text)) return { rule: 'UNKNOWN_CAPABILITY', msg: 'unknown capability ' + arg.text }
  env.usedCapabilities.add(arg.text)
  return null
}

export function checkAccess(rootArg, overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides }
  const root = resolve(rootArg)
  const capabilities = readCapabilities(root, config)
  const usedCapabilities = new Set()
  const accessModule = stripModule(config.accessModule)
  const publicSet = new Set(config.publicFiles)
  const files = []
  for (const d of config.scanDirs) walk(join(root, d), files)
  files.sort()

  const findings = []
  const inventory = { pages: [], layouts: [], routes: [], actions: [] }
  const add = (rule, file, line, msg) => findings.push({ rule, file, line, msg })

  for (const file of files) {
    const rel = toPosix(relative(root, file))
    const scriptKind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind)
    const { bindings, modules } = collectImports(sf, root, file)
    const env = { bindings, accessModule, capabilities, usedCapabilities }
    const isPublic = publicSet.has(rel)
    const base = rel.split('/').pop() || ''
    const inApp = rel.startsWith('app/')
    let kind = 'other'
    if (inApp && /^page\.(tsx?|jsx?)$/.test(base)) kind = 'page'
    else if (inApp && /^layout\.(tsx?|jsx?)$/.test(base)) kind = 'layout'
    else if (inApp && /^route\.(tsx?|jsx?)$/.test(base)) kind = 'route'
    else if (hasDirective(sf.statements, 'use server')) kind = 'server'

    visitFunctions(sf, (fn) => {
      if (fn.body && ts.isBlock(fn.body) && hasDirective(fn.body.statements, 'use server')) {
        add('INLINE_USE_SERVER', rel, lineOf(sf, fn), 'inline use server is forbidden')
      }
    })

    if (!isPublic && !config.rawGuardDirs.some((p) => rel.startsWith(p))) {
      for (const [local, b] of bindings) {
        if (!b.typeOnly && config.rawGuards.includes(b.imported)) add('RAW_GUARD_IMPORT', rel, 1, local + ' from ' + b.module)
      }
    }

    const mayImportMutations = kind === 'server' || kind === 'route' || config.mutationImporterDirs.some((p) => rel.startsWith(p))
    if (!mayImportMutations) {
      for (const m of modules) {
        if (m.valueImport && config.mutationModules.some((p) => m.module.startsWith(p))) {
          add('MUTATION_IMPORT_OUTSIDE', rel, m.line, 'imports ' + m.module)
        }
      }
    }

    const exportsList = collectExports(sf)

    if (kind === 'page' || kind === 'layout') {
      const target = kind === 'page' ? inventory.pages : inventory.layouts
      if (isPublic) {
        target.push({ file: rel, status: 'public' })
        continue
      }
      const allowed = kind === 'page' ? PAGE_WRAPPERS : LAYOUT_WRAPPERS
      const notWrapped = kind === 'page' ? 'PAGE_NOT_WRAPPED' : 'LAYOUT_NOT_WRAPPED'
      const extra = kind === 'page' ? 'PAGE_EXTRA_EXPORT' : 'LAYOUT_EXTRA_EXPORT'
      let status = 'guarded'
      const def = exportsList.find((e) => e.name === 'default')
      if (!def) {
        add(notWrapped, rel, 1, 'missing default export')
        status = 'unguarded'
      } else if (def.kind !== 'default-expr') {
        add(notWrapped, rel, lineOf(sf, def.node), 'default export is not a wrapper call')
        status = 'unguarded'
      } else {
        const problem = checkWrapper(def.expr, allowed, env, notWrapped)
        if (problem) {
          add(problem.rule, rel, lineOf(sf, def.node), problem.msg)
          status = 'unguarded'
        }
      }
      for (const e of exportsList) {
        if (e.name === 'default') continue
        if (e.kind === 'variable' && PAGE_CONFIG.has(e.name)) continue
        add(extra, rel, lineOf(sf, e.node), 'export ' + e.name + ' is not allowed')
      }
      target.push({ file: rel, status })
      continue
    }

    if (kind === 'route') {
      for (const e of exportsList) {
        if (HTTP_METHODS.has(e.name)) {
          let status = isPublic ? 'public' : 'guarded'
          if (!isPublic) {
            if (e.kind !== 'variable') {
              add('ROUTE_NOT_WRAPPED', rel, lineOf(sf, e.node), e.name + ' is not a wrapper call')
              status = 'unguarded'
            } else {
              const problem = checkWrapper(e.expr, ROUTE_WRAPPERS, env, 'ROUTE_NOT_WRAPPED')
              if (problem) {
                add(problem.rule, rel, lineOf(sf, e.node), problem.msg)
                status = 'unguarded'
              }
            }
          }
          inventory.routes.push({ file: rel, method: e.name, status })
          continue
        }
        if (isPublic) continue
        if (e.kind === 'variable' && ROUTE_CONFIG.has(e.name)) continue
        add('ROUTE_EXTRA_EXPORT', rel, lineOf(sf, e.node), 'export ' + e.name + ' is not allowed')
      }
      continue
    }

    if (kind === 'server') {
      for (const e of exportsList) {
        if (isPublic) {
          inventory.actions.push({ file: rel, name: e.name, status: 'public' })
          continue
        }
        let status = 'guarded'
        if (e.kind === 'reexport') {
          add('ACTION_REEXPORT', rel, lineOf(sf, e.node), 're-exports are forbidden in use server files')
          status = 'unguarded'
        } else if (e.kind !== 'variable') {
          add('ACTION_NOT_WRAPPED', rel, lineOf(sf, e.node), e.name + ' is not a wrapper call')
          status = 'unguarded'
        } else {
          const problem = checkWrapper(e.expr, ACTION_WRAPPERS, env, 'ACTION_NOT_WRAPPED')
          if (problem) {
            add(problem.rule, rel, lineOf(sf, e.node), problem.msg)
            status = 'unguarded'
          }
        }
        inventory.actions.push({ file: rel, name: e.name, status })
      }
    }
  }

  const unusedCapabilities = [...capabilities].filter((c) => !usedCapabilities.has(c)).sort()
  return { findings, inventory, unusedCapabilities }
}

function parseArgs(argv) {
  const out = { root: '.', mode: 'enforce', only: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') out.root = argv[++i] || '.'
    else if (a === '--mode') out.mode = argv[++i] || 'enforce'
    else if (a === '--only') out.only = (argv[++i] || '').split(',').filter(Boolean)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode !== 'enforce' && args.mode !== 'report') {
    console.error('mode must be enforce or report')
    process.exit(2)
  }
  const result = checkAccess(args.root)
  const inScope = (file) => args.only.length === 0 || args.only.some((p) => file.startsWith(p))
  const findings = result.findings.filter((f) => inScope(f.file))
  for (const f of findings) console.log('ACCESS_FINDING ' + f.rule + ' ' + f.file + ':' + f.line + ' ' + f.msg)

  const inv = result.inventory
  const count = (list, status) => list.filter((x) => inScope(x.file) && (status === undefined || x.status === status)).length
  const summary = (label, list) =>
    label + '=' + count(list) + '(guarded=' + count(list, 'guarded') + ',unguarded=' + count(list, 'unguarded') + ',public=' + count(list, 'public') + ')'
  console.log(
    'ZELL_ACCESS_INVENTORY scope=' + (args.only.join(',') || 'all') + ' ' +
      summary('pages', inv.pages) + ' ' + summary('layouts', inv.layouts) + ' ' +
      summary('route_methods', inv.routes) + ' ' + summary('actions', inv.actions),
  )
  if (args.mode === 'report') {
    const perFile = new Map()
    for (const a of inv.actions) if (inScope(a.file)) perFile.set(a.file, (perFile.get(a.file) || 0) + 1)
    for (const [file, n] of [...perFile].sort()) console.log('ZELL_ACCESS_ACTIONS ' + file + ' count=' + n)
    for (const r of inv.routes) if (inScope(r.file)) console.log('ZELL_ACCESS_ROUTE ' + r.file + ' ' + r.method + ' ' + r.status)
    if (args.only.length === 0) console.log('ZELL_ACCESS_UNUSED_CAPABILITIES ' + (result.unusedCapabilities.join(',') || 'none'))
  }
  const byRule = new Map()
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1)
  for (const [rule, n] of [...byRule].sort()) console.log('ZELL_ACCESS_RULE ' + rule + '=' + n)
  console.log('ZELL_ACCESS_CHECK mode=' + args.mode + ' findings=' + findings.length)
  if (args.mode === 'enforce' && findings.length > 0) process.exit(1)
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) main()
