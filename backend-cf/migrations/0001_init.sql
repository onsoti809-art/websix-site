-- Websix D1 schema (core services). Applied with: wrangler d1 migrations apply websix-db --remote
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,
  business_name  TEXT NOT NULL,
  category       TEXT,
  city           TEXT,
  country        TEXT DEFAULT 'USA',
  phone          TEXT,
  email          TEXT,
  website_status TEXT,
  score          INTEGER,
  priority       TEXT,
  social         TEXT,
  notes          TEXT,
  status         TEXT DEFAULT 'new',
  assigned_to    TEXT,
  source         TEXT DEFAULT 'research',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  public_id    TEXT UNIQUE NOT NULL,
  client_id    TEXT,
  type         TEXT,
  status       TEXT DEFAULT 'quote_requested',
  summary      TEXT,
  tier         TEXT,
  estimate_low  INTEGER,
  estimate_high INTEGER,
  data         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  amount     INTEGER DEFAULT 0,
  currency   TEXT DEFAULT 'usd',
  scope      TEXT,
  status     TEXT DEFAULT 'submitted',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  currency   TEXT DEFAULT 'usd',
  status     TEXT DEFAULT 'unpaid',
  stripe_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  invoice_id TEXT,
  amount     INTEGER NOT NULL,
  currency   TEXT DEFAULT 'usd',
  status     TEXT DEFAULT 'succeeded',
  stripe_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  type       TEXT NOT NULL,
  message    TEXT,
  meta       TEXT,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sender     TEXT,
  body       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
