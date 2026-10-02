'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { compressUploadImage } from '../../lib/client/compressImage'
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
  const { state, failure, warning, run, retry } = useSaveAction()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [altText, setAltText] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const altRef = useRef(altText)
  altRef.current = altText

  const busy = optimizing || state === 'saving'

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // تصفير الخانة يسمح باختيار **نفس** الملف تاني بعد الفشل
    event.target.value = ''
    if (!file) return

    setOptimizing(true)
    const uploadFile = await compressUploadImage(file)
    setOptimizing(false)

    void run(() => uploadProductImage({ productId, file: uploadFile, altText: altRef.current }), {
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
          {optimizing ? 'بيضغط الصورة…' : state === 'saving' ? 'بيرفع…' : 'ارفع صورة'}
        </Button>
      </div>

      <p className="text-xs text-muted">
        JPEG أو PNG أو WebP أو AVIF · أقصى {MAX_UPLOAD_MB} ميجابايت
        {state === 'saved' ? <span className="ms-1 font-semibold text-ok">· الصورة اترفعت</span> : null}
      </p>

      {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </div>
  )
}
