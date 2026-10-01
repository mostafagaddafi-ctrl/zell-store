'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import type { AdminImage } from '../../lib/adminData'
import { MAX_UPLOAD_MB } from '../../lib/client/uploadImage'
import { uploadSiteImage, type SiteImageKind } from '../../lib/client/uploadSiteImage'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card } from '../ui/Field'

/**
 * بطاقة صورة موقع (اللوجو / صورة الواجهة).
 *
 * ⚠️ الرفع **مستقل تمامًا عن زرار الحفظ** تحت. الصورة بتتفعّل لحظة
 *    نجاح الرفع، من غير ما تستنى حفظ باقي الهوية — عشان كده مكتوب
 *    في البطاقة صراحة.
 *
 * الملف **مش** بيتخزّن في state: الـ thunk بيقفل على الـ File نفسه
 * فـ «حاول تاني» بتعيد نفس الملف بالظبط.
 */

type Props = {
  kind: SiteImageKind
  title: string
  image: AdminImage | null
  /** متطلبات الملف — بتتعرض للمستخدم زي ما هي. */
  requirements: string
  emptyLabel: string
  previewClassName: string
  accept: string
}

export function SiteImageCard({
  kind,
  title,
  image,
  requirements,
  emptyLabel,
  previewClassName,
  accept,
}: Props) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [altText, setAltText] = useState('')
  const altRef = useRef(altText)
  altRef.current = altText

  const busy = state === 'saving'

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // تصفير الخانة يسمح باختيار **نفس** الملف تاني بعد الفشل
    event.target.value = ''
    if (!file) return

    void run(() => uploadSiteImage({ kind, file, altText: altRef.current }), {
      onSuccess: () => {
        setAltText('')
        router.refresh()
      },
    })
  }

  const squareWarning =
    kind === 'logo' &&
    image !== null &&
    image.width !== null &&
    image.height !== null &&
    image.width <= image.height * 1.3

  return (
    <Card title={title}>
      <div className="space-y-3">
        <div className="flex items-start gap-4">
          <div
            className={
              'flex shrink-0 items-center justify-center rounded border border-border bg-bg text-center text-xs text-muted ' +
              previewClassName
            }
          >
            {image?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={image.alt}
                className={'h-full w-full p-1 ' + (image.fit === 'cover' ? 'object-cover' : 'object-contain')}
              />
            ) : (
              emptyLabel
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <p className="text-xs text-muted">{requirements}</p>
            {image && image.width !== null && image.height !== null ? (
              <p className="text-xs text-muted">
                الحالي: {image.width}×{image.height} بكسل
              </p>
            ) : null}
            {squareWarning ? (
              <p className="text-xs font-semibold text-danger">
                الملف الحالي قريب من المربع، فالشعار بيبان صغير في الهيدر. ارفع نسخة أفقية مقصوصة.
              </p>
            ) : null}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={choose}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!mutationsOn || busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? 'بيرفع…' : image ? 'استبدال الصورة' : 'ارفع صورة'}
          </Button>
          {state === 'saved' ? (
            <span className="text-xs font-semibold text-ok">الصورة اتفعّلت</span>
          ) : null}
        </div>

        <p className="text-xs text-muted">
          أقصى حجم {MAX_UPLOAD_MB} ميجابايت · الرفع بيتفعّل فورًا من غير زرار الحفظ · الصورة القديمة
          مابتتحذفش، بتتسجّل للتنظيف · ظهور التغيير على المتجر ممكن ياخد لحد ٥ دقائق بسبب الكاش
        </p>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
