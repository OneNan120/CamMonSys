ALTER TABLE events
  ADD COLUMN IF NOT EXISTS snapshot_data BYTEA,
  ADD COLUMN IF NOT EXISTS snapshot_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at TIMESTAMPTZ;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_snapshot_consistency;

ALTER TABLE events
  ADD CONSTRAINT events_snapshot_consistency CHECK (
    (
      snapshot_data IS NULL
      AND snapshot_mime_type IS NULL
      AND snapshot_size_bytes IS NULL
      AND snapshot_captured_at IS NULL
    )
    OR
    (
      snapshot_data IS NOT NULL
      AND snapshot_mime_type = 'image/jpeg'
      AND snapshot_size_bytes > 0
      AND snapshot_size_bytes <= 2097152
      AND snapshot_captured_at IS NOT NULL
    )
  );
