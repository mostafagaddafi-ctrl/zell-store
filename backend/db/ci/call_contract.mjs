#!/usr/bin/env node
// backend/db/ci/call_contract.mjs — BASELINE-OUTSIDE §5 (ر٢). Permanent call-contract guard, static part. No dependency.
// Walks apps/**, extracts every database call: restRpc(...) (service key => role service_role) and .rpc(...)
// (session client => role authenticated). The function name comes from a string literal, a same-file string const,
// or a known name map (export const X = { key: 'zell_...' }). Arguments come from an object literal (top-level keys).
// Anything not statically parseable must be listed in call_contract_policy.json "exceptions" (reviewed), else this
// fails; exceptions that no longer match a call site also fail. Writes a SQL check (--sql) run on the built database:
// function exists in public · an overload accepts exactly the sent names (defaults/overloads considered) · the role
// has EXECUTE · roles forbidden by the policy have none.
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1]
const root = opt.root
const policy = JSON.parse(fs.readFileSync(opt.policy, 'utf8'))
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage'])

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out) }
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p)
  }
  return out
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/')
const excluded = (f) => policy.excluded_paths.some((x) => new RegExp(x.pattern).test(f))
const files = walk(path.join(root, 'apps'), []).map(rel).filter((f) => !excluded(f)).sort()

// Blank out comments, keep strings and line breaks (so offsets and line numbers stay valid).
function stripComments(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const d = s[i + 1]
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++ } continue }
    if (c === '/' && d === '*') { while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++ } out += '  '; i += 2; continue }
    if (c === "'" || c === '"' || c === '\x60') {
      const q = c
      out += c; i++
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue } out += s[i]; i++ }
      out += s[i] || ''; i++
      continue
    }
    out += c; i++
  }
  return out
}

// Read one argument starting at i: returns [text, nextIndex, terminator].
function readArg(s, i) {
  let depth = 0
  let start = i
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '\x60') {
      const q = c; i++
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ }
      i++; continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return [s.slice(start, i).trim(), i, c]; depth-- }
    else if (c === ',' && depth === 0) return [s.slice(start, i).trim(), i, c]
    i++
  }
  return [s.slice(start).trim(), i, '']
}

function topLevelKeys(obj) {
  const inner = obj.trim().slice(1, -1)
  const keys = []
  let i = 0
  while (i < inner.length) {
    const [part, next] = readArg(inner, i)
    i = next + 1
    if (part === '') continue
    if (part.startsWith('...')) return null
    const m = part.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(:|$)/)
    if (!m) return null
    keys.push(m[1] || m[2] || m[3])
  }
  return keys
}

const sources = new Map()
for (const f of files) sources.set(f, stripComments(fs.readFileSync(path.join(root, f), 'utf8')))

// Name maps: export const NAME = { key: 'zell_x', ... } (as const) — every value a string literal.
const maps = new Map()
for (const [f, s] of sources) {
  const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\{/g
  let m
  while ((m = re.exec(s))) {
    const [body] = readArg(s, m.index + m[0].length)
    const vals = []
    let all = true
    for (const part of body.split(',').map((x) => x.trim()).filter(Boolean)) {
      const mm = part.match(/^[A-Za-z_$][\w$]*\s*:\s*'([a-z][a-z0-9_]*)'$/)
      if (mm) vals.push(mm[1]); else all = false
    }
    if (all && vals.length && vals.every((v) => /^(zell|erp)_/.test(v))) maps.set(m[1], { file: f, names: vals })
  }
}

const sites = []
const unparsed = []
for (const [f, s] of sources) {
  const consts = new Map()
  const cre = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\]|' ]+)?\s*=\s*'([a-z][a-z0-9_]*)'/g
  let cm
  while ((cm = cre.exec(s))) consts.set(cm[1], cm[2])
  const re = /(\brestRpc|\.rpc)\s*(<[^>()]*>)?\s*\(/g
  let m
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 20), m.index)
    if (/function\s+$/.test(before)) continue
    const line = s.slice(0, m.index).split('\n').length
    const role = m[1] === '.rpc' ? 'authenticated' : 'service_role'
    const [a1, i1, t1] = readArg(s, m.index + m[0].length)
    let a2 = null
    if (t1 === ',') a2 = readArg(s, i1 + 1)[0]
    const site = { file: f, line, role, first_arg: a1.replace(/\s+/g, ' '), names: null, params: null, via: null }
    let lit = a1.match(/^'([a-z][a-z0-9_]*)'$|^"([a-z][a-z0-9_]*)"$/)
    if (lit) { site.names = [lit[1] || lit[2]]; site.via = 'literal' }
    else if (consts.has(a1)) { site.names = [consts.get(a1)]; site.via = 'const ' + a1 }
    else {
      const mk = a1.match(/^([A-Z][A-Z0-9_]*)\[/)
      if (mk && maps.has(mk[1])) { site.names = maps.get(mk[1]).names; site.via = 'map ' + mk[1] }
    }
    if (a2 === null || a2 === '') site.params = []
    else if (a2.startsWith('{')) site.params = topLevelKeys(a2)
    site.kind = site.names === null ? 'name_unparsed' : site.params === null ? 'params_unknown' : 'ok'
    sites.push(site)
  }
}

// Exceptions: { file, first_arg, kind, reason } — reviewed; must match exactly one or more current sites.
const exc = policy.exceptions || []
const used = new Set()
let bad = 0
for (const s of sites) {
  if (s.kind === 'ok') continue
  const k = exc.findIndex((e) => e.file === s.file && e.first_arg === s.first_arg && e.kind === s.kind)
  if (k < 0) { console.log('UNPARSED_NOT_IN_EXCEPTIONS ' + s.file + ':' + s.line + ' ' + s.kind + ' first_arg=' + s.first_arg); bad++ }
  else used.add(k)
}
exc.forEach((e, k) => { if (!used.has(k)) { console.log('STALE_EXCEPTION ' + e.file + ' ' + e.kind + ' first_arg=' + e.first_arg); bad++ } })

function forbiddenFor(site, name) {
  const roles = new Set()
  for (const r of policy.forbidden || []) {
    const hit = (r.names && r.names.includes(name)) || (r.map && site.via === 'map ' + r.map)
    if (hit) for (const x of r.roles) roles.add(x)
  }
  return [...roles].sort()
}
const q = (v) => "'" + String(v).split("'").join("''") + "'"
const arr = (a) => a === null ? 'null' : 'array[' + a.map(q).join(',') + ']::text[]'
const rows = []
for (const s of sites) {
  if (!s.names) continue
  for (const name of s.names) rows.push('(' + [q(s.file + ':' + s.line), q(name), arr(s.params), q(s.role), arr(forbiddenFor(s, name))].join(', ') + ')')
}
const sql = [
  '-- generated by backend/db/ci/call_contract.mjs — do not edit',
  "\\set ON_ERROR_STOP on",
  'set search_path = pg_catalog, pg_temp;',
  'create temp table cc (site text, fn text, params text[], role text, forbidden text[]);',
  rows.length ? 'insert into cc values\n' + rows.join(',\n') + ';' : '',
  "create temp table pr as select p.oid, p.proname::text as fn, p.pronargs, p.pronargdefaults,",
  "  case when p.proargmodes is null then p.proargnames else (select pg_catalog.array_agg(u.nm order by u.ord) from unnest(p.proargnames, p.proargmodes) with ordinality u(nm, md, ord) where u.md in ('i', 'b', 'v')) end as in_names",
  "  from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace;",
  'create temp table res as select c.site, c.fn, c.role, c.params, c.forbidden,',
  '  exists (select 1 from pr where pr.fn = c.fn) as fn_exists,',
  '  (select pg_catalog.array_agg(pr.oid) from pr where pr.fn = c.fn and (c.params is null or (c.params <@ coalesce(pr.in_names, array[]::text[])',
  '     and coalesce(pr.in_names[1:(pr.pronargs - pr.pronargdefaults)], array[]::text[]) <@ c.params))) as compat',
  '  from cc c;',
  "select case when not fn_exists then 'CALL FAIL ' || site || ' ' || fn || ' :: function missing in public'",
  "  when compat is null then 'CALL FAIL ' || site || ' ' || fn || ' :: no overload accepts params ' || coalesce(params::text, '(unknown)')",
  "  when not (select pg_catalog.bool_or(pg_catalog.has_function_privilege(role, o, 'EXECUTE')) from pg_catalog.unnest(compat) o) then 'CALL FAIL ' || site || ' ' || fn || ' :: ' || role || ' has no EXECUTE'",
  "  when exists (select 1 from pg_catalog.unnest(compat) o, pg_catalog.unnest(forbidden) f where pg_catalog.has_function_privilege(f, o, 'EXECUTE')) then 'CALL FAIL ' || site || ' ' || fn || ' :: forbidden role has EXECUTE (' || forbidden::text || ')'",
  "  else 'CALL PASS ' || site || ' ' || fn || ' ' || role || case when params is null then ' (params not statically known: exception)' else '' end end",
  'from res order by site, fn;',
  "do $d$ begin if exists (select 1 from res where not fn_exists or compat is null) then raise exception 'ZELL_CALL_CONTRACT_FAILED'; end if; end $d$;",
  ''
].join('\n')
fs.writeFileSync(opt.sql, sql)
const counts = { files: files.length, sites: sites.length, ok: sites.filter((s) => s.kind === 'ok').length, params_unknown: sites.filter((s) => s.kind === 'params_unknown').length, name_unparsed: sites.filter((s) => s.kind === 'name_unparsed').length, maps: [...maps.keys()].sort(), checks: rows.length }
console.log('ZELL_CALLS ' + JSON.stringify(counts))
for (const s of sites) console.log('SITE ' + s.kind + ' ' + s.file + ':' + s.line + ' ' + s.role + ' ' + (s.names ? s.names.join(',') : '?') + ' params=' + (s.params ? s.params.join(',') : '?') + ' first_arg=' + s.first_arg)
process.exit(bad ? 1 : 0)
