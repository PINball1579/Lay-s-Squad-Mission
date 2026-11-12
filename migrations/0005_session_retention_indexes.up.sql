CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX sessions_revoked_idx ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
