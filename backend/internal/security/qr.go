package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidQR = errors.New("invalid QR token")
	ErrExpiredQR = errors.New("expired QR token")
)

type QRClaims struct {
	LocationID string `json:"locationId"`
	ExpiresAt  int64  `json:"expiresAt"`
	Nonce      string `json:"nonce"`
}

type QRSigner struct {
	secret    []byte
	allowMock bool
	now       func() time.Time
}

func NewQRSigner(secret []byte, allowMock bool, now func() time.Time) (*QRSigner, error) {
	if len(secret) < 32 {
		return nil, errors.New("QR signing key must be at least 32 bytes")
	}
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &QRSigner{secret: append([]byte(nil), secret...), allowMock: allowMock, now: now}, nil
}

func (s *QRSigner) Sign(locationID string, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(locationID) == "" || !expiresAt.After(s.now()) {
		return "", ErrInvalidQR
	}
	nonceBytes := make([]byte, 12)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "", err
	}
	claims := QRClaims{LocationID: locationID, ExpiresAt: expiresAt.Unix(), Nonce: hex.EncodeToString(nonceBytes)}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := "v1." + encoded
	signature := s.signature(unsigned)
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (s *QRSigner) Validate(token string) (QRClaims, error) {
	if s.allowMock && strings.HasPrefix(token, "mock:") {
		location := strings.TrimSpace(strings.TrimPrefix(token, "mock:"))
		if location == "" {
			return QRClaims{}, ErrInvalidQR
		}
		return QRClaims{LocationID: location, ExpiresAt: s.now().Add(time.Hour).Unix(), Nonce: "local-mock"}, nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return QRClaims{}, ErrInvalidQR
	}
	supplied, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(supplied, s.signature(parts[0]+"."+parts[1])) {
		return QRClaims{}, ErrInvalidQR
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return QRClaims{}, ErrInvalidQR
	}
	var claims QRClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.LocationID == "" || claims.Nonce == "" {
		return QRClaims{}, ErrInvalidQR
	}
	if !time.Unix(claims.ExpiresAt, 0).After(s.now()) {
		return QRClaims{}, ErrExpiredQR
	}
	return claims, nil
}

func (s *QRSigner) signature(message string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(message))
	return mac.Sum(nil)
}
