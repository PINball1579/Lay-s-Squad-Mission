-- Keep the original role codes so historical assignments, completions, and
-- analytics remain connected while replacing only their display/game content.
UPDATE roles
SET name = CASE code
  WHEN 'flavor_scout' THEN 'Crunch Hunter'
  WHEN 'crunch_creator' THEN 'Flavor Referee'
END
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code IN ('flavor_scout', 'crunch_creator');

INSERT INTO missions (role_id, version, content, active)
SELECT id, 2, $json$
{
  "timerSeconds": 90,
  "maxHints": 2,
  "comparisonMode": "responsive",
  "images": {
    "left": "/missions/crunch-hunt-a.svg",
    "right": "/missions/crunch-hunt-b.svg",
    "alt": "ชั้นวางสินค้าแบบจำลองสำหรับเกมจับผิดภาพ"
  },
  "scoring": {
    "basePerDifference": 100,
    "speedBonusPerSecond": 5,
    "wrongTapPenalty": 15,
    "hintPenalty": 25
  },
  "differences": [
    {"id":"promo-sign","x":0.50,"y":0.13,"radius":0.09,"hint":"ดูป้ายโปรโมชันด้านบน"},
    {"id":"missing-bag","x":0.19,"y":0.43,"radius":0.09,"hint":"ลองดูจำนวนถุงบนชั้นกลาง"},
    {"id":"color-swap","x":0.76,"y":0.43,"radius":0.09,"hint":"สีถุงหนึ่งใบไม่เหมือนกัน"},
    {"id":"shelf-label","x":0.35,"y":0.72,"radius":0.08,"hint":"ป้ายราคาบนชั้นล่างขยับไป"},
    {"id":"quantity","x":0.82,"y":0.73,"radius":0.09,"hint":"นับจำนวนสินค้าด้านขวาล่าง"}
  ]
}
$json$::jsonb, true
FROM roles
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code = 'flavor_scout'
ON CONFLICT (role_id, version) DO UPDATE SET content=EXCLUDED.content, active=true;

INSERT INTO missions (role_id, version, content, active)
SELECT id, 2, $json$
{
  "bracketSize": 8,
  "placementMode": "random",
  "seedOrder": [],
  "shareCard": {"title":"My Flavor Champion","accent":"#d93b2b","message":"แชมป์รสชาติของฉันคือ {flavor} จาก Lay's Crunch Squad"},
  "flavors": [
    {"id":"classic","name":"Classic","description":"เค็มคลาสสิก กรอบทุกคำ","image":"/missions/flavor-placeholder.svg","color":"#f6c928"},
    {"id":"bbq","name":"Bar-B-Q","description":"หอมเข้มสไตล์บาร์บีคิว","image":"/missions/flavor-placeholder.svg","color":"#d85a35"},
    {"id":"nori","name":"Nori Seaweed","description":"หอมสาหร่ายเต็มรส","image":"/missions/flavor-placeholder.svg","color":"#42945b"},
    {"id":"sour-cream","name":"Sour Cream & Onion","description":"ครีมมี่ หอมหัวหอม","image":"/missions/flavor-placeholder.svg","color":"#78b9cf"},
    {"id":"hot-spicy","name":"Hot & Spicy","description":"เผ็ดร้อนแบบถึงใจ","image":"/missions/flavor-placeholder.svg","color":"#d64032"},
    {"id":"cheese","name":"Cheese","description":"ชีสเข้มข้นทุกแผ่น","image":"/missions/flavor-placeholder.svg","color":"#ef9d2f"},
    {"id":"truffle","name":"Truffle","description":"หอมทรัฟเฟิลสไตล์พรีเมียม","image":"/missions/flavor-placeholder.svg","color":"#5e4c68"},
    {"id":"lime","name":"Zesty Lime","description":"เปรี้ยวซ่า สดชื่น","image":"/missions/flavor-placeholder.svg","color":"#93b83e"}
  ]
}
$json$::jsonb, true
FROM roles
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code = 'crunch_creator'
ON CONFLICT (role_id, version) DO UPDATE SET content=EXCLUDED.content, active=true;

UPDATE campaign_configs
SET config = config || '{"missionVersion":2,"replacementGames":["crunch_hunt","flavor_cup"]}'::jsonb
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');
