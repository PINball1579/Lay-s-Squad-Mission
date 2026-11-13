-- Promote Flavor Cup to the 16-flavor campaign format. Existing attempts keep
-- their persisted bracket; new attempts use this newest mission configuration.
INSERT INTO missions (role_id, version, content, active)
SELECT id, 3, $json$
{
  "bracketSize": 16,
  "placementMode": "random",
  "seedOrder": [],
  "shareCard": {"title":"My Flavor Champion","accent":"#ffd928","message":"แชมป์รสชาติของฉันคือ {flavor} จาก Lay's Crunch Squad"},
  "flavors": [
    {"id":"classic","name":"Classic","description":"เค็มคลาสสิก กรอบทุกคำ","image":"/missions/products/classic.jpg","color":"#d5a900"},
    {"id":"bbq","name":"Bar-B-Q","description":"หอมเข้มสไตล์บาร์บีคิว","image":"/missions/products/barbecue.jpg","color":"#b9472c"},
    {"id":"nori","name":"Nori Seaweed","description":"หอมสาหร่ายเต็มรส","image":"/missions/products/salt-vinegar.jpg","color":"#287443"},
    {"id":"sour-cream","name":"Sour Cream & Onion","description":"ครีมมี่ หอมหัวหอม","image":"/missions/products/sour-cream.jpg","color":"#4087a4"},
    {"id":"hot-spicy","name":"Hot & Spicy","description":"เผ็ดร้อนแบบถึงใจ","image":"/missions/products/barbecue.jpg","color":"#c12f26"},
    {"id":"cheese","name":"Cheese","description":"ชีสเข้มข้นทุกแผ่น","image":"/missions/products/classic.jpg","color":"#d87918"},
    {"id":"truffle","name":"Truffle","description":"หอมทรัฟเฟิลสไตล์พรีเมียม","image":"/missions/products/classic.jpg","color":"#493854"},
    {"id":"lime","name":"Zesty Lime","description":"เปรี้ยวซ่า สดชื่น","image":"/missions/products/salt-vinegar.jpg","color":"#6b9120"},
    {"id":"salt-pepper","name":"Salt & Pepper","description":"เค็มหอมพริกไทย","image":"/missions/products/classic.jpg","color":"#3f4148"},
    {"id":"tom-yum","name":"Tom Yum","description":"แซ่บครบรสต้มยำ","image":"/missions/products/barbecue.jpg","color":"#dc551f"},
    {"id":"mala","name":"Mala","description":"เผ็ดชา หอมเครื่องเทศ","image":"/missions/products/barbecue.jpg","color":"#722121"},
    {"id":"sweet-basil","name":"Sweet Basil","description":"หอมกะเพรา รสจัดจ้าน","image":"/missions/products/sour-cream.jpg","color":"#2c6337"},
    {"id":"chicken","name":"Roasted Chicken","description":"หอมไก่อบกลมกล่อม","image":"/missions/products/classic.jpg","color":"#985129"},
    {"id":"shrimp","name":"Grilled Shrimp","description":"หอมกุ้งย่าง","image":"/missions/products/barbecue.jpg","color":"#c85c51"},
    {"id":"pizza","name":"Pizza","description":"ชีสและมะเขือเทศลงตัว","image":"/missions/products/barbecue.jpg","color":"#aa362d"},
    {"id":"honey-butter","name":"Honey Butter","description":"หวานหอมเนย","image":"/missions/products/sour-cream.jpg","color":"#c78b22"}
  ]
}
$json$::jsonb, true
FROM roles
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign')
  AND code = 'crunch_creator'
ON CONFLICT (role_id, version) DO UPDATE SET content=EXCLUDED.content, active=true;

UPDATE campaign_configs
SET config = config || '{"missionVersion":3,"flavorCupDefaultSize":16}'::jsonb
WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = 'demo-campaign');
