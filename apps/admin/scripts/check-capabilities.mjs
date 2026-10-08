#!/usr/bin/env node
/**
 * 0021-P (ب1) — قايمة الصلاحيات في الكود = catalog الداتابيز بالظبط (المفتاح والفئة).
 *
 *   الكود : apps/admin/lib/access/capabilities.ts (ZELL_CAPABILITIES + CAPABILITY_CATEGORY)
 *   الـ SQL: backend/db/migrations/0021p_erp_access.sql + 0021p_zell_erp_access.sql
 *            (insert into public.erp_capabilities (key, category, description) values ...)
 *
 * سطر النتيجة:  ZELL_ACCESS_CATALOG ok count=<n>   أو   ZELL_ACCESS_CATALOG mismatch ...  (exit 1)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(appRoot, '..', '..')

function fromTs() {
  const text = readFileSync(join(appRoot, 'lib/access/capabilities.ts'), 'utf8')
  const listStart = text.indexOf('export const ZELL_CAPABILITIES = [')
  const listEnd = text.indexOf('] as const', listStart)
  if (listStart < 0 || listEnd < 0) throw new Error('ZELL_CAPABILITIES not found')
  const keys = [...text.slice(listStart, listEnd).matchAll(/'([a-z0-9_.]+)'/g)].map((m) => m[1])
  const mapStart = text.indexOf('export const CAPABILITY_CATEGORY')
  const mapEnd = text.indexOf('\n}\n', mapStart)
  if (mapStart < 0 || mapEnd < 0) throw new Error('CAPABILITY_CATEGORY not found')
  const cats = new Map([...text.slice(mapStart, mapEnd).matchAll(/'([a-z0-9_.]+)':\s*'(operational|sales|owner)'/g)].map((m) => [m[1], m[2]]))
  return { keys, cats }
}

function fromSql() {
  const out = new Map()
  for (const file of ['0021p_erp_access.sql', '0021p_zell_erp_access.sql']) {
    const text = readFileSync(join(repoRoot, 'backend/db/migrations', file), 'utf8')
    const marker = 'insert into public.erp_capabilities (key, category, description) values'
    let at = text.indexOf(marker)
    if (at < 0) throw new Error('capability insert not found in ' + file)
    while (at >= 0) {
      const end = text.indexOf(';', at)
      for (const m of text.slice(at, end).matchAll(/\('([a-z0-9_.]+)',\s*'(operational|sales|owner)'/g)) {
        if (out.has(m[1])) throw new Error('duplicate capability in SQL: ' + m[1])
        out.set(m[1], m[2])
      }
      at = text.indexOf(marker, end)
    }
  }
  return out
}

const ts = fromTs()
const sql = fromSql()
const problems = []
if (new Set(ts.keys).size !== ts.keys.length) problems.push('duplicate keys in ZELL_CAPABILITIES')
for (const key of ts.keys) {
  if (!sql.has(key)) problems.push('only in code: ' + key)
  else if (ts.cats.get(key) !== sql.get(key)) problems.push('category differs: ' + key + ' code=' + ts.cats.get(key) + ' sql=' + sql.get(key))
}
for (const key of sql.keys()) if (!ts.keys.includes(key)) problems.push('only in SQL: ' + key)
for (const key of ts.cats.keys()) if (!ts.keys.includes(key)) problems.push('category without key: ' + key)
if (ts.cats.size !== ts.keys.length) problems.push('CAPABILITY_CATEGORY size ' + ts.cats.size + ' != ' + ts.keys.length)

if (problems.length > 0) {
  for (const p of problems) console.log('ZELL_ACCESS_CATALOG_PROBLEM ' + p)
  console.log('ZELL_ACCESS_CATALOG mismatch problems=' + problems.length)
  process.exit(1)
}
console.log('ZELL_ACCESS_CATALOG ok count=' + ts.keys.length)
