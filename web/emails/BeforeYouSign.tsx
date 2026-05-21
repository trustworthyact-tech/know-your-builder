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
  step: number;
}

const CHECKLIST = [
  'Verify the QBCC licence is current and covers your project type',
  'Review all court and tribunal findings in the report',
  'Confirm no insolvency or ATO debt notices are on file',
  'Check payment times compliance status',
  'Consider Home Warranty Insurance (HWI) — mandatory for most QLD residential contracts over $3,300',
  'Share this report with your solicitor or building inspector before signing',
];

export function BeforeYouSign({ entityName, entityAbn, reportUrl, step }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;

  if (step === 1) {
    return (
      <Html>
        <Head />
        <Preview>Reminder — review your builder report before you sign</Preview>
        <Body style={body}>
          <Container style={container}>
            <Section style={header}>
              <Heading style={headerHeading}>Know Your Builder</Heading>
              <Text style={headerSub}>Pre-contract reminder</Text>
            </Section>

            <Section style={card}>
              <Text style={label}>REPORT FOR</Text>
              <Heading style={entityHeading}>{entityLabel}</Heading>

              <Text style={paragraph}>
                This is a quick reminder — you ran a due diligence check on this builder a few days
                ago. Make sure you or your solicitor has reviewed the full report before signing any
                contract.
              </Text>

              <Section style={{ textAlign: 'center', margin: '24px 0' }}>
                <Button href={reportUrl} style={ctaButton}>
                  Review Report →
                </Button>
              </Section>

              <Text style={tip}>
                Not ready yet? Your report stays available in your Know Your Builder account.
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
      <Preview>Before you sign — your builder due diligence checklist for {entityName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Pre-contract checklist</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              Your due diligence search is complete. Before you sign any contract with this builder,
              work through this checklist:
            </Text>

            {CHECKLIST.map((item) => (
              <Text key={item} style={checklistItem}>
                ✓ {item}
              </Text>
            ))}

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={reportUrl} style={ctaButton}>
                View Full Report →
              </Button>
            </Section>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>Why this matters</Text>
            <Text style={paragraph}>
              Builder insolvency is one of the most common causes of construction disputes in
              Australia. A licence check and insolvency search takes minutes but can save months of
              legal headaches.
            </Text>
          </Section>

          <Hr style={hr} />
          <Section>
            <Text style={disclaimer}>
              This report is based on publicly available information. It does not constitute legal or
              financial advice. Verify findings directly with the relevant authority before making
              decisions.
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

const checklistItem: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '4px 0',
  paddingLeft: '4px',
};

const tip: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '16px 0 0',
  textAlign: 'center',
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

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  textAlign: 'center',
};

export default BeforeYouSign;
