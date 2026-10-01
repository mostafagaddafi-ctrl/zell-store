/**
 * أساسيات تشفيرية مشتركة بين الـmiddleware والراوت وصفحة الإيصال.
 *
 * 🔒 مفيش أي سر مخزّن ولا ثابت هنا، ومفيش أي متغير بيئة. الملف ده بيتحمّل
 *    في Edge (الـmiddleware) و Node (الراوت)، فمستخدم Web Crypto بس.
 */

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** عدد بايتات عشوائية → base64url بدون padding. */
export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 hex صغير — نفس الصيغة اللي قيود الداتابيز بتفرضها. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(new Uint8Array(digest))
}
