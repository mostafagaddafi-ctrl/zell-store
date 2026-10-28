import { jsonLdText, type JsonLd as JsonLdData } from '../../lib/seo/structuredData'

/** بيانات منظّمة لجوجل (schema.org). مش ظاهرة للزوار. النص متأمّن في jsonLdText. */
export function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />
}
