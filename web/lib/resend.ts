import { Resend } from 'resend';

const globalForResend = globalThis as unknown as { resend?: Resend };

export function getResend(): Resend {
  if (!globalForResend.resend) {
    globalForResend.resend = new Resend(process.env.RESEND_API_KEY);
  }
  return globalForResend.resend;
}
