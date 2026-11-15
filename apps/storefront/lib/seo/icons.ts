import type { Metadata, MetadataRoute } from 'next'

/**
 * Z-ICON (قرار المالك 2026-11-15) — أيقونة الموقع ملفات ثابتة في apps/storefront/public/ بعناوين ثابتة (من غير ?hash)،
 * بالتصميم اللي المالك اختاره (حرف Z كحلي بجانب دهبي على خلفية كريمي، فولدر original/ زي ما هو).
 * • الإعلان: favicon.ico ثم 48 و96 و192 (FAVICON-ORDER: أول PNG معلن 48، ومن غير 32)، و180 لأجهزة أبل.
 * • icon-16.png وicon-32.png في public/ من غير إعلان (قرار المالك). الـ manifest: 192 و512.
 * • استثناء قاعدة «اللوجو» للأيقونة بس: لوجو الهيدر وصورة المشاركة (opengraph-image) وlib/brand ماتلمسوش.
 */
export const SITE_ICONS = {
  icon: [
    { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
    { url: '/icon-48.png', sizes: '48x48', type: 'image/png' },
    { url: '/icon-96.png', sizes: '96x96', type: 'image/png' },
    { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  ],
  apple: [{ url: '/icon-180.png', sizes: '180x180', type: 'image/png' }],
} satisfies NonNullable<Metadata['icons']>

export const MANIFEST_ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
] satisfies NonNullable<MetadataRoute.Manifest['icons']>
