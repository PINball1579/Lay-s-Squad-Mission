package service

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

func newTestGame() *Game {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	sequence := 0
	return NewGame(Config{
		CampaignID: "demo",
		SquadSize:  4,
		InviteTTL:  time.Hour,
		Now:        func() time.Time { return now },
		NewID: func() string {
			sequence++
			return string(rune('a' + sequence))
		},
	})
}

func addFour(t *testing.T, game *Game) (domain.Squad, []domain.User, domain.Invitation) {
	t.Helper()
	users := []domain.User{{ID: "u1", DisplayName: "Mali"}, {ID: "u2", DisplayName: "Nok"}, {ID: "u3", DisplayName: "Beam"}, {ID: "u4", DisplayName: "Ploy"}}
	for _, user := range users {
		game.AddUser(user)
		if err := game.UpdateConsent(user.ID, true, true); err != nil {
			t.Fatal(err)
		}
	}
	squad, invite, err := game.CreateSquad(users[0].ID, "Crunch Crew")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range users[1:] {
		if _, err := game.JoinSquad(user.ID, invite.Token); err != nil {
			t.Fatal(err)
		}
	}
	return squad, users, invite
}

func TestCreateJoinAndFullSquad(t *testing.T) {
	game := newTestGame()
	_, _, invite := addFour(t, game)
	game.AddUser(domain.User{ID: "u5", DisplayName: "Fifth"})
	_ = game.UpdateConsent("u5", true, false)
	_, err := game.JoinSquad("u5", invite.Token)
	if !errors.Is(err, ErrSquadFull) {
		t.Fatalf("expected full squad, got %v", err)
	}
}

func TestExpiredInvitation(t *testing.T) {
	game := newTestGame()
	game.AddUser(domain.User{ID: "owner", DisplayName: "Owner"})
	game.AddUser(domain.User{ID: "joiner", DisplayName: "Joiner"})
	_ = game.UpdateConsent("owner", true, false)
	_ = game.UpdateConsent("joiner", true, false)
	_, invite, err := game.CreateSquad("owner", "Squad")
	if err != nil {
		t.Fatal(err)
	}
	game.now = func() time.Time { return invite.ExpiresAt.Add(time.Second) }
	_, err = game.JoinSquad("joiner", invite.Token)
	if !errors.Is(err, ErrInvitationExpired) {
		t.Fatalf("expected expired invitation, got %v", err)
	}
}

func TestConcurrentRoleClaimHasOneWinner(t *testing.T) {
	game := newTestGame()
	squad, users, _ := addFour(t, game)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, user := range users[:2] {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			_, err := game.ClaimRole(userID, squad.ID, domain.CrunchHunter)
			results <- err
		}(user.ID)
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, ErrRoleTaken) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("expected one winner, got %d", wins)
	}
}

func TestMissionCompletionIsIdempotentAndUnlocksOnce(t *testing.T) {
	game := newTestGame()
	squad, users, _ := addFour(t, game)
	for i, role := range domain.Roles {
		if _, err := game.ClaimRole(users[i].ID, squad.ID, role); err != nil {
			t.Fatal(err)
		}
		attempt, err := game.StartMission(users[i].ID, squad.ID, role)
		if err != nil {
			t.Fatal(err)
		}
		if role == domain.QRRunner {
			if _, err := game.VerifyQR(users[i].ID, "test-session", attempt.ID, domain.QRProof{LocationID: "demo-store", Nonce: "test-proof", ExpiresAt: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).Unix()}); err != nil {
				t.Fatal(err)
			}
		}
		if role == domain.FlavorReferee {
			attempt = finishMemoryFlavorCup(t, game, users[i].ID, squad.ID, attempt)
		}
		view, completion, _, err := game.CompleteMission(users[i].ID, squad.ID, role, attempt.ID, "key-"+string(role), validProperties(role, attempt.Challenge))
		if err != nil {
			t.Fatal(err)
		}
		if i < 3 && view.RewardUnlocked {
			t.Fatal("reward unlocked early")
		}
		if i == 0 {
			_, duplicate, created, err := game.CompleteMission(users[i].ID, squad.ID, role, attempt.ID, "key-"+string(role), validProperties(role, attempt.Challenge))
			if err != nil || created || duplicate.ID != completion.ID {
				t.Fatalf("completion was not idempotent: %v", err)
			}
		}
	}
	view, err := game.GetSquad(users[0].ID, squad.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !view.RewardUnlocked || view.RewardUnlockID == "" {
		t.Fatal("expected reward unlock")
	}
	metrics := game.Dashboard()
	if metrics.RewardsUnlocked != 1 {
		t.Fatalf("expected exactly one unlock, got %d", metrics.RewardsUnlocked)
	}
}

func TestMissionAttemptIsRequiredAndExpires(t *testing.T) {
	game := newTestGame()
	squad, users, _ := addFour(t, game)
	if _, err := game.ClaimRole(users[0].ID, squad.ID, domain.CrunchHunter); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := game.CompleteMission(users[0].ID, squad.ID, domain.CrunchHunter, "", "missing-attempt", validProperties(domain.CrunchHunter)); !errors.Is(err, ErrAttemptInvalid) {
		t.Fatalf("completion without an attempt was accepted: %v", err)
	}
	attempt, err := game.StartMission(users[0].ID, squad.ID, domain.CrunchHunter)
	if err != nil {
		t.Fatal(err)
	}
	game.now = func() time.Time { return attempt.ExpiresAt.Add(time.Second) }
	if _, _, _, err := game.CompleteMission(users[0].ID, squad.ID, domain.CrunchHunter, attempt.ID, "expired-attempt", validProperties(domain.CrunchHunter, attempt.Challenge)); !errors.Is(err, ErrAttemptInvalid) {
		t.Fatalf("expired attempt was accepted: %v", err)
	}
}

func TestFlavorCupPersistsAcrossStartAndPreventsDuplicateVotes(t *testing.T) {
	game := newTestGame()
	squad, users, _ := addFour(t, game)
	if _, err := game.ClaimRole(users[0].ID, squad.ID, domain.FlavorReferee); err != nil {
		t.Fatal(err)
	}
	attempt, err := game.StartMission(users[0].ID, squad.ID, domain.FlavorReferee)
	if err != nil {
		t.Fatal(err)
	}
	var tournament flavorCupTournament
	raw, _ := json.Marshal(attempt.Challenge["tournament"])
	_ = json.Unmarshal(raw, &tournament)
	current := tournament.Matches[0]
	if _, err = game.AdvanceFlavorCup(users[0].ID, squad.ID, attempt.ID, domain.FlavorCupVote{MatchID: current.ID, WinnerID: "not-exposed", DecisionMs: 1}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("invalid winner accepted: %v", err)
	}
	result, err := game.AdvanceFlavorCup(users[0].ID, squad.ID, attempt.ID, domain.FlavorCupVote{MatchID: current.ID, WinnerID: current.LeftID, DecisionMs: 25})
	if err != nil || !result.Created {
		t.Fatalf("vote was not stored: %v", err)
	}
	duplicate, err := game.AdvanceFlavorCup(users[0].ID, squad.ID, attempt.ID, domain.FlavorCupVote{MatchID: current.ID, WinnerID: current.LeftID, DecisionMs: 25})
	if err != nil || duplicate.Created {
		t.Fatalf("duplicate vote was not idempotent: %v", err)
	}
	resumed, err := game.StartMission(users[0].ID, squad.ID, domain.FlavorReferee)
	if err != nil || resumed.ID != attempt.ID {
		t.Fatalf("tournament did not resume: %v", err)
	}
	raw, _ = json.Marshal(resumed.Challenge["tournament"])
	_ = json.Unmarshal(raw, &tournament)
	if tournament.SelectionCount != 1 {
		t.Fatalf("expected one persisted selection, got %d", tournament.SelectionCount)
	}
}

func TestFlavorCupConfigurationSupportsSeededFourFlavorBracket(t *testing.T) {
	challenge := NewMissionChallengeWithConfig(domain.FlavorReferee, map[string]any{
		"bracketSize":   4,
		"seedOrder":     []string{"classic", "bbq", "nori", "sour-cream"},
		"placementMode": "alternate",
	})
	var tournament flavorCupTournament
	raw, _ := json.Marshal(challenge["tournament"])
	if err := json.Unmarshal(raw, &tournament); err != nil {
		t.Fatal(err)
	}
	if tournament.BracketSize != 4 || len(tournament.Matches) != 3 {
		t.Fatalf("unexpected bracket: size=%d matches=%d", tournament.BracketSize, len(tournament.Matches))
	}
	if tournament.Matches[0].LeftID != "classic" || tournament.Matches[0].RightID != "bbq" || tournament.Matches[1].LeftID != "sour-cream" || tournament.Matches[1].RightID != "nori" {
		t.Fatalf("seed order and alternating placement were not applied: %+v", tournament.Matches[:2])
	}
}

func validProperties(role domain.Role, challenges ...map[string]any) map[string]any {
	challenge := map[string]any{}
	if len(challenges) != 0 {
		challenge = challenges[0]
	}
	switch role {
	case domain.CrunchHunter:
		return map[string]any{"foundDifferenceIds": crunchHuntIDs(challenge), "completionMs": 1000.0, "score": 500.0}
	case domain.FlavorReferee:
		var tournament flavorCupTournament
		raw, _ := json.Marshal(challenge["tournament"])
		_ = json.Unmarshal(raw, &tournament)
		return map[string]any{"championId": tournament.ChampionID, "matchCount": float64(len(tournament.Matches)), "completionMs": 1000.0}
	case domain.SnackDetective:
		if challenge["variant"] == "location" {
			return map[string]any{"answers": map[string]any{"q1": "QR Runner", "q2": "Mock Crunch Badge"}, "confidence": "sure"}
		}
		return map[string]any{"answers": map[string]any{"q1": "Four", "q2": "All four missions"}, "confidence": "sure"}
	case domain.QRRunner:
		return map[string]any{"qrVerified": true, "locationId": "demo-store"}
	default:
		return nil
	}
}

func finishMemoryFlavorCup(t *testing.T, game *Game, userID, squadID string, attempt domain.MissionAttempt) domain.MissionAttempt {
	t.Helper()
	for {
		var tournament flavorCupTournament
		raw, _ := json.Marshal(attempt.Challenge["tournament"])
		if json.Unmarshal(raw, &tournament) != nil {
			t.Fatal("invalid tournament")
		}
		if tournament.Completed {
			return attempt
		}
		var current flavorCupMatch
		for _, match := range tournament.Matches {
			if match.ID == tournament.CurrentMatchID {
				current = match
				break
			}
		}
		result, err := game.AdvanceFlavorCup(userID, squadID, attempt.ID, domain.FlavorCupVote{MatchID: current.ID, WinnerID: current.LeftID, DecisionMs: 10})
		if err != nil {
			t.Fatal(err)
		}
		attempt = result.Attempt
	}
}

func crunchHuntIDs(challenge map[string]any) []any {
	raw, _ := json.Marshal(challenge["differences"])
	var differences []map[string]any
	_ = json.Unmarshal(raw, &differences)
	ids := make([]any, 0, len(differences))
	for _, difference := range differences {
		ids = append(ids, difference["id"])
	}
	return ids
}

func TestAnalyticsConsentDoesNotBlockPlay(t *testing.T) {
	game := newTestGame()
	game.AddUser(domain.User{ID: "u", DisplayName: "No Analytics"})
	if err := game.UpdateConsent("u", true, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := game.CreateSquad("u", "Private Squad"); err != nil {
		t.Fatal(err)
	}
	if stored := game.RecordEvent("u", domain.AnalyticsEvent{Name: "role_viewed"}); stored {
		t.Fatal("optional event should be discarded")
	}
	if stored := game.RecordEvent("u", domain.AnalyticsEvent{Name: "authentication_completed", UserID: "spoofed", SessionID: "secret-session", SquadID: "squad", Role: domain.QRRunner}); !stored {
		t.Fatal("required operational event should be retained")
	}
	events := game.Events()
	if events[0].UserID != "" || events[0].SessionID != "" || events[0].SquadID != "" || events[0].Role != "" {
		t.Fatalf("opted-out event retained identifying context: %+v", events[0])
	}
}

func TestMissionSuccessCriteriaAndConcurrentRewardRedemption(t *testing.T) {
	game := newTestGame()
	squad, users, _ := addFour(t, game)
	for i, role := range domain.Roles {
		if _, err := game.ClaimRole(users[i].ID, squad.ID, role); err != nil {
			t.Fatal(err)
		}
		attempt, err := game.StartMission(users[i].ID, squad.ID, role)
		if err != nil {
			t.Fatal(err)
		}
		if role == domain.QRRunner {
			if _, err := game.VerifyQR(users[i].ID, "test-session", attempt.ID, domain.QRProof{LocationID: "demo-store", Nonce: "test-proof", ExpiresAt: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).Unix()}); err != nil {
				t.Fatal(err)
			}
		}
		if i == 0 {
			if _, _, _, err := game.CompleteMission(users[i].ID, squad.ID, role, attempt.ID, "bad", map[string]any{"accuracy": 1}); !errors.Is(err, ErrMissionFailed) {
				t.Fatalf("invalid mission accepted: %v", err)
			}
		}
		if role == domain.FlavorReferee {
			attempt = finishMemoryFlavorCup(t, game, users[i].ID, squad.ID, attempt)
		}
		if _, _, _, err := game.CompleteMission(users[i].ID, squad.ID, role, attempt.ID, "complete-"+string(role), validProperties(role, attempt.Challenge)); err != nil {
			t.Fatal(err)
		}
	}
	results := make(chan bool, 2)
	if _, err := game.RewardCoupon(users[0].ID, squad.ID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("coupon disclosed before claim: %v", err)
	}
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, created, _ := game.RedeemReward(users[0].ID, squad.ID, "same-redemption")
			results <- created
		}()
	}
	wg.Wait()
	close(results)
	created := 0
	for result := range results {
		if result {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("expected one redemption transition, got %d", created)
	}
	coupon, err := game.RewardCoupon(users[0].ID, squad.ID)
	if err != nil || coupon.Code == "" || !coupon.TestOnly {
		t.Fatalf("missing claimed test coupon: %v", err)
	}
	same, err := game.RewardCoupon(users[1].ID, squad.ID)
	if err != nil || same.Code != coupon.Code {
		t.Fatalf("squad members did not receive the same coupon: %v", err)
	}
	if _, err := game.RewardCoupon("outsider", squad.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider read coupon: %v", err)
	}
}
