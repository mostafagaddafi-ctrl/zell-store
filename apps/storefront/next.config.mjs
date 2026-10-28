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
