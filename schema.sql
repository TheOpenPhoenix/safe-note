CREATE TABLE IF NOT EXISTS users (
  owner       TEXT    PRIMARY KEY,
  key_blob    TEXT    NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  seq         INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS notes (
  owner TEXT    NOT NULL REFERENCES users(owner) ON DELETE CASCADE,
  id    TEXT    NOT NULL,
  seq   INTEGER NOT NULL,
  iv    TEXT,
  ct    TEXT    CHECK (ct IS NULL OR length(ct) <= 1500000),
  PRIMARY KEY (owner, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS notes_sync ON notes(owner, seq);
