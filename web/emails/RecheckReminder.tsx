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
  dayCount: number;
}

export function RecheckReminder({ entityName, entityAbn, reportUrl, dayCount }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;
  const isLongInterval = dayCount >= 60;

  return (
    <Html>
      <Head />
      <Preview>{`${dayCount}-day re-check reminder — is ${entityName} still all clear?`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>{`${dayCount}-day build check-in`}</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              {`It's been ${dayCount} days since you last searched this builder.`}{' '}
              {isLongInterval
                ? 'Over the course of a long project, a lot can change — licences can lapse, insolvency notices can be filed, and new court decisions published.'
                : 'Circumstances can change quickly — licence status, insolvency notices, and court decisions are updated regularly.'}
            </Text>

            <Text style={paragraph}>
              A quick re-check takes under a minute and costs $3 — or use a re-check credit if you
              have one in your account.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={reportUrl} style={ctaButton}>
                Re-check Builder ($3) →
              </Button>
            </Section>

            <Text style={tip}>
              Set up monitoring to receive automatic alerts whenever anything changes — no manual
              checks needed.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>What&apos;s checked in a re-check?</Text>
            {[
              'QBCC licence status and any recent disciplinary actions',
              'New court and tribunal proceedings since your last search',
              'ASIC insolvency and external administration notices',
              'ATO tax debt disclosures',
              'Payment Times Register updates',
            ].map((item) => (
              <Text key={item} style={bulletItem}>
                · {item}
              </Text>
            ))}
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              This report is based on publicly available information. It does not constitute legal
              or financial advice.
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

const tip: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '16px 0 0',
  textAlign: 'center',
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

export default RecheckReminder;
