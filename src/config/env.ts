import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64, 'Must be 32 bytes hex-encoded'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url(),

  // Cloudflare R2 Storage
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Email Provider
  EMAIL_PROVIDER: z.enum(['console', 'mailgun']).default('console'),
  EMAIL_FROM: z.string().default('noreply@template-base.com'),

  // Mailgun (required when EMAIL_PROVIDER=mailgun)
  MAILGUN_API_KEY: z.string().min(1).optional(),
  MAILGUN_DOMAIN: z.string().min(1).optional(),
  MAILGUN_REGION: z.enum(['us', 'eu']).default('us'),

  // Cookie domain for cross-subdomain auth (ex: '.seudominio.com')
  COOKIE_DOMAIN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
