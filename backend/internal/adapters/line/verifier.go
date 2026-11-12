package line

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const officialVerifyEndpoint = "https://api.line.me/oauth2/v2.1/verify"

type Identity struct {
	Subject     string
	DisplayName string
}

type Verifier struct {
	ChannelID string
	Endpoint  string
	Client    *http.Client
	Now       func() time.Time
}

type verifyResponse struct {
	Subject          string `json:"sub"`
	Name             string `json:"name"`
	Audience         string `json:"aud"`
	ExpiresAt        int64  `json:"exp"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func (v Verifier) Verify(ctx context.Context, idToken string) (Identity, error) {
	if strings.TrimSpace(v.ChannelID) == "" || strings.TrimSpace(idToken) == "" {
		return Identity{}, errors.New("LINE verification is not configured")
	}
	endpoint := v.Endpoint
	if endpoint == "" {
		endpoint = officialVerifyEndpoint
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	form := url.Values{"id_token": {idToken}, "client_id": {v.ChannelID}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return Identity{}, fmt.Errorf("verify LINE ID token: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return Identity{}, fmt.Errorf("read LINE verification response: %w", err)
	}
	var result verifyResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return Identity{}, errors.New("invalid LINE verification response")
	}
	if response.StatusCode != http.StatusOK || result.Error != "" {
		return Identity{}, errors.New("LINE ID token was rejected")
	}
	now := time.Now().UTC()
	if v.Now != nil {
		now = v.Now()
	}
	if result.Subject == "" || result.Audience != v.ChannelID || result.ExpiresAt <= now.Unix() {
		return Identity{}, errors.New("LINE ID token claims are invalid")
	}
	return Identity{Subject: result.Subject, DisplayName: result.Name}, nil
}
