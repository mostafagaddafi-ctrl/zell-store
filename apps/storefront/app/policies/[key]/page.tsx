import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { isPolicyKey, policyCompanyRows, splitPolicyBody, type PublishedPolicy } from '@zell/core'
import { Container } from '../../../components/ui/Container'
import { getStorefrontData } from '../../../lib/data/source'
import { formatPolicyDate } from '../../../lib/policies/policyView'

/**
 * POLICY-PAGES (docs/contracts/POLICY-PAGES.md §٢) — صفحة سياسة واحدة: terms · shipping · returns · privacy.
 *
 *   مفتاح غريب، أو الصفحة مش منشورة (مقفولة أو فاسدة)  → 404 و«الصفحة غير موجودة» من غير أي جزء من المحتوى
 *   منشورة                                          → العنوان · «آخر تحديث» · النص · وفي terms بس «بيانات البائع»
 *
 * ⚠️ نفس بيانات المتجر المكاشة (tag) — الحفظ من اللوحة بيحدّثها، فالإيقاف بيشيل الصفحة بعد تحديث الكاش.
 * ⚠️ النص بيتعرض كنص React عادي (من غير HTML ولا markdown).
 */

type Params = { key: string }
type PageProps = { params: Promise<Params> }

type Found = { page: PublishedPolicy; seller: Array<{ label: string; value: string }> }

async function findPolicy(key: string): Promise<Found | null> {
  if (!isPolicyKey(key)) return null
  const { settings } = await getStorefrontData()
  const page = settings.policies.pages[key]
  if (!page) return null
  return { page, seller: key === 'terms' ? policyCompanyRows(settings.policies.company) : [] }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key } = await params
  const found = await findPolicy(key)
  if (!found) return { title: 'الصفحة غير موجودة' }
  return { title: found.page.title }
}

export default async function PolicyPage({ params }: PageProps) {
  const { key } = await params
  const found = await findPolicy(key)
  if (!found) notFound()

  const { page, seller } = found
  const blocks = splitPolicyBody(page.body)
  const updated = formatPolicyDate(page.updatedAt)

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
        <h1 className="text-display font-extrabold text-fg">{page.title}</h1>
        {updated ? <p className="mt-2 text-sm text-muted">آخر تحديث: {updated}</p> : null}
      </header>

      <article className="max-w-3xl space-y-4 pb-6 text-sm leading-7 text-fg md:text-base md:leading-8">
        {blocks.map((block, index) =>
          block.kind === 'paragraph' ? (
            <p key={index} className="whitespace-pre-line">
              {block.text}
            </p>
          ) : (
            <ul key={index} className="list-disc space-y-2 ps-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </article>

      {seller.length > 0 ? (
        <section aria-labelledby="policy-seller" className="max-w-3xl rounded-lg border border-border bg-card p-4">
          <h2 id="policy-seller" className="text-sm font-bold text-fg">
            بيانات البائع
          </h2>
          <dl className="mt-2 space-y-1 text-sm">
            {seller.map((row) => (
              <div key={row.label} className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{row.label}:</dt>
                <dd className="text-fg">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </Container>
  )
}
