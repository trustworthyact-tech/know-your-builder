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
  // Know Your Builder's search form moved from `/` to `/check` when the marketing
  // site moved into this app. Until trustworthypayments.com's DNS is cut over from
  // the old WordPress host, check.trustworthypayments.com stays the live entry
  // point, so its root keeps serving the tool. At cutover, replace this rewrite
  // with a permanent redirect: check.trustworthypayments.com/:path* →
  // https://trustworthypayments.com/check (root) or /:path* (everything else).
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          has: [{ type: 'host', value: 'check.trustworthypayments.com' }],
          destination: '/check',
        },
      ],
    };
  },
};

export default nextConfig;
