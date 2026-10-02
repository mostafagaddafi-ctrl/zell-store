'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Star, Trash2 } from 'lucide-react'
import { reorderImagesAction, setImageFitAction, setPrimaryImageAction } from '../../lib/actions'
import type { AdminImage, ImageFit } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { cn } from '../../lib/cn'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { FailureBanner } from '../ui/FailureBanner'
import { ImageUploader } from './ImageUploader'

const FITS: Array<{ value: ImageFit; label: string; hint: string }> = [
  { value: 'cover', label: 'ملء الإطار', hint: 'مشهد الشباك' },
  { value: 'contain', label: 'الصورة كاملة', hint: 'الرول والخامة' },
]

/**
 * الرفع بيمر على راوت سيرفر في اللوحة، والسيرفر هو اللي بيبني المسار
 * ويتحقق من النوع والحجم — المتصفح مايلمسش Storage بمفتاح قوي.
 * الرفع والحذف لسه ما اتعملوش.
 *
 * معرّفات الصور **نصوص** (bigint في Postgres) من أول القراءة لحد الكتابة.
 */
export function ImageManager({ productId, images }: { productId: number; images: AdminImage[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry } = useSaveAction()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  /**
   * ⚠️ العرض هنا بترتيب **sortOrder تصاعدي** — مش الرئيسية الأول.
   *
   * طبقة القراءة بترتب is_primary.desc قبل sort_order، وده ترتيب عرض
   * مناسب للمتجر. لو الأسهم اشتغلت على ترتيب العرض ده، كل إعادة ترتيب
   * كانت هتثبّت الرئيسية في sort_order = 0 — يعني قاعدة عرض بتكتب في
   * البيانات من ورا المستخدم.
   *
   * دلوقتي: الأسهم بتحرّك الصورة اللي المستخدم شايفها، والـ payload
   * مطابق للعرض، وتغيير الرئيسية مابيعيدش الترتيب.
   */
  const ordered = [...images].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, undefined, { numeric: true }),
  )
  const orderedRef = useRef(ordered)
  orderedRef.current = ordered

  const busy = state === 'saving'

  function changeFit(image: AdminImage, fit: ImageFit) {
    if (image.fit === fit) return
    void run(() => setImageFitAction(image.id, fit, image.updatedAt), { onSuccess: () => router.refresh() })
  }

  /**
   * ⚠️ مفيش أي تحديث محلي هنا.
   * العملية بتغيّر أكتر من صف (القديمة ترجع contain والجديدة تبقى cover)،
   * فأي patch لحقل واحد بيعرض حالة غلط. القراءة كاملة من السيرفر.
   */
  function makePrimary(image: AdminImage) {
    void run(() => setPrimaryImageAction(productId, image.id), { onSuccess: () => router.refresh() })
  }

  function move(index: number, delta: number) {
    const ids = orderedRef.current.map((item) => item.id)
    const target = index + delta
    const from = ids[index]
    const to = ids[target]
    if (from === undefined || to === undefined) return

    ids[index] = to
    ids[target] = from

    void run(() => reorderImagesAction(productId, ids), { onSuccess: () => router.refresh() })
  }

  if (ordered.length === 0) {
    return (
      <div className="space-y-3">
        {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
        <EmptyState
          title="مفيش صور للمنتج ده"
          description="الصورة الرئيسية بتظهر في كارت المتجر، والباقي في معرض صفحة المنتج."
          action={<ImageUploader productId={productId} />}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {ordered.length} صورة · الرئيسية هي اللي بتظهر في كارت المتجر
          {busy ? <span className="ms-1">· بيحفظ…</span> : null}
        </p>
        <ImageUploader productId={productId} />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((image, index) => (
          <li key={image.id} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="relative aspect-square bg-bg">
              {image.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.url}
                  alt={image.alt}
                  className={cn('h-full w-full', image.fit === 'cover' ? 'object-cover' : 'object-contain p-3')}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted">
                  مفيش رابط للصورة
                </div>
              )}

              {image.isPrimary ? (
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-brand px-1.5 py-0.5 text-[11px] font-bold text-brand-fg">
                  <Star className="h-3 w-3" />
                  رئيسية
                </span>
              ) : null}

              <span className="absolute left-2 top-2 rounded bg-fg/70 px-1.5 py-0.5 text-[11px] font-bold text-bg">
                {index + 1}
              </span>
            </div>

            <div className="space-y-2.5 p-2.5">
              <p className="truncate text-xs text-muted" title={image.alt}>
                {image.alt}
              </p>

              <div className="flex gap-1">
                {FITS.map((fit) => (
                  <button
                    key={fit.value}
                    type="button"
                    disabled={!mutationsOn || busy}
                    onClick={() => changeFit(image, fit.value)}
                    title={mutationsOn ? fit.hint : fit.hint + ' — التعديلات موقوفة'}
                    className={cn(
                      'flex-1 rounded border px-1.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed',
                      image.fit === fit.value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted',
                    )}
                  >
                    {fit.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-1">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mutationsOn || busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="تحريك قبل"
                    className="h-7 w-7 px-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mutationsOn || busy || index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="تحريك بعد"
                    className="h-7 w-7 px-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!mutationsOn || busy || image.isPrimary}
                    onClick={() => makePrimary(image)}
                  >
                    <Star className="h-3.5 w-3.5" />
                    رئيسية
                  </Button>
                  {/*
                    ⚠️ معطّل بـ disabled ثابت **مش** بالعلم.
                    الحذف ما اتعملش أصلًا، فمفيش علاقة بالإذن: لو
                    اتعلّق على العلم كان هيبقى شغّال بعد فتحه وبيفتح
                    حوار تأكيده مالوش تنفيذ.
                  */}
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label="حذف الصورة"
                    className="w-8 px-0"
                    disabled
                    title="حذف الصور لسه ما اتعملش"
                    onClick={() => setConfirmId(image.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmId !== null}
        title="حذف الصورة؟"
        message="لو الحذف كان مفعّل، الصورة كانت هتتشال من المنتج ومن Storage، والإجراء ده ما ينفعش يترجع."
        confirmLabel="احذف"
        disabledReason="الحذف لسه ما اتعملش — مفيش أي صورة هتتمسح."
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
