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
  heading1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  heading2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
  heading3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  heading4: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
  bodyLg: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyMd: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  bodySm: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  bodyXs: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  labelMd: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  labelSm: { fontSize: 11, fontWeight: '600' as const, lineHeight: 16, letterSpacing: 0.5 },
};

export const shadows = {
  card: {
    shadowColor: '#0F1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
};
