package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
)

func TestDurableSessionLifecycle(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	user := domain.User{ID: fmt.Sprintf("integration:session:%d", time.Now().UnixNano()), DisplayName: "Session Test"}
	otherUser := domain.User{ID: user.ID + ":other", DisplayName: "Session Switch Test"}
	store.AddUser(user)
	store.AddUser(otherUser)
	t.Cleanup(func() {
		cleanup, openErr := Open(databaseURL, "demo-campaign", 4, time.Hour)
		if openErr != nil {
			return
		}
		defer cleanup.Close()
		_, _ = cleanup.db.Exec(`DELETE FROM users WHERE pseudonymous_id IN ($1,$2)`, user.ID, otherUser.ID)
	})
	tokenHash := sha256.Sum256([]byte(user.ID + ":opaque-session-token"))
	csrfHash := sha256.Sum256([]byte(user.ID + ":csrf-token"))
	created, err := store.CreateSession(context.Background(), user.ID, tokenHash[:], csrfHash[:], nil, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	persisted, err := store.Session(context.Background(), tokenHash[:])
	if err != nil {
		t.Fatal(err)
	}
	if persisted.ID != created.ID || persisted.UserID != user.ID || !bytes.Equal(persisted.CSRFHash, csrfHash[:]) {
		t.Fatalf("persisted session mismatch: %+v", persisted)
	}
	replacementHash := sha256.Sum256([]byte(user.ID + ":replacement-session-token"))
	if _, err := store.CreateSession(context.Background(), user.ID, replacementHash[:], csrfHash[:], nil, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Session(context.Background(), tokenHash[:]); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("expected rotated session to be unavailable, got %v", err)
	}
	if err := store.RevokeSession(context.Background(), replacementHash[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Session(context.Background(), replacementHash[:]); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("expected revoked session to be unavailable, got %v", err)
	}
	switchFrom := sha256.Sum256([]byte(user.ID + ":switch-from"))
	switchTo := sha256.Sum256([]byte(otherUser.ID + ":switch-to"))
	if _, err := store.CreateSession(context.Background(), user.ID, switchFrom[:], csrfHash[:], nil, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(context.Background(), otherUser.ID, switchTo[:], csrfHash[:], switchFrom[:], time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Session(context.Background(), switchFrom[:]); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("expected previous account session to be revoked on switch, got %v", err)
	}
	expiredHash := sha256.Sum256([]byte(otherUser.ID + ":expired"))
	if _, err := store.CreateSession(context.Background(), otherUser.ID, expiredHash[:], csrfHash[:], nil, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	cleanupTrigger := sha256.Sum256([]byte(otherUser.ID + ":cleanup-trigger"))
	if _, err := store.CreateSession(context.Background(), otherUser.ID, cleanupTrigger[:], csrfHash[:], nil, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var expiredRows, revokedRows int
	if err := store.db.QueryRow(`SELECT count(*),count(*) FILTER (WHERE revoked_at IS NOT NULL) FROM sessions WHERE token_hash=$1`, expiredHash[:]).Scan(&expiredRows, &revokedRows); err != nil {
		t.Fatal(err)
	}
	if expiredRows != 1 || revokedRows != 1 {
		t.Fatalf("expected expired session retention with revocation, rows=%d revoked=%d", expiredRows, revokedRows)
	}
	if _, err := store.db.Exec(`UPDATE sessions SET expires_at=now()-interval '31 days',revoked_at=now()-interval '31 days' WHERE token_hash=$1`, expiredHash[:]); err != nil {
		t.Fatal(err)
	}
	finalTrigger := sha256.Sum256([]byte(otherUser.ID + ":final-cleanup-trigger"))
	if _, err := store.CreateSession(context.Background(), otherUser.ID, finalTrigger[:], csrfHash[:], nil, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM sessions WHERE token_hash=$1`, expiredHash[:]).Scan(&expiredRows); err != nil {
		t.Fatal(err)
	}
	if expiredRows != 0 {
		t.Fatalf("expected session beyond retention to be deleted, found %d rows", expiredRows)
	}
}

func TestConcurrentSessionRotationLeavesOneActive(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	user := domain.User{ID: fmt.Sprintf("integration:session-race:%d", time.Now().UnixNano()), DisplayName: "Session Race"}
	store.AddUser(user)
	t.Cleanup(func() {
		_, _ = store.db.Exec(`DELETE FROM users WHERE pseudonymous_id=$1`, user.ID)
	})

	start := make(chan struct{})
	results := make(chan error, 2)
	for index := range 2 {
		go func() {
			token := sha256.Sum256([]byte(fmt.Sprintf("%s:concurrent-session-%d", user.ID, index)))
			csrf := sha256.Sum256([]byte(fmt.Sprintf("%s:concurrent-csrf-%d", user.ID, index)))
			<-start
			_, createErr := store.CreateSession(context.Background(), user.ID, token[:], csrf[:], nil, time.Now().Add(time.Hour))
			results <- createErr
		}()
	}
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var active int
	if err := store.db.QueryRow(`SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.pseudonymous_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, user.ID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 1 {
		t.Fatalf("expected exactly one active session after concurrent rotation, got %d", active)
	}
}

func TestPersistenceAndConcurrentRoleClaim(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().UnixNano()
	userA := domain.User{ID: fmt.Sprintf("integration:a:%d", stamp), DisplayName: "Integration A"}
	userB := domain.User{ID: fmt.Sprintf("integration:b:%d", stamp), DisplayName: "Integration B"}
	for _, user := range []domain.User{userA, userB} {
		store.AddUser(user)
		if err := store.UpdateConsent(user.ID, true, false); err != nil {
			t.Fatal(err)
		}
	}

	squad, invitation, err := store.CreateSquad(userA.ID, "Persistent Test Squad")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, openErr := Open(databaseURL, "demo-campaign", 4, time.Hour)
		if openErr != nil {
			return
		}
		defer cleanup.Close()
		_, _ = cleanup.db.Exec(`DELETE FROM squads WHERE id=$1`, squad.ID)
		_, _ = cleanup.db.Exec(`DELETE FROM users WHERE pseudonymous_id IN ($1,$2)`, userA.ID, userB.ID)
	})
	if _, err = store.JoinSquad(userB.ID, invitation.Token); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}

	// A new store instance represents a fresh API process and must reconstruct
	// the active squad from PostgreSQL rather than process memory.
	store, err = Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	persisted, ok := store.CurrentSquad(userA.ID)
	if !ok || persisted.ID != squad.ID || len(persisted.Members) != 2 {
		t.Fatalf("persisted squad mismatch: ok=%v squad=%+v", ok, persisted)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, userID := range []string{userA.ID, userB.ID} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, claimErr := store.ClaimRole(userID, squad.ID, domain.CrunchHunter)
			results <- claimErr
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	winners, conflicts := 0, 0
	for claimErr := range results {
		switch {
		case claimErr == nil:
			winners++
		case errors.Is(claimErr, service.ErrRoleTaken):
			conflicts++
		default:
			t.Fatalf("unexpected claim result: %v", claimErr)
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatalf("expected one winner and one conflict, got winners=%d conflicts=%d", winners, conflicts)
	}
}

func TestConcurrentFinalCompletionsUnlockExactlyOnce(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	stamp := time.Now().UnixNano()
	users := make([]domain.User, 4)
	sessionIDs := make([]string, 4)
	for index := range users {
		users[index] = domain.User{ID: fmt.Sprintf("integration:final:%d:%d", stamp, index), DisplayName: fmt.Sprintf("Final %d", index)}
		store.AddUser(users[index])
		if err := store.UpdateConsent(users[index].ID, true, false); err != nil {
			t.Fatal(err)
		}
		token := sha256.Sum256([]byte(fmt.Sprintf("%s:mission-session", users[index].ID)))
		csrf := sha256.Sum256([]byte(fmt.Sprintf("%s:mission-csrf", users[index].ID)))
		session, err := store.CreateSession(context.Background(), users[index].ID, token[:], csrf[:], nil, time.Now().Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		sessionIDs[index] = session.ID
	}
	squad, invitation, err := store.CreateSquad(users[0].ID, "Concurrent Final Squad")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var inventoryID string
		_ = store.db.QueryRow(`SELECT COALESCE(inventory_id::text,'') FROM reward_unlocks WHERE squad_id=$1`, squad.ID).Scan(&inventoryID)
		_, _ = store.db.Exec(`DELETE FROM squads WHERE id=$1`, squad.ID)
		if inventoryID != "" {
			_, _ = store.db.Exec(`UPDATE reward_inventory SET state='available',reserved_at=NULL,redeemed_at=NULL WHERE id=$1`, inventoryID)
		}
		for _, user := range users {
			_, _ = store.db.Exec(`DELETE FROM users WHERE pseudonymous_id=$1`, user.ID)
		}
	})
	for index := 1; index < len(users); index++ {
		if _, err := store.JoinSquad(users[index].ID, invitation.Token); err != nil {
			t.Fatal(err)
		}
	}
	for index, role := range domain.Roles {
		if _, err := store.ClaimRole(users[index].ID, squad.ID, role); err != nil {
			t.Fatal(err)
		}
	}

	for index, role := range domain.Roles[:2] {
		attempt, err := store.StartMission(users[index].ID, squad.ID, role)
		if err != nil {
			t.Fatal(err)
		}
		if role == domain.FlavorReferee {
			attempt = finishPostgresFlavorCup(t, store, users[index].ID, squad.ID, attempt)
		}
		if _, _, _, err := store.CompleteMission(users[index].ID, squad.ID, role, attempt.ID, fmt.Sprintf("first-%d", index), attemptProperties(role, attempt.Challenge)); err != nil {
			t.Fatal(err)
		}
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	for index, role := range domain.Roles[2:] {
		go func(user domain.User, assignedRole domain.Role, sessionID string) {
			attempt, attemptErr := store.StartMission(user.ID, squad.ID, assignedRole)
			if attemptErr != nil {
				results <- attemptErr
				return
			}
			if assignedRole == domain.QRRunner {
				_, attemptErr = store.VerifyQR(user.ID, sessionID, attempt.ID, domain.QRProof{LocationID: "demo-store", Nonce: "integration-proof", ExpiresAt: time.Now().Add(time.Hour).Unix()})
				if attemptErr != nil {
					results <- attemptErr
					return
				}
			}
			<-start
			_, _, _, completeErr := store.CompleteMission(user.ID, squad.ID, assignedRole, attempt.ID, "final-"+string(assignedRole), attemptProperties(assignedRole, attempt.Challenge))
			results <- completeErr
		}(users[index+2], role, sessionIDs[index+2])
	}
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}

	completed, err := store.GetSquad(users[0].ID, squad.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !completed.RewardUnlocked {
		t.Fatal("reward was not unlocked after concurrent final completions")
	}
	var unlocks int
	if err := store.db.QueryRow(`SELECT count(*) FROM reward_unlocks WHERE squad_id=$1`, squad.ID).Scan(&unlocks); err != nil {
		t.Fatal(err)
	}
	if unlocks != 1 {
		t.Fatalf("expected exactly one reward unlock, got %d", unlocks)
	}
	if _, err := store.db.Exec(`DELETE FROM sessions WHERE id=$1`, sessionIDs[3]); err != nil {
		t.Fatalf("completed QR session cleanup must preserve its attempt and completion: %v", err)
	}
	var qrCompletions int
	if err := store.db.QueryRow(`SELECT count(*) FROM mission_completions mc JOIN role_assignments ra ON ra.id=mc.assignment_id JOIN roles r ON r.id=ra.role_id WHERE ra.squad_id=$1 AND r.code='qr_runner'`, squad.ID).Scan(&qrCompletions); err != nil {
		t.Fatal(err)
	}
	if qrCompletions != 1 {
		t.Fatalf("expected completed QR audit record after session cleanup, got %d", qrCompletions)
	}
}

func TestMissionAttemptValidationAndReplay(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	stamp := time.Now().UnixNano()
	owner := domain.User{ID: fmt.Sprintf("integration:attempt-owner:%d", stamp), DisplayName: "Attempt Owner"}
	member := domain.User{ID: fmt.Sprintf("integration:attempt-member:%d", stamp), DisplayName: "Attempt Member"}
	for _, user := range []domain.User{owner, member} {
		store.AddUser(user)
		if err := store.UpdateConsent(user.ID, true, false); err != nil {
			t.Fatal(err)
		}
	}
	squad, invitation, err := store.CreateSquad(owner.ID, "Attempt Security Squad")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.db.Exec(`DELETE FROM squads WHERE id=$1`, squad.ID)
		_, _ = store.db.Exec(`DELETE FROM users WHERE pseudonymous_id IN ($1,$2)`, owner.ID, member.ID)
	})
	if _, err = store.JoinSquad(member.ID, invitation.Token); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ClaimRole(owner.ID, squad.ID, domain.CrunchHunter); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ClaimRole(member.ID, squad.ID, domain.FlavorReferee); err != nil {
		t.Fatal(err)
	}

	first, err := store.StartMission(owner.ID, squad.ID, domain.CrunchHunter)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.StartMission(owner.ID, squad.ID, domain.CrunchHunter)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, first.ID, "superseded", attemptProperties(domain.CrunchHunter, first.Challenge)); !errors.Is(err, service.ErrAttemptInvalid) {
		t.Fatalf("expected superseded attempt rejection, got %v", err)
	}
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, "not-a-uuid", "malformed", attemptProperties(domain.CrunchHunter, second.Challenge)); !errors.Is(err, service.ErrAttemptInvalid) {
		t.Fatalf("expected malformed attempt rejection, got %v", err)
	}

	memberAttempt, err := store.StartMission(member.ID, squad.ID, domain.FlavorReferee)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = store.CompleteMission(member.ID, squad.ID, domain.FlavorReferee, second.ID, "cross-assignment", attemptProperties(domain.FlavorReferee, memberAttempt.Challenge)); !errors.Is(err, service.ErrAttemptInvalid) {
		t.Fatalf("expected cross-assignment attempt rejection, got %v", err)
	}

	if _, err = store.db.Exec(`UPDATE mission_attempts SET expires_at=now()-interval '1 second' WHERE id=$1`, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, second.ID, "expired", attemptProperties(domain.CrunchHunter, second.Challenge)); !errors.Is(err, service.ErrAttemptInvalid) {
		t.Fatalf("expected expired attempt rejection, got %v", err)
	}

	active, err := store.StartMission(owner.ID, squad.ID, domain.CrunchHunter)
	if err != nil {
		t.Fatal(err)
	}
	valid := attemptProperties(domain.CrunchHunter, active.Challenge)
	invalid := attemptProperties(domain.CrunchHunter, active.Challenge)
	invalid["foundDifferenceIds"] = []any{"not-a-real-hotspot"}
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, active.ID, "invalid-result", invalid); !errors.Is(err, service.ErrMissionFailed) {
		t.Fatalf("expected challenge result rejection, got %v", err)
	}
	if _, _, created, err := store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, active.ID, "exact-replay", valid); err != nil || !created {
		t.Fatalf("expected initial completion, created=%v err=%v", created, err)
	}
	if _, _, created, err := store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, active.ID, "exact-replay", valid); err != nil || created {
		t.Fatalf("expected exact idempotent replay, created=%v err=%v", created, err)
	}
	mutated := attemptProperties(domain.CrunchHunter, active.Challenge)
	mutated["completionMs"] = 999.0
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, active.ID, "exact-replay", mutated); !errors.Is(err, service.ErrConflict) {
		t.Fatalf("expected mutated replay conflict, got %v", err)
	}
	if _, _, _, err = store.CompleteMission(owner.ID, squad.ID, domain.CrunchHunter, active.ID, "different-key", valid); !errors.Is(err, service.ErrConflict) {
		t.Fatalf("expected different-key replay conflict, got %v", err)
	}
	if _, err = store.StartMission(owner.ID, squad.ID, domain.CrunchHunter); !errors.Is(err, service.ErrInvalidState) {
		t.Fatalf("expected completed assignment start conflict, got %v", err)
	}
}

func attemptProperties(role domain.Role, challenge map[string]any) map[string]any {
	switch role {
	case domain.CrunchHunter:
		return map[string]any{"foundDifferenceIds": postgresHuntIDs(challenge), "completionMs": 10.0, "score": 500.0}
	case domain.FlavorReferee:
		var tournament struct {
			ChampionID string `json:"championId"`
			Matches    []any  `json:"matches"`
		}
		raw, _ := json.Marshal(challenge["tournament"])
		_ = json.Unmarshal(raw, &tournament)
		return map[string]any{"championId": tournament.ChampionID, "matchCount": float64(len(tournament.Matches)), "completionMs": 10.0}
	case domain.SnackDetective:
		if challenge["variant"] == "location" {
			return map[string]any{"answers": map[string]any{"q1": "QR Runner", "q2": "Mock Crunch Badge"}}
		}
		return map[string]any{"answers": map[string]any{"q1": "Four", "q2": "All four missions"}}
	case domain.QRRunner:
		return map[string]any{"qrVerified": true, "locationId": "demo-store"}
	default:
		return nil
	}
}

func finishPostgresFlavorCup(t *testing.T, store *Game, userID, squadID string, attempt domain.MissionAttempt) domain.MissionAttempt {
	t.Helper()
	selections := 0
	for {
		var tournament struct {
			Completed      bool                          `json:"completed"`
			CurrentMatchID string                        `json:"currentMatchId"`
			Matches        []struct{ ID, LeftID string } `json:"matches"`
		}
		raw, _ := json.Marshal(attempt.Challenge["tournament"])
		if json.Unmarshal(raw, &tournament) != nil {
			t.Fatal("invalid tournament")
		}
		if tournament.Completed {
			return attempt
		}
		var winner string
		for _, match := range tournament.Matches {
			if match.ID == tournament.CurrentMatchID {
				winner = match.LeftID
				break
			}
		}
		result, err := store.AdvanceFlavorCup(userID, squadID, attempt.ID, domain.FlavorCupVote{MatchID: tournament.CurrentMatchID, WinnerID: winner, DecisionMs: 10})
		if err != nil {
			t.Fatal(err)
		}
		attempt = result.Attempt
		selections++
		if selections == 1 {
			resumed, resumeErr := store.StartMission(userID, squadID, domain.FlavorReferee)
			if resumeErr != nil || resumed.ID != attempt.ID {
				t.Fatalf("persisted tournament did not resume: %v", resumeErr)
			}
			attempt = resumed
		}
	}
}

func postgresHuntIDs(challenge map[string]any) []any {
	raw, _ := json.Marshal(challenge["differences"])
	var differences []map[string]any
	_ = json.Unmarshal(raw, &differences)
	ids := make([]any, 0, len(differences))
	for _, difference := range differences {
		ids = append(ids, difference["id"])
	}
	return ids
}
