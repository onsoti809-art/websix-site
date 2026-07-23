import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  // vars
  APP_URL: string;
  OWNER_EMAIL: string;
  FROM_EMAIL: string;
  // secrets
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  TURNSTILE_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export type Role =
  | 'super_admin' | 'administrator' | 'sales' | 'project_manager'
  | 'developer' | 'designer' | 'seo' | 'content' | 'support' | 'finance' | 'client';

export interface JwtUser {
  sub: string;
  email: string;
  role: Role;
  exp: number;
}
