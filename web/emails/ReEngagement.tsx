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

interface Props {
  entityName: string;
  entityAbn?: string;
  reportUrl: string;
}

export function ReEngagement({ entityName, entityAbn, reportUrl }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;

  return (
    <Html>
      <Head />
      <Preview>Did you find the right builder? Your report for {entityName} is ready</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Your report is ready</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              It&apos;s been a couple of weeks since you ran a due diligence check. Did you find what
              you were looking for?
            </Text>

            <Text style={paragraph}>
              Your full report — including licence history, court records, insolvency notices, and
              payment times data — is still available in your account.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={reportUrl} style={ctaButton}>
                View Your Report →
              </Button>
            </Section>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>Still deciding?</Text>
            <Text style={paragraph}>
              If you&apos;re still evaluating builders, consider running a check on each shortlisted
              candidate before signing any contract. A Know Your Builder report costs $3 and takes
              under a minute.
            </Text>
            {[
              'QBCC licence status and history',
              'Court and tribunal proceedings across all jurisdictions',
              'ASIC insolvency and administration notices',
              'Payment Times Register compliance',
              'Modern Slavery Act reporting status',
            ].map((item) => (
              <Text key={item} style={bulletItem}>
                · {item}
              </Text>
            ))}
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              You&apos;re receiving this because you ran a search on Know Your Builder. If you&apos;ve
              made your decision and no longer need updates, you can manage notification preferences
              in your account settings.
            </Text>
            <Text style={disclaimer}>
              © Know Your Builder · Automated due diligence for Australian construction
            </Text>
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
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 12px',
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

const sectionTitle: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '14px',
  fontWeight: '600',
  margin: '0 0 8px',
};

const bulletItem: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '4px 0',
};

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  textAlign: 'center',
};

export default ReEngagement;
