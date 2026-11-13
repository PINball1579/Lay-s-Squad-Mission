-- Keep qr_runner and the existing session-bound proof columns for history.
-- This reserved internal proof source is written only after backend OCR passes.
INSERT INTO qr_locations(campaign_id,code,name,active,metadata)
SELECT id,'receipt-lays','OpenThai receipt verification',true,'{"internalProofSource":"receipt_ocr"}'::jsonb FROM campaigns
ON CONFLICT(campaign_id,code) DO NOTHING;

UPDATE roles SET name='นักล่าใบเสร็จ' WHERE code='qr_runner';
INSERT INTO missions(role_id,version,content,active)
SELECT id,2,'{"kind":"receipt_ocr","maxUploadBytes":10485760,"provider":"OpenThai 2.0 OCR Text"}'::jsonb,true FROM roles WHERE code='qr_runner'
ON CONFLICT(role_id,version) DO NOTHING;
