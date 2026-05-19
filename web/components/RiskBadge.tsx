export type RiskLevel = 'clear' | 'findings' | 'significant' | 'unavailable';

interface Props {
  level: RiskLevel;
  className?: string;
}

const CONFIG: Record<RiskLevel, { icon: string; label: string; classes: string }> = {
  clear: {
    icon: '✓',
    label: 'Clear',
    classes: 'bg-success-bg text-success border-success/30',
  },
  findings: {
    icon: '⚠',
    label: 'Findings — see detail',
    classes: 'bg-warning-bg text-warning border-warning/30',
  },
  significant: {
    icon: '✗',
    label: 'Significant finding',
    classes: 'bg-danger-bg text-danger border-danger/30',
  },
  unavailable: {
    icon: '—',
    label: 'Unavailable',
    classes: 'bg-surface-alt text-text-muted border-border',
  },
};

export function RiskBadge({ level, className = '' }: Props) {
  const { icon, label, classes } = CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${classes} ${className}`}
      aria-label={`Risk level: ${label}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
