CREATE TABLE login_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chatgpt INTEGER NOT NULL CHECK (chatgpt IN (0, 1)),
  password INTEGER NOT NULL CHECK (password IN (0, 1)),
  oidc INTEGER NOT NULL CHECK (oidc IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE oidc_accounts (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (issuer, subject)
);
--> statement-breakpoint
CREATE TABLE oidc_flows (
  state_hash TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX oidc_flows_by_expiry ON oidc_flows(expires_at);
--> statement-breakpoint
CREATE TABLE password_attempts (
  username TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX password_attempts_by_expiry ON password_attempts(expires_at);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN moderated_at TEXT;
