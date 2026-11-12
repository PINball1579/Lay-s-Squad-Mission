INSERT INTO campaigns (id, slug, name, starts_at, ends_at, status)
VALUES ('10000000-0000-0000-0000-000000000001', 'demo-campaign', 'Lay''s Crunch Squad — Unofficial Demo', now() - interval '1 day', now() + interval '365 days', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO campaign_configs (campaign_id, version, config, published_at)
VALUES ('10000000-0000-0000-0000-000000000001', 1, '{"squadSize":4,"assetStatus":"placeholder","featureFlags":{"mockLiff":true,"survey":true}}', now())
ON CONFLICT (campaign_id, version) DO NOTHING;

INSERT INTO roles (id, campaign_id, code, name, sort_order) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','flavor_scout','Flavor Scout',1),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','crunch_creator','Crunch Creator',2),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','snack_detective','Snack Detective',3),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','qr_runner','QR Runner',4)
ON CONFLICT (campaign_id, code) DO NOTHING;

INSERT INTO qr_locations (campaign_id, code, name, metadata)
VALUES ('10000000-0000-0000-0000-000000000001','demo-store','Demo Bangkok Location','{"mock":true}')
ON CONFLICT (campaign_id, code) DO NOTHING;

INSERT INTO rewards (id, campaign_id, code, name, kind, config)
VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','mock-badge','Mock Crunch Badge','digital_mock','{"disclaimer":"DEMO — not a coupon"}')
ON CONFLICT (campaign_id, code) DO NOTHING;

INSERT INTO reward_inventory (reward_id, inventory_key, state)
SELECT '30000000-0000-0000-0000-000000000001', 'MOCK-' || generate_series(1, 100), 'available'
ON CONFLICT (reward_id, inventory_key) DO NOTHING;

