'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Star, Trash2, Upload } from 'lucide-react'
import type { AdminImage, ImageFit } from '../../lib/adminData'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'

const FITS: Array<{ value: ImageFit; label: string; hint: string }> = [
  { value: 'cover', label: 'ملء الإطار', hint: 'مشهد الشباك' },
  { value: 'contain', label: 'الصورة كاملة', hint: 'الرول والخامة' },
]

/**
 * الرفع بيمر على راوت سيرفر في اللوحة، والسيرفر هو اللي بيبني المسار
 * ويتحقق من النوع والحجم — المتصفح مايلمسش Storage بمفتاح قوي.
 *
 * معرّفات الصور **نصوص** (bigint في Postgres).
 * المرحلة ب: كل التعديلات موقوفة بعلم الجاهزية.
 */
export function ImageManager({ images }: { images: AdminImage[] }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (images.length === 0) {
    return (
      <EmptyState
        title="مفيش صور للمنتج ده"
        description="الصورة الرئيسية بتظهر في كارت المتجر، والباقي في معرض صفحة المنتج."
        action={
          <Button disabled>
            <Upload className="h-4 w-4" />
            ارفع صورة
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{images.length} صورة · الرئيسية هي اللي بتظهر في كارت المتجر</p>
        <Button disabled>
          <Upload className="h-4 w-4" />
          ارفع صورة
        </Button>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {images.map((image, index) => (
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
                    disabled
                    title={fit.hint + ' — التعديلات موقوفة'}
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
                  <Button variant="ghost" size="sm" disabled={index === 0} aria-label="تحريك قبل" className="h-7 w-7 px-0">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === images.length - 1}
                    aria-label="تحريك بعد"
                    className="h-7 w-7 px-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" disabled={image.isPrimary}>
                    <Star className="h-3.5 w-3.5" />
                    رئيسية
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label="حذف الصورة"
                    className="w-8 px-0"
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
        disabledReason="الحذف موقوف دلوقتي — مفيش أي صورة هتتمسح."
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
