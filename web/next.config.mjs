/** @type {import('next').NextConfig} */
const nextConfig = {
  // Express scraping service URL is consumed server-side only (no NEXT_PUBLIC_ prefix)
  serverRuntimeConfig: {
    scrapingServiceUrl: process.env.SCRAPING_SERVICE_URL ?? 'http://localhost:3001',
  },
  // Enables instrumentation.ts so env validation runs once at server boot
  // (stable by default in Next 15+; this app is still on 14.2.x — see B2).
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
