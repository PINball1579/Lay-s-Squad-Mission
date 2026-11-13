package postgres

import (
	"context"
	"database/sql"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

// Freeze the card's team details before the first request so retries retain the
// original content even if teammates finish while LINE is unavailable.
func (g *Game) PrepareCompletionNotification(ctx context.Context, completionID string, squad domain.Squad) (domain.Squad, bool, error) {
	completed := 0
	for _, member := range squad.Members {
		if member.Completed {
			completed++
		}
	}
	_, err := g.db.ExecContext(ctx, `INSERT INTO line_completion_notifications(completion_id,squad_name,completed_count,reward_unlocked) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, completionID, squad.Name, completed, squad.RewardUnlocked)
	if err != nil {
		return domain.Squad{}, false, err
	}
	var accepted bool
	var snapshot domain.Squad
	err = g.db.QueryRowContext(ctx, `SELECT squad_name,completed_count,reward_unlocked,accepted_at IS NOT NULL FROM line_completion_notifications WHERE completion_id=$1`, completionID).Scan(&snapshot.Name, &completed, &snapshot.RewardUnlocked, &accepted)
	if err != nil {
		return domain.Squad{}, false, err
	}
	snapshot.Members = make([]domain.Member, completed)
	for i := range snapshot.Members {
		snapshot.Members[i].Completed = true
	}
	return snapshot, accepted, nil
}

func (g *Game) RecordCompletionNotification(ctx context.Context, completionID string) error {
	result, err := g.db.ExecContext(ctx, `UPDATE line_completion_notifications SET accepted_at=COALESCE(accepted_at,now()) WHERE completion_id=$1`, completionID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err == nil && rows == 0 {
		return sql.ErrNoRows
	}
	return err
}
