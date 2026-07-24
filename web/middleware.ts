import { withAuth } from 'next-auth/middleware';

// Redirect target for protected pages must be set explicitly here — this
// runs in the Edge runtime and can't import `authOptions` (Prisma/bcrypt
// aren't Edge-compatible), so it can't share `web/lib/auth.ts`'s config.
export default withAuth({
  pages: {
    signIn: '/auth/login',
  },
});

// Only routes where every verb unconditionally requires the same signed-in
// user belong here (see SECURITY_REMEDIATION_PLAN.md A3's audit). Routes
// with owner-or-guest, token-gated, or webhook-signature auth (reports/[id],
// /compare, /api/share/[token], /api/report/[searchId]/pdf,
// /api/payments/webhook, /api/payments/pack-balance, /api/reports/save)
// must stay as in-route checks — do not add them here.
export const config = {
  matcher: [
    '/account',
    '/account/reports',
    '/account/reports/:path*',
    '/account/watchlist',
    '/account/alerts',
    '/account/monitoring',
    '/api/alerts',
    '/api/alerts/:id*',
    '/api/monitoring',
    '/api/payments/create-intent',
    '/api/share',
    '/api/timeline',
    '/api/timeline/:searchId*',
    '/api/user/searches',
    '/api/watchlist',
  ],
};
