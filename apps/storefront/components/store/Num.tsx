const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** ١٢٣ بدل 123 — العرض بس، الحسابات كلها بأرقام لاتينية. */
export function toArabicDigits(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += ARABIC_DIGITS.charAt(ch.charCodeAt(0) - 48)
    else out += ch
  }
  return out
}

export function Num({ children }: { children: string | number }) {
  return <span className="tabular-nums">{toArabicDigits(String(children))}</span>
}
