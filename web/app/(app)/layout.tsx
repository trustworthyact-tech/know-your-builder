import type { Metadata } from 'next';
import { DM_Sans } from 'next/font/google';
import { Providers } from '@/app/providers';
import { NavBar } from '@/components/NavBar';
import { Footer } from '@/components/Footer';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Know Your Builder | Trustworthy',
  description:
    'Builder due diligence for NSW and ACT — free instant check against national and state registers. A Trustworthy product.',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${dmSans.variable} ${dmSans.className} flex min-h-screen flex-col`}>
      <Providers>
        <NavBar />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </Providers>
    </div>
  );
}
