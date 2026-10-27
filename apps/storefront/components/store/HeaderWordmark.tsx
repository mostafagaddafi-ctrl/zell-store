import Image from 'next/image'
import { HEADER_WORDMARK, zillWidthPx, type WordmarkSize } from '../../lib/brand/headerWordmark'
import { cn } from '../../lib/cn'

/**
 * لوجو الهيدر (LOGO-TEXT): «my» نص + «ظل» من رسمة اللوجو الأصلية، من غير أيقونة الشباك.
 * dir=ltr علشان «my» تبقى على الشمال و«ظل» في أقصى اليمين. الأرقام في lib/brand/headerWordmark.ts.
 * aria-hidden: الرابط اللي حواليه عليه aria-label باسم المتجر.
 */
function Wordmark({ size, className }: { size: WordmarkSize; className: string }) {
  const zillWidth = zillWidthPx(size.zillHeightPx)
  return (
    <span dir="ltr" aria-hidden="true" className={cn('items-center', className)} style={{ gap: size.gapPx }}>
      <span
        className="font-extrabold leading-none text-brand"
        style={{ fontSize: size.myPx, transform: 'translateY(' + size.myShiftPx + 'px)' }}
      >
        {HEADER_WORDMARK.myText}
      </span>
      <Image
        src={HEADER_WORDMARK.src}
        alt=""
        width={zillWidth}
        height={size.zillHeightPx}
        priority
        className="shrink-0 mix-blend-multiply"
        style={{ width: zillWidth, height: size.zillHeightPx, transform: 'translateY(' + size.zillShiftPx + 'px)' }}
      />
    </span>
  )
}

export function HeaderWordmark() {
  return (
    <>
      <Wordmark size={HEADER_WORDMARK.mobile} className="inline-flex sm:hidden" />
      <Wordmark size={HEADER_WORDMARK.desktop} className="hidden sm:inline-flex" />
    </>
  )
}
