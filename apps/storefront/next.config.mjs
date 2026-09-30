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
}

export default nextConfig
