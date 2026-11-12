package security

import (
	"errors"
	"testing"
	"time"
)

func TestQRTokenRoundTripAndTamperProtection(t *testing.T) {
	now := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	signer, err := NewQRSigner([]byte("0123456789abcdef0123456789abcdef"), false, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	token, err := signer.Sign("bangkok-demo-store", now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := signer.Validate(token)
	if err != nil || claims.LocationID != "bangkok-demo-store" {
		t.Fatalf("valid token rejected: %+v %v", claims, err)
	}
	_, err = signer.Validate(token + "tampered")
	if !errors.Is(err, ErrInvalidQR) {
		t.Fatalf("tampered token should fail: %v", err)
	}
}

func TestQRTokenExpiresAndMockRequiresExplicitMode(t *testing.T) {
	now := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	signer, _ := NewQRSigner([]byte("0123456789abcdef0123456789abcdef"), false, func() time.Time { return now })
	token, _ := signer.Sign("store", now.Add(time.Second))
	signer.now = func() time.Time { return now.Add(2 * time.Second) }
	if _, err := signer.Validate(token); !errors.Is(err, ErrExpiredQR) {
		t.Fatalf("expected expiry: %v", err)
	}
	if _, err := signer.Validate("mock:demo-store"); !errors.Is(err, ErrInvalidQR) {
		t.Fatalf("mock token accepted in production mode: %v", err)
	}
	mockSigner, _ := NewQRSigner([]byte("0123456789abcdef0123456789abcdef"), true, func() time.Time { return now })
	claims, err := mockSigner.Validate("mock:demo-store")
	if err != nil || claims.LocationID != "demo-store" {
		t.Fatalf("mock token rejected: %+v %v", claims, err)
	}
}
