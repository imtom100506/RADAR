CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, initialized INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS entries (
  url TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), thread_id TEXT, local_day TEXT
);
CREATE INDEX IF NOT EXISTS entries_status_date ON entries(status, created_at);
CREATE INDEX IF NOT EXISTS entries_local_day ON entries(local_day, status);
CREATE TABLE IF NOT EXISTS locks (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
