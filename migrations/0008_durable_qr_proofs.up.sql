ALTER TABLE mission_attempts
    ADD COLUMN qr_location_id uuid REFERENCES qr_locations(id) ON DELETE RESTRICT,
    ADD COLUMN qr_session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
    ADD COLUMN qr_nonce text,
    ADD COLUMN qr_proof_expires_at timestamptz;

ALTER TABLE mission_attempts ADD CONSTRAINT mission_attempts_qr_proof_complete CHECK (
    (qr_location_id IS NULL AND qr_session_id IS NULL AND qr_nonce IS NULL AND qr_proof_expires_at IS NULL)
    OR
    (qr_location_id IS NOT NULL AND qr_session_id IS NOT NULL AND qr_nonce IS NOT NULL AND qr_proof_expires_at IS NOT NULL)
);
