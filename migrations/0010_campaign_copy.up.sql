UPDATE campaigns
SET name = 'Lay''s Crunch Squad', updated_at = now()
WHERE slug = 'demo-campaign';

UPDATE campaign_configs
SET config = config || '{"assetStatus":"campaign-ready"}'::jsonb
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');

UPDATE roles
SET name = CASE code
  WHEN 'flavor_scout' THEN 'นักล่ารสชาติ'
  WHEN 'crunch_creator' THEN 'ครีเอเตอร์สายครันช์'
  WHEN 'snack_detective' THEN 'นักสืบสายสแน็ก'
  WHEN 'qr_runner' THEN 'นักวิ่ง QR'
END
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');

UPDATE qr_locations
SET name = 'จุดกิจกรรม Lay''s Crunch Squad กรุงเทพฯ'
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code = 'demo-store';

UPDATE rewards
SET name = 'สิทธิ์รางวัลพิเศษจาก Lay''s Crunch Squad',
    config = '{"fulfillment":"campaign-configured"}'::jsonb
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code = 'mock-badge';
