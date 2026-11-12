ALTER TABLE roles ADD CONSTRAINT roles_id_campaign_unique UNIQUE (id, campaign_id);
ALTER TABLE squad_members ADD CONSTRAINT squad_members_id_squad_unique UNIQUE (id, squad_id);

ALTER TABLE role_assignments ADD COLUMN campaign_id uuid;
UPDATE role_assignments assignment
SET campaign_id = squad.campaign_id
FROM squads squad
WHERE squad.id = assignment.squad_id;
ALTER TABLE role_assignments ALTER COLUMN campaign_id SET NOT NULL;
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_squad_id_fkey;
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_member_id_fkey;
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_role_id_fkey;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_squad_campaign_fkey FOREIGN KEY (squad_id, campaign_id) REFERENCES squads(id, campaign_id) ON DELETE CASCADE;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_member_squad_fkey FOREIGN KEY (member_id, squad_id) REFERENCES squad_members(id, squad_id) ON DELETE CASCADE;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_role_campaign_fkey FOREIGN KEY (role_id, campaign_id) REFERENCES roles(id, campaign_id) ON DELETE RESTRICT;

ALTER TABLE rewards ADD CONSTRAINT rewards_id_campaign_unique UNIQUE (id, campaign_id);
ALTER TABLE reward_inventory ADD CONSTRAINT reward_inventory_id_reward_unique UNIQUE (id, reward_id);
ALTER TABLE reward_unlocks ADD COLUMN campaign_id uuid;
UPDATE reward_unlocks unlock
SET campaign_id = squad.campaign_id
FROM squads squad
WHERE squad.id = unlock.squad_id;
ALTER TABLE reward_unlocks ALTER COLUMN campaign_id SET NOT NULL;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_squad_id_fkey;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_reward_id_fkey;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_inventory_id_fkey;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_squad_campaign_fkey FOREIGN KEY (squad_id, campaign_id) REFERENCES squads(id, campaign_id) ON DELETE CASCADE;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_reward_campaign_fkey FOREIGN KEY (reward_id, campaign_id) REFERENCES rewards(id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_inventory_reward_fkey FOREIGN KEY (inventory_id, reward_id) REFERENCES reward_inventory(id, reward_id) ON DELETE RESTRICT;


