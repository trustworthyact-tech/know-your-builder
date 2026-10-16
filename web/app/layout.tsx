import type { Metadata } from 'next';
import './globals.css';

// Root layout is deliberately bare: fonts, nav, footer and the next-auth
// SessionProvider live in the route-group layouts — (marketing) for the public
// site, (app) for Know Your Builder — so marketing pages don't load the app's
// font or make next-auth's session request.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trustworthypayments.com'),
  title: {
    default: 'Trustworthy | Check your builder before you sign',
    template: '%s | Trustworthy',
  },
  description:
    'Free builder check for NSW and ACT: licence status, ASIC and insolvency notices, and court and tribunal records from official public registers, in one report.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
