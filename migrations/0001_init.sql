CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  spotify_user_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at INTEGER NOT NULL,
  session_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(session_expires_at);
