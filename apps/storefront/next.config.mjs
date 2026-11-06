// COOKIES-HEADERS §٤ — headers أمان لكل الصفحات. نفس القايمة في apps/storefront/next.config.mjs وapps/admin/next.config.mjs،
// وscripts/check-security-headers.mjs بيتأكد منها بعد البناء. مفيش Content-Security-Policy (عشان CSP بتاعة Next على
// /_next/image تفضل زي ما هي) ولا Strict-Transport-Security (Vercel بيبعته أصلًا max-age=63072000؛ قرار المالك (ج)).
// منع عرض الموقع جوه موقع تاني (DENY) قرار مقصود.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @zell/core بيتوزّع كـ TypeScript خام من الـ workspace
  transpilePackages: ['@zell/core'],
  images: {
    formats: ['image/avif', 'image/webp'],
    // مقيّدة على مسار التخزين العام في Supabase — مش دومين مفتوح.
    // wildcard على النطاق الفرعي عشان مشروع staging يشتغل من غير تعديل كود.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async rewrites() {
    // SEO-BASICS: ‎/favicon.ico‎ = أيقونة الموقع بمقاس 48 (app/icon.tsx) — جوجل والمتصفحات بيدوّروا على المسار ده مباشرة.
    return [{ source: '/favicon.ico', destination: '/icon/48' }]
  },
  async headers() {
    return [
      // العامة الأول: لو rule بعدها حطّت نفس المفتاح، الأخيرة بتكسب (صفحة الإيصال تحت بتحتفظ بـ no-referrer).
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // صفحة الإيصال محتواها شخصي ومربوط بكوكي متصفح واحد.
        // force-dynamic بيمنع كاش Next، والهيدرز دي بتمنع أي وسيط أو CDN،
        // وبتمنع رقم الطلب إنه يسافر في Referer لأي طرف تالت.
        source: '/order/:orderNumber',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}

export default nextConfig
