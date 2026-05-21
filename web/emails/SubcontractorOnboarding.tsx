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

export function SubcontractorOnboarding({ entityName, entityAbn, reportUrl }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;

  return (
    <Html>
      <Head />
      <Preview>Subcontractor due diligence complete — next steps for {entityName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Subcontractor due diligence</Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              Your due diligence check on this principal contractor is complete. Keep this report on
              file and consider the following steps to protect your position on this job.
            </Text>
          </Section>

          {STEPS.map((step) => (
            <Section key={step.title} style={stepCard}>
              <Text style={stepNumber}>{step.number}</Text>
              <Text style={stepTitle}>{step.title}</Text>
              <Text style={stepDesc}>{step.desc}</Text>
            </Section>
          ))}

          <Section style={{ textAlign: 'center', marginTop: '8px' }}>
            <Button href={reportUrl} style={ctaButton}>
              View Full Report →
            </Button>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>Know your rights</Text>
            <Text style={paragraph}>
              Under the <em>Building Industry Fairness (Security of Payment) Act 2017</em> (QLD) and
              equivalent state legislation, you have the right to make payment claims and refer
              disputes to adjudication if a principal contractor fails to pay. Keep records of all
              payment claims, schedules, and correspondence.
            </Text>
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

const STEPS = [
  {
    number: '01',
    title: 'Keep this report on file',
    desc: 'Store the report with your contract documents. If a dispute arises, a dated due diligence check demonstrates you acted with care before commencing work.',
  },
  {
    number: '02',
    title: 'Check the PPSR before supplying goods on credit',
    desc: 'If you are supplying materials or plant on credit, register your security interest on the Personal Property Securities Register (PPSR) before delivery. An unregistered interest may be lost if the contractor enters external administration.',
  },
  {
    number: '03',
    title: 'Consider trade credit insurance',
    desc: 'Trade credit insurance covers outstanding invoices if your customer becomes insolvent. Premiums are typically 0.2–0.5% of insured turnover — often less than the cost of one bad debt.',
  },
  {
    number: '04',
    title: 'Re-check before major milestones',
    desc: 'Run a quick re-check before each major payment milestone or contract extension. Licence suspensions and insolvency notices can appear at any time.',
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

const stepCard: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderLeft: '1px solid #D1D9E0',
  borderRight: '1px solid #D1D9E0',
  borderTop: '1px solid #EEF1F6',
  padding: '16px 32px',
};

const stepNumber: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '1px',
  margin: '0 0 2px',
};

const stepTitle: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '14px',
  fontWeight: '600',
  margin: '0 0 4px',
};

const stepDesc: React.CSSProperties = {
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

export default SubcontractorOnboarding;
