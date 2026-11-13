package ocr

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenThaiDoesNotForwardKeyOnRedirect(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	if _, err := (OpenThai{APIKey: "private-test-key", URL: source.URL}).ReadText(context.Background(), nil, ".png"); err == nil {
		t.Fatal("redirect accepted")
	}
	if called {
		t.Fatal("API key was forwarded to redirect target")
	}
}
