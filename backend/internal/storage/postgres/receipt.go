package postgres

import "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"

func (g *Game) CheckReceiptAttempt(userID, attemptID string) error {
	if !validUUID(attemptID) {
		return service.ErrAttemptInvalid
	}
	ctx, cancel := g.context()
	defer cancel()
	var valid bool
	err := g.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM mission_attempts ma JOIN role_assignments ra ON ra.id=ma.assignment_id JOIN roles r ON r.id=ra.role_id JOIN campaigns campaign ON campaign.id=ra.campaign_id AND campaign.status='active' AND now() BETWEEN campaign.starts_at AND campaign.ends_at JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id WHERE ma.id=$1 AND u.pseudonymous_id=$2 AND ra.campaign_id=$3 AND r.code='qr_runner' AND sm.state='active' AND ma.status='started' AND ma.expires_at>now() AND ma.properties->'challenge'->>'kind'='receipt_ocr' AND EXISTS(SELECT 1 FROM consent_records c WHERE c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$3 ORDER BY recorded_at DESC LIMIT 1) AND c.required_accepted))`, attemptID, userID, g.campaignID).Scan(&valid)
	if err != nil {
		return err
	}
	if !valid {
		return service.ErrAttemptInvalid
	}
	return nil
}
