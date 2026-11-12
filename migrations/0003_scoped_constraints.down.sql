BEGIN;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_inventory_reward_fkey;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_reward_campaign_fkey;
ALTER TABLE reward_unlocks DROP CONSTRAINT reward_unlocks_squad_campaign_fkey;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_squad_id_fkey FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE RESTRICT;
ALTER TABLE reward_unlocks ADD CONSTRAINT reward_unlocks_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES reward_inventory(id) ON DELETE RESTRICT;
ALTER TABLE reward_unlocks DROP COLUMN campaign_id;
ALTER TABLE reward_inventory DROP CONSTRAINT reward_inventory_id_reward_unique;
ALTER TABLE rewards DROP CONSTRAINT rewards_id_campaign_unique;

ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_role_campaign_fkey;
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_member_squad_fkey;
ALTER TABLE role_assignments DROP CONSTRAINT role_assignments_squad_campaign_fkey;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_squad_id_fkey FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES squad_members(id) ON DELETE CASCADE;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE role_assignments DROP COLUMN campaign_id;
ALTER TABLE squad_members DROP CONSTRAINT squad_members_id_squad_unique;
ALTER TABLE roles DROP CONSTRAINT roles_id_campaign_unique;
COMMIT;

