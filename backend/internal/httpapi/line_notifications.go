package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

type CompletionMessenger interface {
	SendCompletion(context.Context, string, domain.Squad, domain.Completion) error
}

type CompletionNotificationStore interface {
	PrepareCompletionNotification(context.Context, string, domain.Squad) (domain.Squad, bool, error)
	RecordCompletionNotification(context.Context, string) error
}

func (s *Server) lineUserID(subject string) string {
	mac := hmac.New(sha256.New, s.pseudonymKey)
	_, _ = mac.Write([]byte(subject))
	return "line:" + hex.EncodeToString(mac.Sum(nil))
}

// Only a freshly verified LINE identity matching the authenticated player can
// receive a card. Raw LINE user IDs and ID tokens are never stored.
func (s *Server) notifyCompletion(ctx context.Context, userID, idToken string, squad domain.Squad, completion domain.Completion) string {
	if s.allowMockAuth {
		return "mock"
	}
	if s.completionMessenger == nil || s.lineVerifier == nil {
		return "not_configured"
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if s.notificationStore != nil {
		snapshot, accepted, err := s.notificationStore.PrepareCompletionNotification(ctx, completion.ID, squad)
		if err != nil {
			return "unavailable"
		}
		if accepted {
			return "accepted"
		}
		squad = snapshot
	} else {
		s.sessionMu.Lock()
		accepted := s.acceptedNotifications[completion.ID]
		if snapshot, exists := s.notificationSnapshots[completion.ID]; exists {
			squad = snapshot
		} else {
			squad.Members = append([]domain.Member(nil), squad.Members...)
			s.notificationSnapshots[completion.ID] = squad
		}
		s.sessionMu.Unlock()
		if accepted {
			return "accepted"
		}
	}
	if idToken == "" {
		return "identity_required"
	}
	identity, err := s.lineVerifier.Verify(ctx, idToken)
	if err != nil || !hmac.Equal([]byte(s.lineUserID(identity.Subject)), []byte(userID)) {
		return "identity_required"
	}
	if err := s.completionMessenger.SendCompletion(ctx, identity.Subject, squad, completion); err != nil {
		s.logger.Warn("LINE completion notification unavailable", "error", err)
		return "unavailable"
	}
	if s.notificationStore != nil {
		if err := s.notificationStore.RecordCompletionNotification(ctx, completion.ID); err != nil {
			return "unavailable"
		}
	} else {
		s.sessionMu.Lock()
		s.acceptedNotifications[completion.ID] = true
		s.sessionMu.Unlock()
	}
	return "accepted"
}
