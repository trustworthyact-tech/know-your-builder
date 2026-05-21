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
        primary: '#1A3A5C',
        'primary-light': '#2E5F8C',
        accent: '#F0A500',
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
      },
    },
  },
  plugins: [],
};

export default config;
