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
  monitoringUrl: string;
  step: number;
}

export function DuringBuild({ entityName, entityAbn, reportUrl, monitoringUrl, step }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;

  if (step === 1) {
    return (
      <Html>
        <Head />
        <Preview>30-day build check-in — re-check {entityName}?</Preview>
        <Body style={body}>
          <Container style={container}>
            <Section style={header}>
              <Heading style={headerHeading}>Know Your Builder</Heading>
              <Text style={headerSub}>Build check-in — 30 days</Text>
            </Section>

            <Section style={card}>
              <Text style={label}>REPORT FOR</Text>
              <Heading style={entityHeading}>{entityLabel}</Heading>

              <Text style={paragraph}>
                It&apos;s been 30 days since your build started. A lot can change during a build —
                licences can be suspended, insolvency notices filed, and new court decisions
                published.
              </Text>

              <Text style={paragraph}>
                A quick re-check takes under a minute and costs $3 — or use a re-check credit if
                you have one in your account.
              </Text>

              <Section style={{ textAlign: 'center', margin: '24px 0' }}>
                <Button href={reportUrl} style={ctaButton}>
                  Re-check Builder ($3) →
                </Button>
              </Section>

              <Text style={tip}>
                Set up monitoring to get automatic alerts whenever something changes — no manual
                checks needed.
              </Text>
            </Section>

            <Hr style={hr} />
            <Section>
              <Text style={disclaimer}>
                © Know Your Builder · Automated due diligence for Australian construction
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    );
  }

  return (
    <Html>
      <Head />
      <Preview>Builder confirmed — here&apos;s what to watch during your build</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>During-build guidance</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              Your due diligence check is on record. Now that your build is underway, here&apos;s
              what to keep an eye on:
            </Text>

            {WATCH_ITEMS.map((item) => (
              <Section key={item.title} style={watchItem}>
                <Text style={watchTitle}>{item.title}</Text>
                <Text style={watchDesc}>{item.desc}</Text>
              </Section>
            ))}
          </Section>

          <Section style={actionCard}>
            <Text style={actionTitle}>Automatic monitoring — $9/month</Text>
            <Text style={actionDesc}>
              Get instant alerts when your builder&apos;s licence changes, insolvency notices are
              filed, or new court decisions are published — without checking manually.
            </Text>
            <Section style={{ textAlign: 'center', margin: '16px 0 0' }}>
              <Button href={monitoringUrl} style={ctaButton}>
                Set Up Monitoring →
              </Button>
            </Section>
          </Section>

          <Section style={{ marginTop: '16px', textAlign: 'center' }}>
            <Button href={reportUrl} style={secondaryButton}>
              View Report →
            </Button>
          </Section>

          <Hr style={hr} />
          <Section>
            <Text style={disclaimer}>
              This report is based on publicly available information. It does not constitute legal or
              financial advice.
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

const WATCH_ITEMS = [
  {
    title: 'Licence status',
    desc: 'Confirm the QBCC licence remains current before each stage payment. A suspended licence means the builder cannot legally continue work.',
  },
  {
    title: 'Insolvency notices',
    desc: 'ASIC and AFSA publish external administration and winding-up notices. These can appear mid-build and affect your ability to recover deposits.',
  },
  {
    title: 'Stage inspections',
    desc: 'Independent stage inspections at slab, frame, lockup, and practical completion catch defects before they become expensive. Your contract should include these.',
  },
  {
    title: 'Payment schedule',
    desc: 'Never pay ahead of stage completions. Run a quick re-check before each progress payment to confirm nothing has changed.',
  },
];

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

const watchItem: React.CSSProperties = {
  borderLeft: '3px solid #1A3A5C',
  marginBottom: '12px',
  paddingLeft: '12px',
};

const watchTitle: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '13px',
  fontWeight: '600',
  margin: '0 0 2px',
};

const watchDesc: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: 0,
};

const actionCard: React.CSSProperties = {
  backgroundColor: '#EBF4FF',
  border: '1px solid #BFDBFE',
  borderRadius: '8px',
  marginTop: '16px',
  padding: '20px 24px',
};

const actionTitle: React.CSSProperties = {
  color: '#1A3A5C',
  fontSize: '14px',
  fontWeight: '700',
  margin: '0 0 6px',
};

const actionDesc: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  lineHeight: '1.5',
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

const secondaryButton: React.CSSProperties = {
  backgroundColor: 'transparent',
  border: '1px solid #1A3A5C',
  borderRadius: '12px',
  color: '#1A3A5C',
  display: 'inline-block',
  fontSize: '13px',
  fontWeight: '600',
  padding: '10px 24px',
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

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  textAlign: 'center',
};

export default DuringBuild;
