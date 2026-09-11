-- Preserve historical Last Seen while identifying reports from a new run.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS publishing_started_at TIMESTAMPTZ;
