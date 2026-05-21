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
  persona?: string;
}

const NEXT_STEPS: Record<string, { title: string; items: string[] }> = {
  HOMEOWNER: {
    title: 'Recommended next steps for homeowners',
    items: [
      'Share this report with your solicitor before signing the contract',
      'Confirm Home Warranty Insurance (HWI) is in place — required for most QLD residential contracts over $3,300',
      'Schedule independent stage inspections at slab, frame, lockup, and practical completion',
      'Keep the report on file — consider a re-check at the 30-day mark of your build',
    ],
  },
  DEVELOPER: {
    title: 'Recommended next steps for developers',
    items: [
      'File this report with your project due diligence documentation',
      'Set up ongoing monitoring to receive alerts if anything changes during the project',
      'Confirm the builder holds appropriate insurance — public liability and contract works',
      'Schedule independent progress inspections at key milestones',
    ],
  },
  SUBCONTRACTOR: {
    title: 'Recommended next steps for subcontractors',
    items: [
      'Keep this report with your contract documents',
      'Register any security interest in supplied goods on the PPSR before delivery',
      'Confirm payment terms in writing and issue compliant payment claims at each milestone',
      'Re-check before any major contract extension or payment milestone',
    ],
  },
  LENDER: {
    title: 'Recommended next steps for lenders',
    items: [
      'File this report with your credit assessment documentation',
      'Confirm the builder holds appropriate insurance for the project value',
      'Set up monitoring to receive alerts if licence status or insolvency details change',
      'Schedule a re-check at each draw-down milestone',
    ],
  },
  DEFAULT: {
    title: 'Recommended next steps',
    items: [
      'Keep this report on file for your records',
      'Share with relevant parties — solicitor, lender, or project manager',
      'Consider a re-check in 30–90 days, particularly before payment milestones',
      'Set up monitoring if this is a long-term or high-value engagement',
    ],
  },
};

export function CleanReport({ entityName, entityAbn, reportUrl, persona }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;
  const nextSteps = NEXT_STEPS[persona ?? 'DEFAULT'] ?? NEXT_STEPS.DEFAULT;

  return (
    <Html>
      <Head />
      <Preview>All clear — {entityName} passed your due diligence check</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Due diligence complete</Text>
          </Section>

          <Section style={clearBanner}>
            <Text style={clearText}>✓ All clear — no significant findings</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              Your Know Your Builder search returned no significant findings. The databases
              searched include the QBCC licence register, court and tribunal records, insolvency
              notices, payment times reporting, and the modern slavery register.
            </Text>

            <Text style={paragraph}>
              A clean report is a good sign — but it reflects publicly available information at the
              time of the search. Circumstances can change. Keep this report on file and consider a
              re-check before key milestones.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={reportUrl} style={ctaButton}>
                View Full Report →
              </Button>
            </Section>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>{nextSteps.title}</Text>
            {nextSteps.items.map((item) => (
              <Text key={item} style={stepItem}>
                → {item}
              </Text>
            ))}
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              This report is based on publicly available information sourced automatically from
              government databases. A clean result does not guarantee the builder is suitable for
              your project — always verify material facts directly.
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

const clearBanner: React.CSSProperties = {
  backgroundColor: '#D1FAE5',
  border: '1px solid #6EE7B7',
  borderTop: 'none',
  padding: '12px 32px',
};

const clearText: React.CSSProperties = {
  color: '#065F46',
  fontSize: '13px',
  fontWeight: '600',
  margin: 0,
  textAlign: 'center',
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

const stepItem: React.CSSProperties = {
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

export default CleanReport;
