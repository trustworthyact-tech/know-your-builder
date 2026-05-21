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
  milestoneLabel: string;
  milestoneDateFormatted: string;
  amountFormatted: string;
}

export function PaymentDueReminder({
  entityName,
  entityAbn,
  reportUrl,
  milestoneLabel,
  milestoneDateFormatted,
  amountFormatted,
}: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;

  return (
    <Html>
      <Head />
      <Preview>
        Payment milestone coming up — {milestoneLabel} ({amountFormatted}) on {milestoneDateFormatted}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Upcoming payment milestone</Text>
          </Section>

          <Section style={milestoneBanner}>
            <Text style={milestoneLabel_style}>{milestoneLabel}</Text>
            <Text style={milestoneAmount}>{amountFormatted}</Text>
            <Text style={milestoneDate}>Due {milestoneDateFormatted}</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>BUILDER</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              A payment milestone is coming up in the next couple of days. Before releasing payment,
              it&apos;s worth running a quick re-check to confirm nothing has changed since your
              last search.
            </Text>

            <Text style={paragraph}>
              A re-check takes under a minute and costs $3 — or use a re-check credit if you have
              one in your account.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={reportUrl} style={ctaButton}>
                Re-check Before Paying ($3) →
              </Button>
            </Section>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>Payment protection checklist</Text>
            {[
              'Confirm the QBCC licence is still current — a suspended licence means work should stop',
              'Check for any new insolvency or administration notices filed since your last search',
              'Verify the stage of work matches what the payment schedule requires',
              'Book an independent stage inspection if this is a major milestone (slab, frame, lockup)',
              'Never pay ahead of a completed stage — confirm practical completion before final payment',
            ].map((item) => (
              <Text key={item} style={checkItem}>
                ✓ {item}
              </Text>
            ))}
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              This reminder is based on the payment schedule you recorded in your project timeline.
              It does not constitute legal or financial advice. Verify all payment obligations
              directly with your contract documents.
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

const milestoneBanner: React.CSSProperties = {
  backgroundColor: '#EBF4FF',
  border: '1px solid #BFDBFE',
  borderTop: 'none',
  padding: '16px 32px',
  textAlign: 'center',
};

const milestoneLabel_style: React.CSSProperties = {
  color: '#1A3A5C',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.5px',
  margin: '0 0 4px',
  textTransform: 'uppercase',
};

const milestoneAmount: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '24px',
  fontWeight: '700',
  margin: '0 0 2px',
};

const milestoneDate: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  margin: 0,
};

const card: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderLeft: '1px solid #D1D9E0',
  borderRight: '1px solid #D1D9E0',
  borderTop: '1px solid #EEF1F6',
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

const checkItem: React.CSSProperties = {
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

export default PaymentDueReminder;
