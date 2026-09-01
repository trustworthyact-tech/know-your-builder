import Image from 'next/image';

export function Footer() {
  return (
    <footer className="bg-primary text-white/70 mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <a
          href="https://trustworthypayments.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-white hover:text-accent transition-colors"
        >
          <Image src="/trustworthy-mark.png" alt="" width={24} height={24} />
          <span className="text-sm font-semibold tracking-tight">Trustworthy</span>
        </a>

        <p className="text-xs text-center sm:text-right">
          Know Your Builder is a Trustworthy product. &copy; {new Date().getFullYear()}{' '}
          Trustworthy. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
