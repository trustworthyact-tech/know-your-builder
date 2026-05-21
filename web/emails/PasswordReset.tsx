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
  name: string;
  resetUrl: string;
}

export function PasswordReset({ name, resetUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Reset your Know Your Builder password</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Password reset</Text>
          </Section>

          <Section style={card}>
            <Text style={greeting}>Hi {name},</Text>
            <Text style={paragraph}>
              We received a request to reset the password for your Know Your Builder account. Click
              the button below to choose a new password. This link expires in 1 hour.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={resetUrl} style={ctaButton}>
                Reset Password →
              </Button>
            </Section>

            <Text style={note}>
              If you didn&apos;t request a password reset, you can safely ignore this email — your
              password will not be changed.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              For security, this link expires after 1 hour and can only be used once.
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
  maxWidth: '480px',
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
  padding: '28px 32px',
};

const greeting: React.CSSProperties = {
  color: '#0F1C2E',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 12px',
};

const paragraph: React.CSSProperties = {
  color: '#4A5568',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 8px',
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

const note: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '16px 0 0',
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

export default PasswordReset;
