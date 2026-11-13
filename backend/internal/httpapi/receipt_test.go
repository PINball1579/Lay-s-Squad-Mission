package httpapi

import (
	"bytes"
	"context"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
)

type receiptTestOCR struct {
	text  string
	calls int
}

func (o *receiptTestOCR) ReadText(_ context.Context, _ []byte, _ string) (string, error) {
	o.calls++
	return o.text, nil
}

func uploadReceipt(t *testing.T, client *http.Client, url, csrf string, data []byte, consent bool) *http.Response {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "receipt.png")
	part.Write(data)
	if consent {
		writer.WriteField("receiptConsent", "true")
	}
	writer.Close()
	request, _ := http.NewRequest("POST", url, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-CSRF-Token", csrf)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
func testReceiptVerification(t *testing.T) {
	game := service.NewGame(service.Config{})
	provider := &receiptTestOCR{text: "COLA 20.00"}
	server := New(ServerConfig{Game: game, AllowMockAuth: true, ReceiptOCR: provider})
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
	response = postJSON(t, client, host.URL+"/api/v1/squads", csrf, map[string]any{"name": "Receipt squad"})
	var created struct {
		Squad struct {
			ID string `json:"id"`
		} `json:"squad"`
	}
	decodeJSON(t, response, &created)
	base := host.URL + "/api/v1/squads/" + created.Squad.ID
	response = postJSON(t, client, base+"/roles/qr_runner", csrf, map[string]any{})
	response.Body.Close()
	response = postJSON(t, client, base+"/missions/qr_runner/start", csrf, map[string]any{})
	var attempt struct {
		ID string `json:"id"`
	}
	decodeJSON(t, response, &attempt)
	completeURL := base + "/missions/qr_runner/complete"
	response = postJSONHeaders(t, client, completeURL, csrf, map[string]any{"attemptId": attempt.ID, "properties": map[string]any{"receiptVerified": true, "qrVerified": true, "locationId": "receipt-lays"}}, map[string]string{"Idempotency-Key": "receipt-proof"})
	if response.StatusCode != 422 {
		t.Fatalf("client forged completion accepted: %d", response.StatusCode)
	}
	response.Body.Close()
	response = postJSON(t, client, host.URL+"/api/v1/qr/validate", csrf, map[string]any{"token": "mock:receipt-lays", "attemptId": attempt.ID})
	if response.StatusCode != 410 {
		t.Fatal("retired QR path still active")
	}
	response.Body.Close()
	var picture bytes.Buffer
	png.Encode(&picture, image.NewNRGBA(image.Rect(0, 0, 2, 2)))
	verifyURL := host.URL + "/api/v1/missions/receipts/" + attempt.ID + "/verify"
	response = uploadReceipt(t, client, verifyURL, csrf, picture.Bytes(), false)
	if response.StatusCode != 400 || provider.calls != 0 {
		t.Fatal("missing consent used OCR")
	}
	response.Body.Close()
	response = uploadReceipt(t, client, verifyURL, csrf, []byte("not-an-image"), true)
	if response.StatusCode != 415 || provider.calls != 0 {
		t.Fatal("invalid file used OCR")
	}
	response.Body.Close()
	response = uploadReceipt(t, client, verifyURL, csrf, picture.Bytes(), true)
	if response.StatusCode != 422 {
		t.Fatal("receipt without Lays accepted")
	}
	response.Body.Close()
	provider.text = "STORE\nLay’s Classic 29.00"
	response = uploadReceipt(t, client, verifyURL, csrf, picture.Bytes(), true)
	if response.StatusCode != 200 {
		t.Fatalf("OCR receipt rejected: %d", response.StatusCode)
	}
	var verified map[string]any
	decodeJSON(t, response, &verified)
	if verified["text"] != nil {
		t.Fatal("receipt text leaked")
	}
	for i := 0; i < 2; i++ {
		response = postJSONHeaders(t, client, completeURL, csrf, map[string]any{"attemptId": attempt.ID, "properties": map[string]any{}}, map[string]string{"Idempotency-Key": "receipt-proof"})
		if response.StatusCode != 200 {
			t.Fatalf("completion/retry failed: %d", response.StatusCode)
		}
		response.Body.Close()
	}
}
