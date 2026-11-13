package service

import "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"

const ReceiptProofSource = "receipt-lays"

// Preflight prevents an unauthorized caller from consuming paid OCR credits.
func (g *Game) CheckReceiptAttempt(userID, attemptID string) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	a, ok := g.attempts[attemptID]
	if !ok || a.UserID != userID || a.Role != domain.QRRunner || a.Status != "started" || !a.ExpiresAt.After(g.now()) || a.Challenge["kind"] != "receipt_ocr" || !g.isActiveMemberLocked(userID, a.SquadID) {
		return ErrAttemptInvalid
	}
	return g.canPlayLocked(userID)
}
