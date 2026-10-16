// Settings for a static preview snapshot of the marketing site (e.g. on
// Cloudflare Pages, for sharing before launch). Both are unset in normal builds,
// so production behaviour is unchanged.
//
// NEXT_PUBLIC_KYB_APP_URL — origin of a running KYB app to hand searches to
//   (e.g. https://check.trustworthypayments.com). Empty = this app.
// NEXT_PUBLIC_STATIC_PREVIEW=1 — no server behind the pages: skip the ABR
//   disambiguation call (the search server's CORS only admits the live app)
//   and show waitlist forms as "opens at launch".
export const KYB_APP_URL = (process.env.NEXT_PUBLIC_KYB_APP_URL ?? '').replace(/\/$/, '');
export const STATIC_PREVIEW = process.env.NEXT_PUBLIC_STATIC_PREVIEW === '1';
