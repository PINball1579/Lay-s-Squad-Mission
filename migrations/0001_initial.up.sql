CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonymous_id text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT 'Crunch Player',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE line_identities (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  line_subject_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_from uuid REFERENCES sessions(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  required_accepted boolean NOT NULL,
  analytics_allowed boolean NOT NULL DEFAULT false,
  notice_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (required_accepted OR NOT analytics_allowed)
);
CREATE INDEX consent_records_user_time_idx ON consent_records(user_id, recorded_at DESC);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','paused','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE campaign_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version integer NOT NULL,
  config jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, version)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  sort_order smallint NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(campaign_id, code),
  UNIQUE(campaign_id, sort_order)
);

CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, version)
);

CREATE TABLE squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('forming','active','completed','reward_unlocked','closed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE squads ADD CONSTRAINT squads_id_campaign_unique UNIQUE (id, campaign_id);
CREATE INDEX squads_campaign_status_idx ON squads(campaign_id, status, created_at);

CREATE TABLE squad_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('active','left','replaced')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  replaced_by uuid REFERENCES users(id),
  UNIQUE(squad_id, user_id),
  FOREIGN KEY (squad_id, campaign_id) REFERENCES squads(id, campaign_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_active_membership_per_campaign ON squad_members(user_id, campaign_id) WHERE state = 'active';

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES squad_members(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('claimed','in_progress','completed','released')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(squad_id, role_id),
  UNIQUE(squad_id, member_id)
);

CREATE TABLE mission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES role_assignments(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('started','failed','completed')),
  step integer NOT NULL DEFAULT 0,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX mission_attempts_assignment_idx ON mission_attempts(assignment_id, started_at DESC);

CREATE TABLE mission_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES role_assignments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, idempotency_key)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'squad',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_squad_active_idx ON invitations(squad_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE qr_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(campaign_id, code)
);

CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(campaign_id, code)
);

CREATE TABLE reward_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  inventory_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('available','reserved','redeemed','expired')),
  reserved_at timestamptz,
  redeemed_at timestamptz,
  UNIQUE(reward_id, inventory_key)
);
CREATE INDEX reward_inventory_available_idx ON reward_inventory(reward_id, id) WHERE state = 'available';

CREATE TABLE reward_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id uuid NOT NULL UNIQUE REFERENCES squads(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
  inventory_id uuid UNIQUE REFERENCES reward_inventory(id) ON DELETE RESTRICT,
  unlocked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unlock_id uuid NOT NULL UNIQUE REFERENCES reward_unlocks(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unlock_id, idempotency_key)
);

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  squad_id uuid REFERENCES squads(id) ON DELETE SET NULL,
  role_code text,
  mission_id uuid REFERENCES missions(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  campaign_source text,
  device_category text,
  consent_state text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX analytics_events_campaign_time_idx ON analytics_events(campaign_id, server_timestamp DESC);
CREATE INDEX analytics_events_name_time_idx ON analytics_events(name, server_timestamp DESC);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('viewer','editor','administrator')),
  password_hash text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);


