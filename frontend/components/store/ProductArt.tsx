import { useState } from 'react'
import { FilmIllustration, guessFilmKind } from './FilmIllustration'

/**
 * صورة المنتج: الصورة الحقيقية لو موجودة، وإلا رسمة SVG موضّحة للنوع.
 * كده الصفحة مافيهاش صور مكسورة ولا مربعات فاضية.
 */
export function ProductArt({
  src,
  alt,
  nameEn = null,
  seed,
  className,
}: {
  src: string | null
  alt: string
  nameEn?: string | null
  seed: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const box = className ?? 'h-full w-full'

  if (src && !failed) {
    return (
      <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`${box} object-cover`} />
    )
  }

  return (
    <span className={`${box} block overflow-hidden bg-[#f3efe9]`} role="img" aria-label={alt}>
      <FilmIllustration kind={guessFilmKind(alt, nameEn, seed)} className="h-full w-full object-cover" />
    </span>
  )
}
