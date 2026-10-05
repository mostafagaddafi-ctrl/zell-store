'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Minus, Plus, ShoppingBag, Trash2, Wrench } from 'lucide-react'
import {
  cartToolFilmIds,
  describeLine,
  formatPiastres,
  installationLengthCm,
  installationToolsHref,
  installationReadyGovernorates,
  isPiece,
  lineTotalPiastres,
  maxQuantityOf,
  primaryImage,
  resolveCartLine,
  widthOptionsOf,
  type InstallationConfig,
  type StoreProduct,
} from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'
import { InstallChoice } from './InstallChoice'
import { OrderSummary } from './OrderSummary'

export function CartView({
  products,
  trustLine,
  gift,
  tools = null,
  installation = null,
}: {
  products: StoreProduct[]
  trustLine?: string
  gift?: string
  /** صفحة «أدوات التركيب» مفعّلة — الزرار بيظهر بس لو في السلة فيلم ليه أدوات نشطة. */
  tools?: { browseLabel: string } | null
  /** PR4 — إعداد الفني (0018). null = من غير «هتركّبه إزاي؟». */
  installation?: InstallationConfig | null
}) {
  const cart = useCart()
  const [pruned, setPruned] = useState(false)

  const byId = useMemo(() => {
    const map = new Map<number, StoreProduct>()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])

  // منتج اتقفل أو اتشال؟ نظّف السلة مرة واحدة بعد القراءة
  useEffect(() => {
    if (!cart.ready || pruned) return
    for (const line of cart.lines) {
      const base = byId.get(line.productId)
      // 0015 — عرض اتشال أو اتوقف = الصنف مش متاح
      if (!base || !resolveCartLine(base, line)) cart.remove(line.id)
    }
    setPruned(true)
  }, [cart, byId, pruned])

  if (!cart.ready) {
    return <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
  }

  const entries = cart.lines
    .map((line) => {
      const base = byId.get(line.productId)
      return {
        line,
        product: base ? (resolveCartLine(base, line) ?? undefined) : undefined,
        multi: base ? widthOptionsOf(base).length > 1 : false,
      }
    })
    .filter(
      (entry): entry is { line: (typeof cart.lines)[number]; product: StoreProduct; multi: boolean } =>
        Boolean(entry.product),
    )

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
        <ShoppingBag className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-4 text-sm text-muted">السلة فاضية — اختار نوع الفيلم وحدد المقاس.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-5 inline-flex')}>
          شوف الأنواع
        </Link>
      </div>
    )
  }

  // أفلام بالمقاس في السلة ليها أدوات نشطة → زرار واحد لصفحة الأدوات (قايمة واحدة من غير تكرار)
  // نفس الدالة اللي Checkout بيستخدمها لـ«هركّبه بنفسي وشوف أدوات التركيب»
  const toolFilmIds = cartToolFilmIds(
    entries.map((entry) => entry.line),
    byId,
  )
  const toolsHref = tools ? installationToolsHref(toolFilmIds) : null

  // PR4 — «هتركّبه إزاي؟» لأفلام المقاس في السلة. الأجر هنا تقدير؛ الانتقال والمعتمد في Checkout.
  const meterCm = installationLengthCm(entries)
  const installerGovernorates = installation ? installationReadyGovernorates(installation) : []
  const fee = installation?.feePerMeterPiastres ?? null
  const showChoice = meterCm > 0 && installerGovernorates.length > 0 && fee !== null
  const installer = showChoice && cart.installMode === 'installer'
  // أدوات التركيب = قطع مربوطة كإضافة لأي فيلم بالمقاس. مع الفني بتتوضّح بس — مابتتشالش لوحدها.
  const toolIds = new Set<number>()
  for (const product of products) if (!isPiece(product)) for (const id of product.addon_ids ?? []) toolIds.add(id)
  const toolEntries = installer ? entries.filter((entry) => isPiece(entry.product) && toolIds.has(entry.product.id)) : []

  const subtotal = entries.reduce(
    (sum, entry) => sum + lineTotalPiastres(entry.product, entry.line),
    0,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
      <ul className="space-y-3 lg:col-span-7">
        {entries.map((entry) => {
          const lineTotal = lineTotalPiastres(entry.product, entry.line)
          const preview = primaryImage(entry.product)
          const stepBy = (delta: number) => {
            // 0016 — القطعة: العدد من ١ لأقصى عدد
            if (isPiece(entry.product)) {
              const next = (entry.line.quantity ?? 1) + delta
              if (next < 1 || next > maxQuantityOf(entry.product)) return
              cart.setQuantity(entry.line.id, next)
              return
            }
            const next = entry.line.lengthCm + delta * entry.product.step_cm
            if (next < entry.product.min_length_cm || next > entry.product.max_length_cm) return
            cart.setLength(entry.line.id, next)
          }

          return (
            <li key={entry.line.id} className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex gap-3 sm:gap-4">
                <Link href={'/product/' + String(entry.product.id)} className="shrink-0">
                  <ImageSlot
                    ratio="1/1"
                    fit="cover"
                    src={preview?.url ?? null}
                    alt={preview?.alt ?? entry.product.name_ar}
                    sizes="(min-width: 640px) 96px, 80px"
                    className="h-20 w-20 sm:h-24 sm:w-24"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={'/product/' + String(entry.product.id)}
                    className="line-clamp-2 text-sm font-bold leading-5 text-fg hover:text-accent"
                  >
                    {entry.product.name_ar}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    <Num>{formatPiastres(entry.product.price_per_meter_piastres)}</Num> {isPiece(entry.product) ? 'للوحدة' : 'للمتر'}
                    {entry.multi ? (
                      <>
                        {' · عرض '}
                        <Num>{String(entry.product.width_cm)}</Num>
                        {' سم'}
                      </>
                    ) : null}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => cart.remove(entry.line.id)}
                  aria-label={'شيل ' + entry.product.name_ar + ' من السلة'}
                  className="-me-1.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* سطر تاني بعرض الكارت: المقاس/الكمية يمين، والإجمالي شمال — بيلف على الشاشات الضيقة جدًا */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1">
                  <StepButton onClick={() => stepBy(-1)} label={'قلّل ' + entry.product.name_ar}>
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </StepButton>
                  <span className="min-w-[4.5rem] text-center text-sm font-semibold text-fg">
                    <Num>{describeLine(entry.product, entry.line)}</Num>
                  </span>
                  <StepButton onClick={() => stepBy(1)} label={'زوّد ' + entry.product.name_ar}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </StepButton>
                </div>

                <div className="ms-auto text-end">
                  <span className="block text-[11px] text-muted">الإجمالي</span>
                  <span className="text-base font-extrabold text-fg">
                    <Num>{formatPiastres(lineTotal)}</Num>
                  </span>
                </div>
              </div>
            </li>
          )
        })}

        {tools && toolsHref && !installer ? (
          <li>
            <Link href={toolsHref} className={buttonClasses('secondary', 'md', 'w-full')}>
              <Wrench className="h-4 w-4" aria-hidden="true" />
              {tools.browseLabel}
            </Link>
          </li>
        ) : null}

        <li>
          <Link href="/" className="inline-block py-2 text-sm font-semibold text-accent">
            + ضيف نوع تاني
          </Link>
        </li>
      </ul>

      <div className="lg:col-span-5">
        <div className="space-y-4 lg:sticky lg:top-24">
          {showChoice && fee !== null ? (
            <InstallChoice
              mode={cart.installMode}
              onChange={cart.setInstallMode}
              feePerMeterPiastres={fee}
              lengthCm={meterCm}
              governorates={installerGovernorates}
              context="cart"
            />
          ) : null}
          {toolEntries.length > 0 ? (
            <div role="status" className="rounded-lg border border-border bg-card p-4 text-xs text-fg">
              <p className="font-semibold">
                عندك أدوات تركيب في السلة:{' '}
                {toolEntries.map((entry) => entry.product.name_ar + ' ×' + String(entry.line.quantity ?? 1)).join('، ')}
              </p>
              <p className="mt-1 text-muted">الفني مش محتاجها. هتفضل في الطلب لحد ما تشيلها بنفسك.</p>
              <button
                type="button"
                onClick={() => {
                  for (const entry of toolEntries) cart.remove(entry.line.id)
                }}
                className="mt-2 text-sm font-semibold text-accent"
              >
                شيل الأدوات من السلة
              </button>
            </div>
          ) : null}
          <OrderSummary
            trustLine={trustLine}
            gift={gift}
            subtotalPiastres={subtotal}
            shippingPiastres={null}
            action={
              <Link href="/checkout" className={buttonClasses('primary', 'lg')}>
                كمّل بيانات التوصيل
              </Link>
            }
          />
        </div>
      </div>
    </div>
  )
}

function StepButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded border border-border text-fg transition-colors hover:border-muted"
    >
      {children}
    </button>
  )
}
