import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8009';

const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost', '169.254.0.21'],
  experimental: {
    webpackMemoryOptimizations: true,
  },

  // Proxy API calls to Express backend in development
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
    ];
  },

  // Dev server on port 3001 to avoid conflict with Express on 3000
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
