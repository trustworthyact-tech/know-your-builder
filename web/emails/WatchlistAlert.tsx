import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface AlertItem {
  alertType: string;
  description: string;
}

interface Props {
  entityName: string;
  entityAbn: string;
  alerts: AlertItem[];
  reRunUrl: string;
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  LICENCE_CHANGE: 'Licence Change',
  INSOLVENCY_EVENT: 'Insolvency Notice',
  COURT_DECISION: 'New Court Decision',
  ATO_DEBT_FLAG: 'ATO Tax Debt Disclosure',
  QBCC_ADJUDICATION: 'QBCC Adjudication Decision',
  FWO_ENFORCEMENT: 'Fair Work Enforcement Action',
};

export function WatchlistAlert({ entityName, entityAbn, alerts, reRunUrl }: Props) {
  const preview =
    alerts.length === 1
      ? `Alert: ${ALERT_TYPE_LABELS[alerts[0].alertType] ?? alerts[0].alertType} for ${entityName}`
      : `${alerts.length} new alerts for ${entityName}`;

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Monitoring alert</Text>
          </Section>

          {/* Entity card */}
          <Section style={card}>
            <Text style={label}>ALERT FOR</Text>
            <Heading style={entityHeading}>{entityName}</Heading>
            {entityAbn && <Text style={meta}>ABN {entityAbn}</Text>}

            <Hr style={innerHr} />

            {alerts.map((alert, i) => (
              <Section key={i} style={alertRow}>
                <Text style={alertTypeLabel}>
                  {ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}
                </Text>
                <Text style={alertDescription}>{alert.description}</Text>
              </Section>
            ))}
          </Section>

          {/* CTA */}
          <Section style={{ textAlign: 'center', marginTop: '24px' }}>
            <Button href={reRunUrl} style={ctaButton}>
              Re-run Search ($3) →
            </Button>
          </Section>

          <Hr style={hr} />

          {/* Footer */}
          <Section>
            <Text style={disclaimer}>
              You are receiving this because you have an active monitoring subscription for{' '}
              {entityName}. You can manage your subscriptions in your Know Your Builder account.
            </Text>
            <Text style={disclaimer}>© Know Your Builder · Manage notifications in your account</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: '#F4F6F9',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '32px auto',
  padding: '0 16px',
};

const header: React.CSSProperties = {
  backgroundColor: '#1A3A5C',
  borderRadius: '12px 12px 0 0',
  padding: '24px 32px',
  textAlign: 'center',
};

const headerHeading: React.CSSProperties = {
  color: '#FFFFFF',
  fontSize: '22px',
  fontWeight: '700',
  margin: 0,
};

const headerSub: React.CSSProperties = {
  color: 'rgba(255,255,255,0.65)',
  fontSize: '12px',
  margin: '4px 0 0',
};

const card: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderLeft: '1px solid #D1D9E0',
  borderRight: '1px solid #D1D9E0',
  padding: '24px 32px',
};

const label: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.5px',
  margin: '0 0 4px',
  textTransform: 'uppercase',
};

const entityHeading: React.CSSProperties = {
  color: '#1A3A5C',
  fontSize: '20px',
  fontWeight: '700',
  margin: '0 0 4px',
};

const meta: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  margin: '0 0 4px',
};

const innerHr: React.CSSProperties = {
  borderColor: '#EEF1F6',
  margin: '16px 0',
};

const alertRow: React.CSSProperties = {
  marginBottom: '12px',
};

const alertTypeLabel: React.CSSProperties = {
  color: '#B45309',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.5px',
  margin: '0 0 2px',
  textTransform: 'uppercase',
};

const alertDescription: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '14px',
  margin: 0,
};

const ctaButton: React.CSSProperties = {
  backgroundColor: '#1A3A5C',
  borderRadius: '12px',
  color: '#FFFFFF',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: '600',
  padding: '14px 32px',
  textDecoration: 'none',
};

const hr: React.CSSProperties = {
  borderColor: '#EEF1F6',
  margin: '24px 0',
};

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  textAlign: 'center',
};

export default WatchlistAlert;
