-- Durable revocations are committed with the assignment/status change.
CREATE TABLE IF NOT EXISTS camera_responder_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  publishing_session_id TEXT NOT NULL,
  responder_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, publishing_session_id, responder_id)
);

CREATE OR REPLACE FUNCTION queue_responder_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE publication TEXT;
BEGIN
  IF OLD.assigned_to_id IS NOT NULL AND
     (NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id
      OR (OLD.status <> 'RESOLVED' AND NEW.status = 'RESOLVED')) THEN
    SELECT publishing_session_id INTO publication
    FROM devices WHERE id = OLD.device_id FOR UPDATE;
    IF publication IS NOT NULL THEN
      INSERT INTO camera_responder_revocations
        (device_id, publishing_session_id, responder_id)
      VALUES (OLD.device_id, publication, OLD.assigned_to_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_queue_revocation ON events;
CREATE TRIGGER events_queue_revocation
AFTER UPDATE OF assigned_to_id, status ON events
FOR EACH ROW EXECUTE FUNCTION queue_responder_revocation();
