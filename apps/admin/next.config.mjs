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
  transpilePackages: ['@zell/core'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
