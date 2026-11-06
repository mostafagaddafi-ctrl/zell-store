#!/usr/bin/env node
// scripts/check-security-headers.mjs — COOKIES-HEADERS §٤-٢. بعد next build: بيقرا apps/<app>/.next/routes-manifest.json
// ويحسب الـ headers النهائية لمسارات عيّنة (الـ rules بالترتيب، ولو rule-تين اتطابقوا على نفس المفتاح الأخيرة بتكسب، زي Next).
// من غير شبكة ومن غير سيرفر. بيفشل كمان لو أي rule بتحط Content-Security-Policy أو Strict-Transport-Security
// (HSTS جاي من Vercel على مستوى الدومين؛ وجوده في رد المنصة مش جزء من الفحص ده).
// الاستخدام:  node scripts/check-security-headers.mjs storefront|admin
// سطر النتيجة:  ZELL_SECURITY_HEADERS_RESULT app=<app> pass=<n> fail=<n>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = process.argv[2]

const BASE = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}
const RECEIPT = { ...BASE, 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' }
const PATHS = {
  storefront: [
    ['/', BASE],
    ['/products', BASE],
    ['/product/123', BASE],
    ['/collection/abc', BASE],
    ['/cart', BASE],
    ['/checkout', BASE],
    ['/track', BASE],
    ['/robots.txt', BASE],
    ['/order/ZL-2026-0001', RECEIPT],
  ],
  admin: [
    ['/', BASE],
    ['/login', BASE],
    ['/orders', BASE],
    ['/orders/ZL-2026-0001', BASE],
    ['/auth/signout', BASE],
  ],
}
const FORBIDDEN = ['content-security-policy', 'strict-transport-security']

if (!Object.prototype.hasOwnProperty.call(PATHS, app)) {
  console.log('usage: node scripts/check-security-headers.mjs storefront|admin')
  process.exit(2)
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps', app, '.next', 'routes-manifest.json'), 'utf8'))
const rules = Array.isArray(manifest.headers) ? manifest.headers : []
let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log('HEADERS PASS ' + name)
  } else {
    fail++
    console.log('HEADERS FAIL ' + name + ' :: ' + detail)
  }
}

check(app + ' has header rules', rules.length > 0, 'routes-manifest.json has no headers')
const forbidden = []
const conditional = []
for (const rule of rules) {
  if (rule.has || rule.missing) conditional.push(rule.source)
  for (const h of rule.headers || []) if (FORBIDDEN.includes(String(h.key).toLowerCase())) forbidden.push(rule.source + ' ' + h.key)
}
check(app + ' no rule sets Content-Security-Policy or Strict-Transport-Security', forbidden.length === 0, forbidden.join(', '))
check(app + ' no conditional (has/missing) rule (not simulated here)', conditional.length === 0, conditional.join(', '))

for (const [p, expected] of PATHS[app]) {
  const final = {}
  for (const rule of rules) {
    if (!new RegExp(rule.regex).test(p)) continue
    for (const h of rule.headers || []) final[String(h.key).toLowerCase()] = h.value
  }
  for (const [key, value] of Object.entries(expected)) {
    check(app + ' ' + p + ' ' + key, final[key] === value, 'got ' + JSON.stringify(final[key] ?? null) + ', expected ' + JSON.stringify(value))
  }
}

console.log('ZELL_SECURITY_HEADERS_RESULT app=' + app + ' pass=' + pass + ' fail=' + fail)
process.exitCode = fail > 0 || pass === 0 ? 1 : 0
