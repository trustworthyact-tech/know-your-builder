import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  // Base URL for every emailed/shared link (report, share, PDF, verification, reset).
  // Was "http://localhost:3000" in Vercel Production for ~5 months unnoticed, because
  // call sites fall back to localhost when it's missing — so refuse localhost in production.
  NEXTAUTH_URL: z
    .string()
    .url()
    .refine(
      (url) => process.env.VERCEL_ENV !== 'production' || !/localhost|127\.0\.0\.1/.test(url),
      'NEXTAUTH_URL must be the public site URL in production, not localhost'
    ),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
