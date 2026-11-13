package ocr

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrandMatching(t *testing.T) {
	for _, text := range []string{"Lay's Classic 29.00", "LAY’S BBQ", "LAYS 2 x 20", "Lay s", "เลย์ รสสาหร่าย"} {
		if !ContainsLays(text) {
			t.Errorf("missed brand %q", text)
		}
	}
	for _, text := range []string{"", "displays", "CLAYS", "cola potato chips", "lemon"} {
		if ContainsLays(text) {
			t.Errorf("false match %q", text)
		}
	}
}
func TestOpenThaiMultipartAndResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "test-key" || r.Method != "POST" {
			t.Error("wrong auth or method")
		}
		if err := r.ParseMultipartForm(1024); err != nil {
			t.Fatal(err)
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		data, _ := io.ReadAll(f)
		if string(data) != "image-bytes" {
			t.Error("wrong file")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"text":["STORE", "LAY'S 29.00"],"time":0.6}`)
	}))
	defer server.Close()
	text, err := (OpenThai{APIKey: "test-key", URL: server.URL}).ReadText(context.Background(), []byte("image-bytes"), ".jpg")
	if err != nil || !strings.Contains(text, "LAY'S") {
		t.Fatalf("bad extraction: %v", err)
	}
}
func TestOpenThaiFailsClosed(t *testing.T) {
	for _, status := range []int{401, 402, 403, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			if _, err := (OpenThai{APIKey: "test", URL: server.URL}).ReadText(context.Background(), nil, ".jpg"); err == nil {
				t.Fatal("provider failure accepted")
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"unexpected":"LAY'S"}`) }))
	defer server.Close()
	if _, err := (OpenThai{APIKey: "test", URL: server.URL}).ReadText(context.Background(), nil, ".jpg"); err == nil {
		t.Fatal("malformed response accepted")
	}
}
