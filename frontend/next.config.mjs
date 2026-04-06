/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Proxy /api/backend/* → http://backend:8000/api/*
   *
   * Server-side rewrites allow Next.js server components to call the backend
   * using the internal Docker network hostname ("backend") without exposing
   * it to the browser. Client components use NEXT_PUBLIC_API_URL instead.
   */
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://backend:8000'}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
