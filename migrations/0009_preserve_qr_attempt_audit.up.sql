-- Session retention must not cascade into immutable completed attempts. The
-- session is verified when a QR proof is written and read; retaining its UUID
-- here after session deletion preserves the audit binding without blocking
-- cleanup or deleting the attempt referenced by mission_completions.
ALTER TABLE mission_attempts DROP CONSTRAINT mission_attempts_qr_session_id_fkey;
