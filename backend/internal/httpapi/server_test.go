package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
)

func TestMockAuthenticationConsentAndSquadFlow(t *testing.T) {
	game := service.NewGame(service.Config{CampaignID: "demo", SquadSize: 4})
	server := New(ServerConfig{Game: game, AllowMockAuth: true, AdminToken: "admin-test-token", QRSecret: []byte("0123456789abcdef0123456789abcdef")})
	host := httptest.NewServer(server.Handler())
	defer host.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	auth := postJSON(t, client, host.URL+"/api/v1/auth/mock", "", map[string]any{"mockUserId": "mali"})
	if auth.StatusCode != http.StatusOK {
		t.Fatalf("auth failed: %d", auth.StatusCode)
	}
	var authBody map[string]any
	decodeJSON(t, auth, &authBody)
	csrf := authBody["csrfToken"].(string)

	consent := postJSON(t, client, host.URL+"/api/v1/consent", csrf, map[string]any{"requiredAccepted": true, "analyticsAllowed": false})
	if consent.StatusCode != http.StatusOK {
		t.Fatalf("consent failed: %d", consent.StatusCode)
	}
	consent.Body.Close()

	create := postJSON(t, client, host.URL+"/api/v1/squads", csrf, map[string]any{"name": "Test Crunchers"})
	if create.StatusCode != http.StatusCreated {
		t.Fatalf("create failed: %d", create.StatusCode)
	}
	var createBody map[string]any
	decodeJSON(t, create, &createBody)
	if createBody["invitation"] == nil || createBody["squad"] == nil {
		t.Fatalf("missing create payload: %v", createBody)
	}
}

func TestMutationRequiresCSRF(t *testing.T) {
	game := service.NewGame(service.Config{})
	server := New(ServerConfig{Game: game, AllowMockAuth: true, QRSecret: []byte("0123456789abcdef0123456789abcdef")})
	host := httptest.NewServer(server.Handler())
	defer host.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	auth := postJSON(t, client, host.URL+"/api/v1/auth/mock", "", map[string]any{"mockUserId": "mali"})
	auth.Body.Close()
	response := postJSON(t, client, host.URL+"/api/v1/consent", "", map[string]any{"requiredAccepted": true})
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("expected CSRF rejection, got %d", response.StatusCode)
	}
}

func TestQRCompletionRequiresServerVerifiedProof(t *testing.T) {
	game := service.NewGame(service.Config{CampaignID: "demo", SquadSize: 4})
	server := New(ServerConfig{Game: game, AllowMockAuth: true, QRSecret: []byte("0123456789abcdef0123456789abcdef")})
	host := httptest.NewServer(server.Handler())
	defer host.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	auth := postJSON(t, client, host.URL+"/api/v1/auth/mock", "", map[string]any{"mockUserId": "mali"})
	var authBody map[string]any
	decodeJSON(t, auth, &authBody)
	csrf := authBody["csrfToken"].(string)
	response := postJSON(t, client, host.URL+"/api/v1/consent", csrf, map[string]any{"requiredAccepted": true})
	response.Body.Close()
	create := postJSON(t, client, host.URL+"/api/v1/squads", csrf, map[string]any{"name": "QR proof"})
	var created struct {
		Squad struct {
			ID string `json:"id"`
		} `json:"squad"`
	}
	decodeJSON(t, create, &created)
	response = postJSON(t, client, host.URL+"/api/v1/squads/"+created.Squad.ID+"/roles/qr_runner", csrf, map[string]any{})
	response.Body.Close()
	response = postJSON(t, client, host.URL+"/api/v1/squads/"+created.Squad.ID+"/missions/qr_runner/start", csrf, map[string]any{})
	var attempt struct {
		ID string `json:"id"`
	}
	decodeJSON(t, response, &attempt)

	completeURL := host.URL + "/api/v1/squads/" + created.Squad.ID + "/missions/qr_runner/complete"
	response = postJSONHeaders(t, client, completeURL, csrf, map[string]any{"attemptId": attempt.ID, "properties": map[string]any{"qrVerified": true, "locationId": "forged"}}, map[string]string{"Idempotency-Key": "qr-proof"})
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("forged QR completion accepted: %d", response.StatusCode)
	}
	response.Body.Close()
	response = postJSON(t, client, host.URL+"/api/v1/qr/validate", csrf, map[string]any{"token": "mock:demo-store", "attemptId": attempt.ID})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("QR validation failed: %d", response.StatusCode)
	}
	response.Body.Close()
	response = postJSONHeaders(t, client, completeURL, csrf, map[string]any{"attemptId": attempt.ID, "properties": map[string]any{}}, map[string]string{"Idempotency-Key": "qr-proof"})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("verified QR completion failed: %d", response.StatusCode)
	}
	response.Body.Close()
	response = postJSONHeaders(t, client, completeURL, csrf, map[string]any{"attemptId": attempt.ID, "properties": map[string]any{}}, map[string]string{"Idempotency-Key": "qr-proof"})
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("lost-response retry without live QR proof failed: %d", response.StatusCode)
	}
}

func postJSON(t *testing.T, client *http.Client, url, csrf string, body any) *http.Response {
	return postJSONHeaders(t, client, url, csrf, body, nil)
}

func postJSONHeaders(t *testing.T, client *http.Client, url, csrf string, body any, extra map[string]string) *http.Response {
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
	for key, value := range extra {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decodeJSON(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}
