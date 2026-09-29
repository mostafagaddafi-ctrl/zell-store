/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @zell/core بيتوزّع كـ TypeScript خام من الـ workspace
  transpilePackages: ['@zell/core'],
  images: {
    formats: ['image/avif', 'image/webp'],
    // مرحلة الصور هتضيف هنا remotePatterns لدومين Supabase Storage
    remotePatterns: [],
  },
}

export default nextConfig
