export const colors = {
  // Brand
  primary: '#1A3A5C',
  primaryLight: '#2E5F8C',
  accent: '#F0A500',

  // Surfaces
  background: '#F4F6F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F6',

  // Text
  textPrimary: '#0F1C2E',
  textSecondary: '#4A5568',
  textMuted: '#9AA5B4',

  // Status
  success: '#2E7D53',
  successBg: '#E8F5EE',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  danger: '#C0392B',
  dangerBg: '#FDEDEC',
  info: '#1565C0',
  infoBg: '#E3F2FD',

  // Borders
  border: '#D1D9E0',
  borderLight: '#EEF1F6',

  // Misc
  white: '#FFFFFF',
  shadow: 'rgba(15, 28, 46, 0.08)',
};

export const typography = {
  heading1: { fontSize: 28, fontWeight: '700' as const, lineHeight: '36px' },
  heading2: { fontSize: 22, fontWeight: '700' as const, lineHeight: '30px' },
  heading3: { fontSize: 18, fontWeight: '600' as const, lineHeight: '26px' },
  heading4: { fontSize: 15, fontWeight: '600' as const, lineHeight: '22px' },
  bodyLg: { fontSize: 16, fontWeight: '400' as const, lineHeight: '24px' },
  bodyMd: { fontSize: 14, fontWeight: '400' as const, lineHeight: '20px' },
  bodySm: { fontSize: 13, fontWeight: '400' as const, lineHeight: '18px' },
  bodyXs: { fontSize: 12, fontWeight: '400' as const, lineHeight: '16px' },
  labelMd: { fontSize: 13, fontWeight: '600' as const, lineHeight: '18px' },
  labelSm: { fontSize: 11, fontWeight: '600' as const, lineHeight: '16px', letterSpacing: '0.5px' },
};

export const shadows = {
  card: '0 2px 8px rgba(15, 28, 46, 0.07)',
  md: '0 4px 16px rgba(15, 28, 46, 0.10)',
};
