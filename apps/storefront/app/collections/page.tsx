import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Container } from '../../components/ui/Container'
import { ImageSlot } from '../../components/ui/ImageSlot'
import { getStorefrontData } from '../../lib/data/source'
import { canonicalPath } from '../../lib/seo/structuredData'

/**
 * كل الأقسام — المدخل لباقي الأقسام لما الهيدر مايكفيش.
 *
 * نفس ترتيب اللوحة، والأقسام المفعّلة في القائمة بس (اللي ليها صفحة).
 * قسم فاضي مابيوصلش هنا — التصفية في toStoreCollections.
 */

export const metadata: Metadata = { title: 'كل الأقسام', alternates: { canonical: canonicalPath.collections() } }

export default async function CollectionsIndexPage() {
  const { collections } = await getStorefrontData()
  const navCollections = collections.filter((collection) => collection.showInNav)

  return (
    <Container className="pb-8">
      <nav aria-label="مسار التنقل" className="pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          <ArrowRight className="h-4 w-4" />
          الرئيسية
        </Link>
      </nav>

      <header className="py-6 md:py-8">
        <h1 className="text-display font-extrabold text-fg">كل الأقسام</h1>
      </header>

      {navCollections.length === 0 ? (
        <p className="pb-6 text-sm text-muted">مفيش أقسام متاحة دلوقتي.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 pb-6 sm:gap-5 lg:grid-cols-3">
          {navCollections.map((collection) => (
            <li key={collection.slug} className="min-w-0">
              <Link
                href={'/collection/' + collection.slug}
                className="group block overflow-hidden rounded-lg border border-border bg-card shadow-card transition-colors hover:border-accent"
              >
                <ImageSlot
                  ratio="4/3"
                  fit="cover"
                  src={collection.image?.url ?? null}
                  alt=""
                  sizes="(min-width: 1024px) 33vw, 50vw"
                  label={collection.title}
                  className="rounded-none"
                />
                <div className="p-3">
                  <p className="truncate text-sm font-bold text-fg transition-colors group-hover:text-accent">
                    {collection.title}
                  </p>
                  {collection.subtitle ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{collection.subtitle}</p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}
