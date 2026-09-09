
ALTER TABLE devices
-- The login session that started this camera
ADD COLUMN publishing_owner_session_id UUID
    REFERENCES auth_sessions(id) ON DELETE SET NULL,
ADD COLUMN publishing_lease_expires_at TIMESTAMPTZ;