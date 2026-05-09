-- featherless memory metadata store (D1)
-- Each row is one extracted clinical fact; vectors live in Vectorize keyed by the same id.

CREATE TABLE IF NOT EXISTS facts (
  id               TEXT PRIMARY KEY,                     -- ulid()
  user_id          TEXT NOT NULL,                        -- "patient:<FHIR id>"
  fact             TEXT NOT NULL,                        -- extracted atomic fact
  fact_type        TEXT NOT NULL,                        -- encounter|alert|note|radiology|transcript|...
  source_encounter TEXT,                                 -- optional FHIR Encounter id
  metadata_json    TEXT,                                 -- arbitrary JSON-encoded extras
  created_at       INTEGER NOT NULL                      -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_facts_user      ON facts(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_user_type ON facts(user_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_facts_created   ON facts(created_at DESC);
