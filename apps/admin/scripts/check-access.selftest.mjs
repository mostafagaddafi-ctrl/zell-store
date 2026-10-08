#!/usr/bin/env node
/**
 * 0021-P (ب1) — اختبار ذاتي لفاحص الحراس: الحالات الغلط لازم تفشل بالقاعدة المتوقعة بالظبط،
 * والحالات الصح لازم تعدّي.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkAccess } from './check-access.mjs'

const BASE = {
  'lib/access/capabilities.ts': "export const ZELL_CAPABILITIES = ['cap.a', 'cap.b'] as const\n",
  'lib/access/instance.ts': 'export {}\n',
}

const PAGE_IMPORT = "import { pageWithAccess } from '../../lib/access/instance'\n"
const ROUTE_IMPORT = "import { routeWithAccess } from '../../../lib/access/instance'\n"
const ACTION_IMPORT = "import { actionWithAccess, formActionWithAccess } from './access/instance'\n"
const VALID_PAGE = PAGE_IMPORT + "export default pageWithAccess('cap.a', async () => null)\n"
const VALID_GET = ROUTE_IMPORT + "export const GET = routeWithAccess('cap.a', { mutates: false }, async () => new Response('ok'))\n"

const CASES = [
  { name: 'valid page + metadata', files: { 'app/x/page.tsx': PAGE_IMPORT + "export const metadata = { title: 'x' }\nexport default pageWithAccess('cap.a', async () => null)\n" }, expect: [] },
  { name: 'valid aliased wrapper', files: { 'app/x/page.tsx': "import { pageWithAccess as guard } from '../../lib/access/instance'\nexport default guard('cap.b', async () => null)\n" }, expect: [] },
  { name: 'valid layout', files: { 'app/x/layout.tsx': "import { layoutWithSession } from '../../lib/access/instance'\nexport default layoutWithSession(async (_c, p) => p.children)\n" }, expect: [] },
  { name: 'valid route + config', files: { 'app/api/x/route.ts': ROUTE_IMPORT + "export const dynamic = 'force-dynamic'\nexport const GET = routeWithAccess('cap.a', { mutates: false }, async () => new Response('ok'))\nexport const POST = routeWithAccess('cap.b', { mutates: true }, async () => new Response('ok'))\n" }, expect: [] },
  { name: 'valid server actions + type export', files: { 'lib/actions.ts': "'use server'\n" + ACTION_IMPORT + "export type R = { ok: boolean }\nexport const a = actionWithAccess('cap.a', { mutates: true }, async () => ({ ok: true }))\nexport const b = formActionWithAccess('cap.b', { mutates: true }, async () => {})\n" }, expect: [] },
  { name: 'valid mutation import from server module', files: { 'lib/mutations/x.ts': 'export const saveX = 1\n', 'lib/actions.ts': "'use server'\n" + ACTION_IMPORT + "import { saveX } from './mutations/x'\nexport const a = actionWithAccess('cap.a', { mutates: true }, async () => saveX)\n" }, expect: [] },
  { name: 'valid type-only mutation import in component', files: { 'lib/mutations/x.ts': 'export type T = number\n', 'components/C.tsx': "import type { T } from '../lib/mutations/x'\nexport type U = T\n" }, expect: [] },

  { name: 'page: plain default function', files: { 'app/x/page.tsx': 'export default async function Page() { return null }\n' }, expect: ['PAGE_NOT_WRAPPED'] },
  { name: 'page: missing default export', files: { 'app/x/page.tsx': 'export const metadata = {}\n' }, expect: ['PAGE_NOT_WRAPPED'] },
  { name: 'page: extra generateMetadata export', files: { 'app/x/page.tsx': VALID_PAGE + 'export async function generateMetadata() { return {} }\n' }, expect: ['PAGE_EXTRA_EXPORT'] },
  { name: 'page: local fake wrapper', files: { 'app/x/page.tsx': "function pageWithAccess(_c, f) { return f }\nexport default pageWithAccess('cap.a', async () => null)\n" }, expect: ['WRAPPER_NOT_FROM_ACCESS_MODULE'] },
  { name: 'page: raw guard import', files: { 'app/x/page.tsx': "import { requireAdminPage } from '../../lib/auth/guards'\n" + VALID_PAGE }, expect: ['RAW_GUARD_IMPORT'] },
  { name: 'layout: plain function', files: { 'app/x/layout.tsx': 'export default function L(p) { return p.children }\n' }, expect: ['LAYOUT_NOT_WRAPPED'] },
  { name: 'route: plain function GET', files: { 'app/api/x/route.ts': "export async function GET() { return new Response('x') }\n" }, expect: ['ROUTE_NOT_WRAPPED'] },
  { name: 'route: other call', files: { 'app/api/x/route.ts': "import { wrap } from '../../../lib/other'\nexport const GET = wrap(async () => new Response('x'))\n" }, expect: ['ROUTE_NOT_WRAPPED'] },
  { name: 'route: wrong wrapper kind', files: { 'app/api/x/route.ts': "import { pageWithAccess } from '../../../lib/access/instance'\nexport const GET = pageWithAccess('cap.a', async () => null)\n" }, expect: ['ROUTE_NOT_WRAPPED'] },
  { name: 'route: wrapper from wrong module', files: { 'app/api/x/route.ts': "import { routeWithAccess } from '../../../lib/other'\nexport const GET = routeWithAccess('cap.a', { mutates: false }, async () => new Response('x'))\n" }, expect: ['WRAPPER_NOT_FROM_ACCESS_MODULE'] },
  { name: 'route: extra export', files: { 'app/api/x/route.ts': VALID_GET + 'export function helper() { return 1 }\n' }, expect: ['ROUTE_EXTRA_EXPORT'] },
  { name: 'action: plain async function', files: { 'lib/actions.ts': "'use server'\nexport async function doIt() { return 1 }\n" }, expect: ['ACTION_NOT_WRAPPED'] },
  { name: 'action: default export', files: { 'lib/actions.ts': "'use server'\nexport default async function doIt() { return 1 }\n" }, expect: ['ACTION_NOT_WRAPPED'] },
  { name: 'action: re-export', files: { 'lib/actions.ts': "'use server'\nexport { x as y } from './other'\n" }, expect: ['ACTION_REEXPORT'] },
  { name: 'action: unknown capability', files: { 'lib/actions.ts': "'use server'\n" + ACTION_IMPORT + "export const a = actionWithAccess('cap.zzz', { mutates: false }, async () => 1)\n" }, expect: ['UNKNOWN_CAPABILITY'] },
  { name: 'action: capability not literal', files: { 'lib/actions.ts': "'use server'\n" + ACTION_IMPORT + "const C = 'cap.a'\nexport const a = actionWithAccess(C, { mutates: false }, async () => 1)\n" }, expect: ['CAPABILITY_NOT_LITERAL'] },
  { name: 'action: use server file under app', files: { 'app/x/actions.ts': "'use server'\nexport async function doIt() { return 1 }\n" }, expect: ['ACTION_NOT_WRAPPED'] },
  { name: 'inline use server in component', files: { 'components/C.tsx': "export function C() {\n  async function act() {\n    'use server'\n    return 1\n  }\n  return act\n}\n" }, expect: ['INLINE_USE_SERVER'] },
  { name: 'mutation import in component', files: { 'lib/mutations/x.ts': 'export const saveX = 1\n', 'components/C.tsx': "import { saveX } from '../lib/mutations/x'\nexport const C = saveX\n" }, expect: ['MUTATION_IMPORT_OUTSIDE'] },
  { name: 'lib/data may import mutations (value)', files: { 'lib/mutations/x.ts': 'export const saveX = 1\n', 'lib/data/y.ts': "import { saveX } from '../mutations/x'\nexport const y = saveX\n" }, expect: [] },
  { name: 'type-only mutation import in component is fine', files: { 'lib/mutations/x.ts': 'export type X = number\n', 'components/C.tsx': "import type { X } from '../lib/mutations/x'\nexport const C: X = 1\n" }, expect: [] },
  { name: 'action: mutates true with a known literal is fine', files: { 'lib/actions.ts': "'use server'\n" + ACTION_IMPORT + "export const a = actionWithAccess('cap.b', { mutates: true }, async () => 1)\n" }, expect: [] },
]

let pass = 0
let fail = 0
for (const c of CASES) {
  const root = mkdtempSync(join(tmpdir(), 'zell-access-selftest-'))
  try {
    for (const [path, content] of Object.entries({ ...BASE, ...c.files })) {
      const full = join(root, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    const got = [...new Set(checkAccess(root).findings.map((f) => f.rule))].sort()
    const expected = [...c.expect].sort()
    const ok = got.length === expected.length && got.every((r, i) => r === expected[i])
    if (ok) pass++
    else fail++
    console.log('SELFTEST ' + (ok ? 'PASS' : 'FAIL') + ' ' + c.name + ' expected=[' + expected.join(',') + '] got=[' + got.join(',') + ']')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
console.log('ZELL_ACCESS_SELFTEST_RESULT pass=' + pass + ' fail=' + fail)
if (fail > 0 || pass === 0) process.exit(1)
