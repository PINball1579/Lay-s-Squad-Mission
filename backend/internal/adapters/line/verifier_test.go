package line

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerifierPostsIDTokenAndTrustsVerifiedSubject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("id_token") != "signed-token" || r.Form.Get("client_id") != "channel-123" {
			t.Fatalf("unexpected verification form: %v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sub":"verified-line-subject","aud":"channel-123","name":"Verified Player","exp":4102444800}`))
	}))
	defer server.Close()

	verifier := Verifier{ChannelID: "channel-123", Endpoint: server.URL, Client: server.Client()}
	identity, err := verifier.Verify(t.Context(), "signed-token")
	if err != nil {
		t.Fatal(err)
	}
	if identity.Subject != "verified-line-subject" || identity.DisplayName != "Verified Player" {
		t.Fatalf("unexpected identity: %+v", identity)
	}
}

func TestVerifierRejectsRemoteFailureAndWrongAudience(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sub":"subject","aud":"another-channel","exp":4102444800}`))
	}))
	defer server.Close()
	verifier := Verifier{ChannelID: "channel-123", Endpoint: server.URL, Client: server.Client()}
	if _, err := verifier.Verify(t.Context(), "signed-token"); err == nil {
		t.Fatal("wrong audience was accepted")
	}
}
