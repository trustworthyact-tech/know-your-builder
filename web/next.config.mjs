/** @type {import('next').NextConfig} */
const nextConfig = {
  // Express scraping service URL is consumed server-side only (no NEXT_PUBLIC_ prefix)
  serverRuntimeConfig: {
    scrapingServiceUrl: process.env.SCRAPING_SERVICE_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
