package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	lineadapter "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/line"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
)

type notificationVerifier struct{}

func (notificationVerifier) Verify(_ context.Context, token string) (lineadapter.Identity, error) {
	if token == "expired-token" {
		return lineadapter.Identity{}, errors.New("expired")
	}
	if token == "other-token" {
		return lineadapter.Identity{Subject: "other-player", DisplayName: "Other"}, nil
	}
	return lineadapter.Identity{Subject: "verified-player", DisplayName: "Player"}, nil
}

type notificationMessenger struct {
	calls       atomic.Int32
	unavailable atomic.Bool
}

func (m *notificationMessenger) SendCompletion(_ context.Context, recipient string, squad domain.Squad, completion domain.Completion) error {
	m.calls.Add(1)
	if recipient != "verified-player" {
		return errors.New("wrong recipient")
	}
	if m.unavailable.Load() {
		return errors.New("provider unavailable")
	}
	return nil
}

func TestCompletionNotificationsPreserveMissionAndBindRecipient(t *testing.T) {
	for _, tc := range []struct {
		name, token, status string
		fail                bool
		invalidMission      bool
		wantCalls           int32
	}{
		{"success", "player-token", "accepted", false, false, 1},
		{"provider failure", "player-token", "unavailable", true, false, 1},
		{"another identity", "other-token", "identity_required", false, false, 0},
		{"expired identity", "expired-token", "identity_required", false, false, 0},
		{"missing identity", "", "identity_required", false, false, 0},
		{"incomplete mission", "player-token", "", false, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			game := service.NewGame(service.Config{})
			messenger := &notificationMessenger{}
			messenger.unavailable.Store(tc.fail)
			api := New(ServerConfig{Game: game, LineVerifier: notificationVerifier{}, CompletionMessenger: messenger})
			host := httptest.NewServer(api.Handler())
			defer host.Close()
			jar, _ := cookiejar.New(nil)
			client := &http.Client{Jar: jar}
			var auth struct {
				User domain.User `json:"user"`
				CSRF string      `json:"csrfToken"`
			}
			decodeJSON(t, postJSON(t, client, host.URL+"/api/v1/auth/line", "", map[string]any{"idToken": "player-token"}), &auth)
			consent := postJSON(t, client, host.URL+"/api/v1/consent", auth.CSRF, map[string]any{"requiredAccepted": true})
			consent.Body.Close()
			var created struct {
				Squad domain.Squad `json:"squad"`
			}
			decodeJSON(t, postJSON(t, client, host.URL+"/api/v1/squads", auth.CSRF, map[string]any{"name": "ทีมทดสอบ"}), &created)
			roleURL := host.URL + "/api/v1/squads/" + created.Squad.ID
			claim := postJSON(t, client, roleURL+"/roles/snack_detective", auth.CSRF, map[string]any{})
			claim.Body.Close()
			var attempt domain.MissionAttempt
			decodeJSON(t, postJSON(t, client, roleURL+"/missions/snack_detective/start", auth.CSRF, map[string]any{}), &attempt)
			answers := map[string]any{"q1": "Four", "q2": "All four missions"}
			if attempt.Challenge["variant"] == "location" {
				answers = map[string]any{"q1": "QR Runner", "q2": "Mock Crunch Badge"}
			}
			properties := map[string]any{"answers": answers, "confidence": "sure"}
			if tc.invalidMission {
				properties = map[string]any{}
			}
			body := map[string]any{"attemptId": attempt.ID, "properties": properties, "idToken": tc.token}
			complete := func() *http.Response {
				return postJSONHeaders(t, client, roleURL+"/missions/snack_detective/complete", auth.CSRF, body, map[string]string{"Idempotency-Key": "notification-test"})
			}
			response := complete()
			if tc.invalidMission {
				defer response.Body.Close()
				if response.StatusCode != 422 || messenger.calls.Load() != 0 {
					t.Fatal("failed mission sent notification")
				}
				return
			}
			if response.StatusCode != 200 {
				t.Fatalf("mission failed: %d", response.StatusCode)
			}
			var result struct {
				Squad        domain.Squad `json:"squad"`
				Notification string       `json:"notification"`
			}
			decodeJSON(t, response, &result)
			if result.Notification != tc.status || !result.Squad.Members[0].Completed || messenger.calls.Load() != tc.wantCalls {
				t.Fatalf("unexpected completion/notification: %+v, calls %d", result, messenger.calls.Load())
			}
			// Recover a failed/missing delivery by replaying the same saved mission.
			messenger.unavailable.Store(false)
			body["idToken"] = "player-token"
			decodeJSON(t, complete(), &result)
			if result.Notification != "accepted" {
				t.Fatalf("delivery retry failed: %s", result.Notification)
			}
			calls := messenger.calls.Load()
			decodeJSON(t, complete(), &result)
			if messenger.calls.Load() != calls {
				t.Fatal("accepted completion sent twice")
			}
			for _, event := range game.Events() {
				for key := range event.Properties {
					if strings.Contains(strings.ToLower(key), "token") {
						t.Fatal("token reached analytics")
					}
				}
			}
		})
	}
}
