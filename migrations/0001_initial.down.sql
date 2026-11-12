BEGIN;
DROP TABLE IF EXISTS audit_logs, admin_users, analytics_events, reward_redemptions, reward_unlocks, reward_inventory, rewards, qr_locations, invitations, mission_completions, mission_attempts, role_assignments, squad_members, squads, missions, roles, campaign_configs, campaigns, consent_records, sessions, line_identities, users CASCADE;
COMMIT;

