import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { discountInfo, installationTools, maxQuantityOf, parseToolFilmIds, primaryImage } from '@zell/core'
import { InstallationToolsList, type ToolRow } from '../../components/store/InstallationToolsList'
import { buttonClasses } from '../../components/ui/Button'
import { BackButton } from '../../components/ui/BackButton'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

/**
 * صفحة «أدوات التركيب».
 *
 *   مقفولة من اللوحة (أو الإعداد مش موجود)  → 404
 *   ?for=<فيلم> صالح وليه أدوات             → أدوات الفيلم ده بس
 *   ?for=1,3 (من السلة)                     → أدوات الأفلام دي في قايمة واحدة من غير تكرار
 *   فيلم موجود من غير أدوات                  → كل الأدوات + توضيح بسيط
 *   قيمة غلط / فيلم مش موجود / من غير for    → كل الأدوات من غير رسالة
 *
 * ⚠️ نفس بيانات المتجر المكاشة (tag) — حفظ الربط أو الإعداد من اللوحة بيحدّثها.
 */

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getStorefrontData()
  const page = settings.installationToolsPage
  if (!page.enabled) return { title: 'الصفحة مش موجودة' }
  const metadata: Metadata = { title: page.title }
  if (page.description !== '') metadata.description = page.description
  return metadata
}

export default async function InstallationToolsPage({ searchParams }: PageProps) {
  const { settings, products } = await getStorefrontData()
  const page = settings.installationToolsPage
  if (!page.enabled) notFound()

  const params = await searchParams
  const view = installationTools(products, parseToolFilmIds(params['for']))
  const onlyFilm = view.mode === 'films' && view.films.length === 1 ? view.films[0] : undefined
  const backFallback = onlyFilm ? '/product/' + String(onlyFilm.id) : '/cart'
  const rows: ToolRow[] = view.tools.map(({ tool, films }) => {
    const image = primaryImage(tool)
    const discount = discountInfo(tool)
    return {
      id: tool.id,
      name: tool.name_ar,
      pricePiastres: tool.price_per_meter_piastres,
      compareAtPiastres: discount ? discount.compareAtPiastres : null,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt || tool.name_ar,
      max: maxQuantityOf(tool),
      films: films.map((film) => film.name_ar),
    }
  })

  return (
    <Container className="pb-8">
      <nav aria-label="مسار التنقل" className="pt-6">
        {/* رجوع بسجل المتصفح، وإلا لصفحة الفيلم (لو فيلم واحد) أو السلة */}
        <BackButton fallback={backFallback} />
      </nav>

      <div className="mx-auto max-w-app">
        <header className="space-y-3 py-6">
          <h1 className="text-2xl font-extrabold text-fg">{page.title}</h1>
          {view.mode === 'films' ? (
            <p className="text-sm font-semibold text-fg">
              {'أدوات مناسبة لـ ' + view.films.map((film) => film.name_ar).join(' · ')}
            </p>
          ) : null}
          {page.description !== '' ? <p className="text-sm leading-relaxed text-muted">{page.description}</p> : null}
          {page.videoNote !== '' ? (
            <p className="rounded-lg border border-border bg-card p-3 text-sm text-fg">{page.videoNote}</p>
          ) : null}
          {view.requestedWithoutTools ? (
            <p className="text-xs text-muted">الفيلم ده مالوش أدوات محددة — دي كل الأدوات المتاحة.</p>
          ) : null}
        </header>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
            <p className="text-sm text-muted">مفيش أدوات تركيب متاحة دلوقتي.</p>
            <Link href="/" className={buttonClasses('primary', 'md', 'mt-5 inline-flex')}>
              شوف الأنواع
            </Link>
          </div>
        ) : (
          <InstallationToolsList rows={rows} checkoutLabel={page.checkoutButtonLabel} />
        )}

        {view.mode === 'films' ? (
          <Link href="/installation-tools" className="mt-4 inline-block py-2 text-sm font-semibold text-accent">
            شوف كل الأدوات
          </Link>
        ) : null}
      </div>
    </Container>
  )
}
