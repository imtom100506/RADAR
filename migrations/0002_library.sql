CREATE TABLE IF NOT EXISTS library_candidates (
  source TEXT NOT NULL, url TEXT NOT NULL, hint TEXT NOT NULL,
  discovered_at INTEGER NOT NULL, checked_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', metadata TEXT, reason TEXT,
  PRIMARY KEY(source,url)
);
CREATE INDEX IF NOT EXISTS library_candidates_check ON library_candidates(source,checked_at);
CREATE TABLE IF NOT EXISTS library_checks (
  source TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, status TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0, detail TEXT
);
