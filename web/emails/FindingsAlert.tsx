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

interface RiskGroup {
  label: string;
  description: string;
}

interface Props {
  entityName: string;
  entityAbn?: string;
  reportUrl: string;
  riskGroups: RiskGroup[];
}

const RECOMMENDED_ACTIONS: Record<string, string> = {
  INSOLVENCY: 'Do not make any advance payments. Seek legal advice before signing or continuing with this builder.',
  PAYMENT: 'Request a written explanation and obtain references from recent subcontractors before proceeding.',
  LICENSING: 'Verify licence status directly with the relevant authority before allowing any work to commence.',
  LEGAL: 'Read the full court and tribunal findings in the report. Consider seeking independent legal advice.',
  CORPORATE: 'Investigate the connected entities and former-director history before proceeding.',
};

export function FindingsAlert({ entityName, entityAbn, reportUrl, riskGroups }: Props) {
  const entityLabel = entityAbn ? `${entityName} (ABN ${entityAbn})` : entityName;
  const topGroup = riskGroups[0];

  return (
    <Html>
      <Head />
      <Preview>
        Important findings on {entityName} — action recommended
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Findings — review recommended</Text>
          </Section>

          <Section style={warningBanner}>
            <Text style={warningText}>
              ⚠ Your search returned {riskGroups.length} finding{riskGroups.length !== 1 ? 's' : ''}{' '}
              that warrant further review.
            </Text>
          </Section>

          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityLabel}</Heading>

            <Text style={paragraph}>
              The following risk areas were triggered in your due diligence report. Read the full
              report and consider seeking professional advice before proceeding.
            </Text>
          </Section>

          {riskGroups.map((group) => (
            <Section key={group.label} style={findingCard}>
              <Text style={findingLabel}>{group.label}</Text>
              <Text style={findingDesc}>{group.description}</Text>
              {RECOMMENDED_ACTIONS[group.label.toUpperCase().replace(/ /g, '_')] && (
                <Text style={actionText}>
                  → {RECOMMENDED_ACTIONS[group.label.toUpperCase().replace(/ /g, '_')]}
                </Text>
              )}
            </Section>
          ))}

          {topGroup && RECOMMENDED_ACTIONS[topGroup.label.toUpperCase().replace(/ /g, '_')] ? null : (
            <Section style={findingCard}>
              <Text style={actionText}>
                → Review the full report and, where relevant, seek legal or financial advice before
                proceeding.
              </Text>
            </Section>
          )}

          <Section style={{ textAlign: 'center', marginTop: '16px' }}>
            <Button href={reportUrl} style={ctaButton}>
              View Full Report →
            </Button>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={sectionTitle}>Important reminder</Text>
            <Text style={paragraph}>
              Findings in this report are drawn from publicly available government sources. They
              indicate areas requiring further investigation — not necessarily that the builder is
              unsuitable. Always verify findings directly with the relevant authority and seek
              professional advice before making decisions.
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

const warningBanner: React.CSSProperties = {
  backgroundColor: '#FEF3C7',
  border: '1px solid #F59E0B',
  borderTop: 'none',
  padding: '12px 32px',
};

const warningText: React.CSSProperties = {
  color: '#92400E',
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

const findingCard: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderLeft: '4px solid #B45309',
  borderRight: '1px solid #D1D9E0',
  borderTop: '1px solid #EEF1F6',
  padding: '16px 20px 16px 24px',
};

const findingLabel: React.CSSProperties = {
  color: '#B45309',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.5px',
  margin: '0 0 4px',
  textTransform: 'uppercase',
};

const findingDesc: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: '0 0 6px',
};

const actionText: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  fontStyle: 'italic',
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

export default FindingsAlert;
