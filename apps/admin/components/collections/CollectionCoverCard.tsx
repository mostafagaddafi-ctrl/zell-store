'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Upload } from 'lucide-react'
import { removeCollectionCoverAction } from '../../lib/actions'
import type { AdminCollection } from '../../lib/adminData'
import { compressUploadImage } from '../../lib/client/compressImage'
import { uploadCollectionCover } from '../../lib/client/uploadCollectionCover'
import { MAX_UPLOAD_MB } from '../../lib/client/uploadImage'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailureBanner } from '../ui/FailureBanner'
import { Card } from '../ui/Field'

/**
 * صورة غلاف القسم — اختيارية.
 *
 * ⚠️ الرفع والشيل **مستقلين عن زرار حفظ البيانات** فوق، زي بطاقة صور
 *    الموقع: الصورة بتتفعّل لحظة نجاح الرفع.
 *
 * الضغط لـ WebP قبل الرفع (compressUploadImage)، وأي فشل في الضغط
 * بيرجّع الملف الأصلي. التحقق من النوع والحجم والأبعاد على السيرفر
 * إلزامي في الحالتين.
 */
export function CollectionCoverCard({ collection }: { collection: AdminCollection }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const upload = useSaveAction()
  const removal = useSaveAction()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const cover = collection.cover
  const busy = optimizing || upload.state === 'saving' || removal.state === 'saving'

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // تصفير الخانة يسمح باختيار **نفس** الملف تاني بعد الفشل
    event.target.value = ''
    if (!file) return

    setOptimizing(true)
    const uploadFile = await compressUploadImage(file)
    setOptimizing(false)

    void upload.run(() => uploadCollectionCover({ collectionId: collection.id, file: uploadFile }), {
      onSuccess: () => router.refresh(),
    })
  }

  function remove() {
    setConfirmRemove(false)
    void removal.run(() => removeCollectionCoverAction(collection.id), {
      onSuccess: () => router.refresh(),
    })
  }

  const warning = upload.warning ?? removal.warning

  return (
    <Card title="صورة القسم (اختيارية)">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex aspect-[16/9] w-40 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-bg p-2 text-center text-xs text-muted">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.url} alt={cover.alt} className="h-full w-full rounded object-cover" />
            ) : (
              'مفيش غلاف'
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted">
              JPEG أو PNG أو WebP · أقل مقاس 600×300 بكسل · الأفضل صورة عريضة
            </p>
            {cover && cover.width !== null && cover.height !== null ? (
              <p className="text-xs text-muted">
                الحالي: {cover.width}×{cover.height} بكسل
              </p>
            ) : null}
            <p className="text-xs text-muted">
              من غير غلاف، المتجر بيعرض أول صورة لأول منتج ظاهر في القسم تلقائيًا بدل مساحة فاضية.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            {optimizing
              ? 'بيضغط الصورة…'
              : upload.state === 'saving'
                ? 'بيرفع…'
                : cover
                  ? 'استبدال الصورة'
                  : 'ارفع صورة'}
          </Button>
          {cover ? (
            <Button variant="ghost" size="sm" disabled={!mutationsOn || busy} onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              شيل الصورة
            </Button>
          ) : null}
          {upload.state === 'saved' ? <span className="text-xs font-semibold text-ok">الصورة اتحفظت</span> : null}
          {removal.state === 'saved' ? <span className="text-xs font-semibold text-ok">الصورة اتشالت</span> : null}
        </div>

        <p className="text-xs text-muted">
          أقصى حجم {MAX_UPLOAD_MB} ميجابايت · بتتضغط WebP قبل الرفع · الصورة القديمة مابتتحذفش فورًا، بتتسجّل
          للتنظيف
        </p>

        {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}

        <FailureBanner failure={upload.failure} onRetry={upload.retry} onDiscardAndRefresh={() => router.refresh()} />
        <FailureBanner
          failure={removal.failure}
          onRetry={removal.retry}
          onDiscardAndRefresh={() => router.refresh()}
        />
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="شيل صورة القسم؟"
        message="المتجر هيرجع يعرض أول صورة لأول منتج في القسم. الملف بيتسجّل للتنظيف ومش بيتمسح فورًا."
        confirmLabel="شيل الصورة"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
    </Card>
  )
}
