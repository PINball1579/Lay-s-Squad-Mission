BEGIN;

DELETE FROM analytics_events
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');

DELETE FROM reward_redemptions
WHERE unlock_id IN (
  SELECT ru.id FROM reward_unlocks ru
  JOIN campaigns c ON c.id = ru.campaign_id
  WHERE c.slug = 'demo-campaign'
);

DELETE FROM squads
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');

UPDATE reward_inventory inventory
SET state = 'available', reserved_at = NULL, redeemed_at = NULL
FROM rewards reward
JOIN campaigns campaign ON campaign.id = reward.campaign_id
WHERE inventory.reward_id = reward.id AND campaign.slug = 'demo-campaign';

DELETE FROM users WHERE pseudonymous_id LIKE 'mock:%';

COMMIT;
