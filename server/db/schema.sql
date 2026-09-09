-- WS0.3 (reliability plan) — generic ingestion schema. Two tables, no per-register
-- tables, so a new bulk dataset is a manifest row + one fetch function, not a migration.
-- Applied idempotently at startup by server/scrapers/db.js — no migration framework for
-- a schema this small (proportionate call; revisit if it grows past this).

CREATE TABLE IF NOT EXISTS dataset_snapshot (
  dataset_key   TEXT PRIMARY KEY,
  fetched_at    TIMESTAMPTZ NOT NULL,
  row_count     INTEGER NOT NULL,
  status        TEXT NOT NULL,          -- 'ok' | 'stale' | 'failed'
  source_url    TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS register_record (
  id              BIGSERIAL PRIMARY KEY,
  dataset_key     TEXT NOT NULL REFERENCES dataset_snapshot(dataset_key) ON DELETE CASCADE,
  jurisdiction    TEXT,
  abn             TEXT,
  acn             TEXT,
  normalised_name TEXT,                 -- lowercased, suffix-stripped, for local matching
  payload         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_register_record_dataset_abn  ON register_record(dataset_key, abn);
CREATE INDEX IF NOT EXISTS idx_register_record_dataset_acn  ON register_record(dataset_key, acn);
CREATE INDEX IF NOT EXISTS idx_register_record_norm_name    ON register_record(dataset_key, normalised_name);
