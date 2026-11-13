package ocr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const Endpoint = "https://api.iapp.co.th/v3/store/ocr/document/ocr"

var ErrUnavailable = errors.New("OCR service unavailable")
var ErrRateLimited = errors.New("OCR service rate limited")

type OpenThai struct {
	APIKey string
	URL    string
	Client *http.Client
}

func (o OpenThai) ReadText(ctx context.Context, image []byte, extension string) (string, error) {
	if strings.TrimSpace(o.APIKey) == "" {
		return "", ErrUnavailable
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "receipt"+extension)
	if err != nil {
		return "", ErrUnavailable
	}
	if _, err = part.Write(image); err != nil {
		return "", ErrUnavailable
	}
	if writer.Close() != nil {
		return "", ErrUnavailable
	}
	endpoint := o.URL
	if endpoint == "" {
		endpoint = Endpoint
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return "", ErrUnavailable
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("apikey", o.APIKey)
	request.Header.Set("Accept", "application/json")
	client := o.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := client.Do(request)
	if err != nil {
		return "", ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return "", ErrRateLimited
	}
	if response.StatusCode != http.StatusOK {
		return "", ErrUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return "", ErrUnavailable
	}
	var result struct {
		Text []string `json:"text"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Text == nil {
		return "", ErrUnavailable
	}
	return strings.Join(result.Text, "\n"), nil
}

var laysPattern = regexp.MustCompile(`(?i)(^|[^a-z])lay\s*['’‘` + "`" + `´]?\s*s([^a-z]|$)`)

func ContainsLays(text string) bool {
	text = strings.NewReplacer("\u200b", "", "\ufeff", "").Replace(text)
	return laysPattern.MatchString(text) || strings.Contains(text, "เลย์")
}
