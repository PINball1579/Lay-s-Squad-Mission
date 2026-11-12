ALTER TABLE consent_records ADD COLUMN campaign_id uuid REFERENCES campaigns(id) ON DELETE RESTRICT;
UPDATE consent_records
SET campaign_id = '10000000-0000-0000-0000-000000000001'
WHERE campaign_id IS NULL;
ALTER TABLE consent_records ALTER COLUMN campaign_id SET NOT NULL;
DROP INDEX consent_records_user_time_idx;
CREATE INDEX consent_records_user_campaign_time_idx ON consent_records(user_id, campaign_id, recorded_at DESC);

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_squad_id_fkey;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_squad_campaign_fkey
  FOREIGN KEY (squad_id, campaign_id) REFERENCES squads(id, campaign_id) ON DELETE SET NULL (squad_id);

