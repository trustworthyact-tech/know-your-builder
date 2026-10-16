import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './emails/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#13263D',
        'primary-light': '#2E5F8C',
        accent: '#FDA62A',
        background: '#F4F6F9',
        surface: '#FFFFFF',
        'surface-alt': '#EEF1F6',
        'text-primary': '#0F1C2E',
        'text-secondary': '#4A5568',
        'text-muted': '#636B76',
        success: '#2E7D53',
        'success-bg': '#E8F5EE',
        warning: '#B45309',
        'warning-bg': '#FEF3C7',
        danger: '#C0392B',
        'danger-bg': '#FDEDEC',
        info: '#1565C0',
        'info-bg': '#E3F2FD',
        border: '#D1D9E0',
        'border-light': '#EEF1F6',
        // Marketing-site brand tokens (2026-10 redesign). Kept separate from the app
        // tokens above so the KYB app's look is unchanged until it's re-skinned.
        // Ochre fails contrast with white text (2.8:1): ochre buttons always take
        // brand-navy text (5.5:1).
        'brand-navy': '#0B2545',
        'brand-ochre': '#D88A00',
        'brand-ochre-hover': '#E89A14', // hover fill, navy text 6.7:1
        'brand-ochre-text': '#8A5700', // ochre for small text on white/paper, 6.1:1
        'brand-wash': '#FBEFD9',
        'brand-paper': '#F6F8FB',
        'brand-slate': '#5A6578',
        'brand-line': '#DDE3EC',
      },
      fontFamily: {
        brand: ['var(--font-schibsted)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
