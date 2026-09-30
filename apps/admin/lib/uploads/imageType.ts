import 'server-only'

/**
 * كشف نوع الصورة من **البايتات** بس.
 *
 * ⚠️ اسم الملف و MIME الجاي من المتصفح **بيتجاهلوا تمامًا**. الاتنين
 * بيتحكم فيهم العميل، فأي قرار مبني عليهم مش قرار أمني.
 *
 * content_type اللي بيتخزّن وامتداد الملف الاتنين بيتحسبوا من هنا،
 * فملف اسمه evil.php.jpg بيبقى .jpg على مسار UUID.
 */

export type DetectedImage = { contentType: string; extension: string }

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const AVIF_BRANDS = new Set(['avif', 'avis'])

function matches(bytes: Uint8Array, signature: number[], offset: number): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    const actual = bytes[offset + i]
    const expected = signature[i]
    if (actual === undefined || expected === undefined) return false
    if (actual !== expected) return false
  }
  return true
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i] ?? 0)
  }
  return out
}

function readUint32(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) return 0
  return a * 0x1000000 + b * 0x10000 + c * 0x100 + d
}

/**
 * AVIF = ISOBMFF. صندوق ftyp في الأول، وفيه major brand وبعده
 * compatible brands. بنفحص الاتنين لأن فيه ملفات AVIF صالحة
 * major brand بتاعها mif1 و avif في القائمة المتوافقة.
 */
function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 4) !== 'ftyp') return false
  if (AVIF_BRANDS.has(ascii(bytes, 8, 4))) return true

  const boxSize = readUint32(bytes, 0)
  const limit = Math.min(boxSize > 8 ? boxSize : bytes.length, bytes.length)
  // major brand عند ٨، minor version عند ١٢، والمتوافقة من ١٦
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    if (AVIF_BRANDS.has(ascii(bytes, offset, 4))) return true
  }
  return false
}

export function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (matches(bytes, JPEG, 0)) return { contentType: 'image/jpeg', extension: 'jpg' }
  if (matches(bytes, PNG, 0)) return { contentType: 'image/png', extension: 'png' }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  if (isAvif(bytes)) return { contentType: 'image/avif', extension: 'avif' }
  return null
}
