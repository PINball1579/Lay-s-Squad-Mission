package line

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

func TestCompletionPushUsesFlexAndStableRetryKey(t *testing.T) {
	completion := domain.Completion{ID: "completion-a", Role: domain.SnackDetective}
	squad := domain.Squad{Name: "ทีมกรุบกรอบ", Members: []domain.Member{{Completed: true}, {Completed: false}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer server-token" {
			t.Error("missing authenticated POST")
		}
		key := r.Header.Get("X-Line-Retry-Key")
		if !regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).MatchString(key) || key != completionRetryKey(completion.ID) {
			t.Error("invalid retry UUID")
		}
		var body struct {
			To       string           `json:"to"`
			Messages []map[string]any `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.To != "verified-player" || len(body.Messages) != 1 || body.Messages[0]["type"] != "flex" {
			t.Error("invalid push recipient/card")
		}
		raw, _ := json.Marshal(body.Messages)
		for _, text := range []string{"ภารกิจสำเร็จ", "ทีมกรุบกรอบ", "1 / 4", "เพื่อนในทีม", "https://liff.line.me/test-app"} {
			if !strings.Contains(string(raw), text) {
				t.Errorf("card missing %q", text)
			}
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	m := Messenger{AccessToken: "server-token", LIFFID: "test-app", Endpoint: server.URL}
	if err := m.SendCompletion(t.Context(), "verified-player", squad, completion); err != nil {
		t.Fatal(err)
	}
	if completionRetryKey("completion-a") == completionRetryKey("completion-b") {
		t.Fatal("different completions share a retry key")
	}
	squad.RewardUnlocked = true
	raw, _ := json.Marshal(CompletionCard(squad, completion, "https://liff.line.me/test-app"))
	if !strings.Contains(string(raw), "กลับไปรับรางวัลของทีม") {
		t.Fatal("final card does not point to rewards")
	}
}

func TestCompletionPushHandlesRetriesAndDoesNotFollowRedirects(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		accepted  bool
		wantError bool
	}{
		{"accepted replay", 409, true, false}, {"other conflict", 409, false, true}, {"provider outage", 503, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.accepted {
					w.Header().Set("X-Line-Accepted-Request-Id", "accepted-request")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte("private-provider-body"))
			}))
			defer server.Close()
			err := (Messenger{AccessToken: "token", LIFFID: "app", Endpoint: server.URL}).SendCompletion(t.Context(), "subject", domain.Squad{}, domain.Completion{ID: "complete"})
			if (err != nil) != tc.wantError {
				t.Fatalf("unexpected error: %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "private-provider-body") {
				t.Fatal("provider body leaked")
			}
		})
	}
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("credential followed a redirect") }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	if err := (Messenger{AccessToken: "token", LIFFID: "app", Endpoint: redirect.URL}).SendCompletion(t.Context(), "subject", domain.Squad{}, domain.Completion{ID: "complete"}); err == nil {
		t.Fatal("redirect accepted")
	}
}
