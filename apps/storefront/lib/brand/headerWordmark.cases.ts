/**
 * LOGO-TEXT — حالات لوجو الهيدر «my» + «ظل» (pnpm --filter @zell/storefront cases، suite brand).
 * B01 الترتيب والنص · B02 الأحجام = ظبط المالك (والموبايل مشتق منه) · B03 العرض بنفس النسبة ·
 * B04 ملف «ظل» نفسه (PNG 232×204 RGBA وبصمته) · B05 القص سليم: «ظل» موجودة، وآخر الصورة شفاف (مفيش جزء من أيقونة الشباك
 * ولا قطع في الرسمة) · B06 الهيدر بيعرض HeaderWordmark ومابيعرضش صورة اللوجو المرفوعة.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { HEADER_WORDMARK, zillWidthPx } from './headerWordmark'

export type HeaderWordmarkCaseFailure = { name: string; expected: string; actual: string }

const failures: HeaderWordmarkCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/** فك PNG (8 بت RGBA من غير interlace) لمصفوفة بكسلات — للفحص بس. */
function decodeRgba(file: Buffer): { w: number; h: number; px: Uint8Array } {
  const w = file.readUInt32BE(16)
  const h = file.readUInt32BE(20)
  const parts: Buffer[] = []
  let off = 8
  while (off < file.length) {
    const len = file.readUInt32BE(off)
    const type = file.toString('latin1', off + 4, off + 8)
    if (type === 'IDAT') parts.push(file.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = w * 4
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0
      const a = x >= 4 ? (px[y * stride + x - 4] ?? 0) : 0
      const b = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0
      const c = x >= 4 && y > 0 ? (px[(y - 1) * stride + x - 4] ?? 0) : 0
      let out = v
      if (filter === 1) out = v + a
      else if (filter === 2) out = v + b
      else if (filter === 3) out = v + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      px[y * stride + x] = out & 255
    }
  }
  return { w, h, px }
}

export function runHeaderWordmarkCases(): { passed: number; failures: HeaderWordmarkCaseFailure[] } {
  check('B01 order (dir=ltr): my on the left, ظل at the far right', HEADER_WORDMARK.order, ['my', 'zill'])
  check('B01 my text', HEADER_WORDMARK.myText, 'my')

  check('B02 desktop = owner tuning', HEADER_WORDMARK.desktop, { myPx: 24, myShiftPx: 1, zillHeightPx: 39, zillShiftPx: 4, gapPx: 3 })
  check('B02 mobile = desktop scaled (my x0.85, the rest x0.83, rounded)', HEADER_WORDMARK.mobile, {
    myPx: Math.round(24 * 0.85),
    myShiftPx: Math.round(1 * 0.83),
    zillHeightPx: Math.round(39 * 0.83),
    zillShiftPx: Math.round(4 * 0.83),
    gapPx: Math.round(3 * 0.83),
  })

  check('B03 ظل width keeps the image ratio (desktop, mobile)', [zillWidthPx(39), zillWidthPx(32)], [44, 36])

  const file = readFileSync(join(process.cwd(), 'public', HEADER_WORDMARK.src))
  check('B04 PNG signature', file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  check('B04 232x204, 8-bit RGBA, no interlace', [file.readUInt32BE(16), file.readUInt32BE(20), file[24], file[25], file[28]], [232, 204, 8, 6, 0])
  check('B04 sha256 = HEADER_WORDMARK.sha256', createHash('sha256').update(file).digest('hex'), HEADER_WORDMARK.sha256)

  const { w, h, px } = decodeRgba(file)
  let opaque = 0
  let edge = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = px[(y * w + x) * 4 + 3] ?? 0
      if (alpha > 16) {
        opaque += 1
        if (x >= w - 10) edge += 1
      }
    }
  }
  check('B05 ظل is there (thousands of visible pixels)', opaque > 5000, true)
  check('B05 last 10 columns are fully transparent (no window icon, nothing cut)', edge, 0)

  const header = readFileSync(join(process.cwd(), 'components', 'store', 'SiteHeader.tsx'), 'utf8')
  check('B06 header renders HeaderWordmark', header.includes('<HeaderWordmark'), true)
  check('B06 header no longer renders the uploaded logo or the old wordmark', /logo\.url|LogoWordmark|logo=\{/.test(header), false)

  return { passed, failures }
}
