package httpapi_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	lineadapter "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/line"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/httpapi"
	postgresstore "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/storage/postgres"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type fixedVerifier struct{ subject string }

func (v fixedVerifier) Verify(context.Context, string) (lineadapter.Identity, error) {
	return lineadapter.Identity{Subject: v.subject, DisplayName: "Restart Test"}, nil
}

func TestHTTPSessionSurvivesServerAndStoreRestart(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	key := []byte("integration-pseudonym-key-32-bytes-long")
	verifier := fixedVerifier{subject: "restart-" + time.Now().UTC().Format("20060102150405.000000000")}
	storeA, err := postgresstore.Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	serverA := httptest.NewServer(httpapi.New(httpapi.ServerConfig{Game: storeA, SessionStore: storeA, LineVerifier: verifier, PseudonymKey: key, QRSecret: key}).Handler())
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	authResponse := post(t, client, serverA.URL+"/api/v1/auth/line", "", map[string]any{"idToken": "test-token"})
	if authResponse.StatusCode != http.StatusOK {
		t.Fatalf("authentication failed: %d", authResponse.StatusCode)
	}
	var auth struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		CSRF string `json:"csrfToken"`
	}
	decode(t, authResponse, &auth)
	serverA.Close()
	if err := storeA.Close(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db, openErr := sql.Open("pgx", databaseURL)
		if openErr != nil {
			return
		}
		defer db.Close()
		_, _ = db.Exec(`DELETE FROM users WHERE pseudonymous_id=$1`, auth.User.ID)
	})

	storeB, err := postgresstore.Open(databaseURL, "demo-campaign", 4, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer storeB.Close()
	serverB := httptest.NewServer(httpapi.New(httpapi.ServerConfig{Game: storeB, SessionStore: storeB, LineVerifier: verifier, PseudonymKey: key, QRSecret: key}).Handler())
	defer serverB.Close()

	meResponse, err := client.Get(serverB.URL + "/api/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	if meResponse.StatusCode != http.StatusOK {
		t.Fatalf("persisted session was rejected after restart: %d", meResponse.StatusCode)
	}
	var me struct {
		CSRF string `json:"csrfToken"`
	}
	decode(t, meResponse, &me)
	if me.CSRF != auth.CSRF {
		t.Fatal("CSRF token was not reconstructed from the bound cookie")
	}
	logout := post(t, client, serverB.URL+"/api/v1/auth/logout", me.CSRF, map[string]any{})
	logout.Body.Close()
	if logout.StatusCode != http.StatusNoContent {
		t.Fatalf("logout failed: %d", logout.StatusCode)
	}
	meResponse, err = client.Get(serverB.URL + "/api/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	defer meResponse.Body.Close()
	if meResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked session remained usable: %d", meResponse.StatusCode)
	}
}

func post(t *testing.T, client *http.Client, url, csrf string, body any) *http.Response {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if csrf != "" {
		request.Header.Set("X-CSRF-Token", csrf)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decode(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}
