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
  searchId: string;
  totalHits: number;
  courtHits: number;
  hasFindings: boolean;
  reportUrl: string;
  generatedAt: string;
}

export function ReportEmail({
  entityName,
  searchId: _searchId,
  totalHits,
  courtHits,
  hasFindings,
  reportUrl,
  generatedAt,
}: Props) {
  const riskLabel = hasFindings ? 'Findings — review recommended' : 'Clear — no significant findings';
  const riskColour = hasFindings ? '#B45309' : '#2E7D53';

  return (
    <Html>
      <Head />
      <Preview>Your Know Your Builder report for {entityName} is ready</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Automated due diligence report</Text>
          </Section>

          {/* Entity card */}
          <Section style={card}>
            <Text style={label}>REPORT FOR</Text>
            <Heading style={entityHeading}>{entityName}</Heading>
            <Text style={meta}>Generated {generatedAt}</Text>

            <Section style={statsRow}>
              <table width="100%" cellPadding={0} cellSpacing={0}>
                <tbody>
                  <tr>
                    <td style={statCell} align="center">
                      <Text style={statNumber}>{totalHits}</Text>
                      <Text style={statCaption}>Records found</Text>
                    </td>
                    <td style={statDivider} />
                    <td style={statCell} align="center">
                      <Text style={statNumber}>{courtHits}</Text>
                      <Text style={statCaption}>Court / tribunal</Text>
                    </td>
                    <td style={statDivider} />
                    <td style={statCell} align="center">
                      <Text style={{ ...statNumber, color: riskColour }}>{riskLabel}</Text>
                      <Text style={statCaption}>Risk indicator</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
          </Section>

          {/* CTA */}
          <Section style={{ textAlign: 'center', marginTop: '24px' }}>
            <Button href={reportUrl} style={ctaButton}>
              View Full Report →
            </Button>
          </Section>

          <Hr style={hr} />

          {/* Sections summary */}
          <Section>
            <Text style={sectionTitle}>What was searched</Text>
            {SEARCHED.map((s) => (
              <Text key={s} style={searchedItem}>
                ✓ {s}
              </Text>
            ))}
          </Section>

          <Hr style={hr} />

          {/* Disclaimer */}
          <Section>
            <Text style={disclaimer}>
              This report is based on publicly available information sourced automatically from
              government databases. It is provided for informational purposes only and does not
              constitute legal, financial or professional advice. The absence of records does not
              guarantee a clean history.
            </Text>
            <Text style={disclaimer}>
              © Know Your Builder · Unsubscribe any time
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const SEARCHED = [
  'Australian Business Register (ABR)',
  'Payment Times Reporting Register',
  'Modern Slavery Statements Register',
  'QBCC Licence & Adjudication Register',
  'Federal & all state/territory courts (AustLII)',
  '35+ additional government databases (links provided)',
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
  margin: '0 0 4px',
};

const meta: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  margin: '0 0 20px',
};

const statsRow: React.CSSProperties = {
  borderTop: '1px solid #EEF1F6',
  paddingTop: '16px',
};

const statCell: React.CSSProperties = {
  padding: '0 8px',
};

const statDivider: React.CSSProperties = {
  borderLeft: '1px solid #EEF1F6',
  width: '1px',
};

const statNumber: React.CSSProperties = {
  color: '#1A3A5C',
  fontSize: '18px',
  fontWeight: '700',
  margin: '0 0 2px',
};

const statCaption: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
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

const searchedItem: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '13px',
  margin: '2px 0',
};

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
};

export default ReportEmail;
