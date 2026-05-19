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
  verifyUrl: string;
}

export function VerifyEmail({ name, verifyUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Verify your Know Your Builder account</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerHeading}>Know Your Builder</Heading>
            <Text style={headerSub}>Email verification</Text>
          </Section>

          <Section style={card}>
            <Text style={greeting}>Hi {name},</Text>
            <Text style={paragraph}>
              Thanks for creating an account. Click the button below to verify your email address.
              This link expires in 24 hours.
            </Text>

            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={verifyUrl} style={ctaButton}>
                Verify Email Address →
              </Button>
            </Section>

            <Text style={note}>
              If you didn&apos;t create a Know Your Builder account, you can safely ignore this
              email.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={disclaimer}>
              © Know Your Builder · This email was sent to verify your account registration.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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

const note: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '16px 0 0',
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

const disclaimer: React.CSSProperties = {
  color: '#9AA5B4',
  fontSize: '11px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  textAlign: 'center',
};

export default VerifyEmail;
