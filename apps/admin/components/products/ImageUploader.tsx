'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { MAX_UPLOAD_MB, uploadProductImage } from '../../lib/client/uploadImage'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { inputClasses } from '../ui/Field'

/**
 * رفع صورة للمعرض.
 *
 * الملف **مش** بيتخزّن في state: الـ thunk بيقفل على الـ File نفسه،
 * فـ «حاول تاني» بتعيد نفس الملف بالظبط. نص البديل بيتقرا من ref
 * عشان لو المستخدم عدّله بعد الفشل، الإعادة تبعت الجديد.
 */
export function ImageUploader({ productId }: { productId: number }) {
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

    void run(() => uploadProductImage({ productId, file, altText: altRef.current }), {
      onSuccess: () => {
        setAltText('')
        router.refresh()
      },
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={altText}
          onChange={(event) => setAltText(event.target.value)}
          placeholder="نص بديل (اختياري)"
          aria-label="نص بديل للصورة"
          disabled={!mutationsOn || busy}
          className={inputClasses + ' h-9 w-full sm:w-56'}
        />

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={choose}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />

        <Button disabled={!mutationsOn || busy} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ? 'بيرفع…' : 'ارفع صورة'}
        </Button>
      </div>

      <p className="text-xs text-muted">
        JPEG أو PNG أو WebP أو AVIF · أقصى {MAX_UPLOAD_MB} ميجابايت
        {state === 'saved' ? <span className="ms-1 font-semibold text-ok">· الصورة اترفعت</span> : null}
      </p>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </div>
  )
}
