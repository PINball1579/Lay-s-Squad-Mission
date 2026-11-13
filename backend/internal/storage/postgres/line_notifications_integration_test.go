package postgres

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

func TestCompletionNotificationAcceptanceSurvivesRestart(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	user := domain.User{ID: fmt.Sprintf("integration:notification:%d", time.Now().UnixNano()), DisplayName: "Notification Test"}
	store.AddUser(user)
	t.Cleanup(func() {
		cleanup, e := Open(databaseURL, "demo-campaign", 4, time.Hour)
		if e == nil {
			defer cleanup.Close()
			_, _ = cleanup.db.Exec(`DELETE FROM users WHERE pseudonymous_id=$1`, user.ID)
		}
	})
	if err = store.UpdateConsent(user.ID, true, false); err != nil {
		t.Fatal(err)
	}
	squad, _, err := store.CreateSquad(user.ID, "ทีมแจ้งผล")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, e := Open(databaseURL, "demo-campaign", 4, time.Hour)
		if e == nil {
			defer cleanup.Close()
			_, _ = cleanup.db.Exec(`DELETE FROM squads WHERE id=$1`, squad.ID)
		}
	})
	if _, err = store.ClaimRole(user.ID, squad.ID, domain.SnackDetective); err != nil {
		t.Fatal(err)
	}
	attempt, err := store.StartMission(user.ID, squad.ID, domain.SnackDetective)
	if err != nil {
		t.Fatal(err)
	}
	answers := map[string]any{"q1": "Four", "q2": "All four missions"}
	if attempt.Challenge["variant"] == "location" {
		answers = map[string]any{"q1": "QR Runner", "q2": "Mock Crunch Badge"}
	}
	completedSquad, completion, _, err := store.CompleteMission(user.ID, squad.ID, domain.SnackDetective, attempt.ID, "notification-persistence", map[string]any{"answers": answers, "confidence": "sure"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, accepted, err := store.PrepareCompletionNotification(context.Background(), completion.ID, completedSquad)
	if err != nil || accepted {
		t.Fatal("new completion already marked accepted")
	}
	changedSquad := domain.Squad{Name: "changed later", RewardUnlocked: true, Members: []domain.Member{{Completed: true}, {Completed: true}, {Completed: true}, {Completed: true}}}
	frozen, _, err := store.PrepareCompletionNotification(context.Background(), completion.ID, changedSquad)
	if err != nil || frozen.Name != snapshot.Name || frozen.RewardUnlocked || len(frozen.Members) != 1 {
		t.Fatal("notification retry changed the original card details")
	}
	for range 2 {
		if err = store.RecordCompletionNotification(context.Background(), completion.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	frozen, accepted, err = reopened.PrepareCompletionNotification(context.Background(), completion.ID, changedSquad)
	if err != nil || !accepted {
		t.Fatal("accepted delivery was lost after restart")
	}
	if frozen.Name != snapshot.Name || frozen.RewardUnlocked || len(frozen.Members) != 1 {
		t.Fatal("original card details lost after restart")
	}
}
