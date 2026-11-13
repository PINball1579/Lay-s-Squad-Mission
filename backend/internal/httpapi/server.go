package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	lineadapter "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/line"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/security"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
)

type LineVerifier interface {
	Verify(context.Context, string) (lineadapter.Identity, error)
}

// GameStore is the persistence boundary used by the HTTP API. The in-memory
// service implements it for unit tests; production uses the PostgreSQL-backed
// implementation.
type GameStore interface {
	AddUser(domain.User)
	User(string) (domain.User, error)
	UpdateConsent(string, bool, bool) error
	Consent(string) domain.Consent
	CreateSquad(string, string) (domain.Squad, domain.Invitation, error)
	CreateInvitation(string, string) (domain.Invitation, error)
	JoinSquad(string, string) (domain.Squad, error)
	ClaimRole(string, string, domain.Role) (domain.Squad, error)
	StartMission(string, string, domain.Role) (domain.MissionAttempt, error)
	AdvanceFlavorCup(string, string, string, domain.FlavorCupVote) (domain.FlavorCupVoteResult, error)
	VerifyQR(string, string, string, domain.QRProof) (domain.QRProof, error)
	QRProof(string, string, string) (domain.QRProof, error)
	CompleteMission(string, string, domain.Role, string, string, map[string]any) (domain.Squad, domain.Completion, bool, error)
	RedeemReward(string, string, string) (domain.Squad, bool, error)
	RewardCoupon(string, string) (domain.RewardCoupon, error)
	CheckReceiptAttempt(string, string) error
	LeaveSquad(string, string) (domain.Squad, error)
	GetSquad(string, string) (domain.Squad, error)
	CurrentSquad(string) (domain.Squad, bool)
	RecordEvent(string, domain.AnalyticsEvent) bool
	Dashboard() domain.Dashboard
	Events() []domain.AnalyticsEvent
}

type healthChecker interface {
	Health(context.Context) error
}

type SessionStore interface {
	CreateSession(context.Context, string, []byte, []byte, []byte, time.Time) (domain.Session, error)
	Session(context.Context, []byte) (domain.Session, error)
	RevokeSession(context.Context, []byte) error
}

type ServerConfig struct {
	ReceiptOCR    ReceiptOCR
	Game          GameStore
	SessionStore  SessionStore
	LineVerifier  LineVerifier
	AllowMockAuth bool
	AllowedOrigin string
	AdminToken    string
	PseudonymKey  []byte
	QRSecret      []byte
	SecureCookies bool
	TrustProxy    bool
	Logger        *slog.Logger
}

type Server struct {
	receiptOCR    ReceiptOCR
	receiptSlots  chan struct{}
	game          GameStore
	sessionStore  SessionStore
	lineVerifier  LineVerifier
	allowMockAuth bool
	allowedOrigin string
	adminToken    string
	pseudonymKey  []byte
	qr            *security.QRSigner
	secureCookies bool
	trustProxy    bool
	logger        *slog.Logger
	mux           *http.ServeMux

	sessionMu sync.RWMutex
	sessions  map[string]session
	rateMu    sync.Mutex
	rates     map[string]rateWindow
}

type session struct {
	ID        string
	UserID    string
	CSRF      string
	CSRFHash  []byte
	ExpiresAt time.Time
}

type rateWindow struct {
	Started time.Time
	Count   int
}

var mockUsers = map[string]string{
	"mali": "Mali", "nok": "Nok", "beam": "Beam", "ploy": "Ploy", "test-runner": "Test Runner",
}

func New(config ServerConfig) *Server {
	if config.Game == nil {
		config.Game = service.NewGame(service.Config{})
	}
	if config.AllowedOrigin == "" {
		config.AllowedOrigin = "http://localhost:5173"
	}
	if len(config.PseudonymKey) < 32 {
		config.PseudonymKey = []byte("local-pseudonym-key-change-me-32-bytes")
	}
	if len(config.QRSecret) < 32 {
		config.QRSecret = []byte("local-qr-signing-key-change-me-32-byte")
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	qr, err := security.NewQRSigner(config.QRSecret, config.AllowMockAuth, nil)
	if err != nil {
		panic(err)
	}
	server := &Server{
		receiptOCR: config.ReceiptOCR, receiptSlots: make(chan struct{}, 4),
		game: config.Game, sessionStore: config.SessionStore, lineVerifier: config.LineVerifier, allowMockAuth: config.AllowMockAuth,
		allowedOrigin: config.AllowedOrigin, adminToken: config.AdminToken,
		pseudonymKey: append([]byte(nil), config.PseudonymKey...), qr: qr,
		secureCookies: config.SecureCookies, logger: config.Logger,
		trustProxy: config.TrustProxy, sessions: make(map[string]session), rates: make(map[string]rateWindow), mux: http.NewServeMux(),
	}
	server.routes()
	return server
}

func (s *Server) Handler() http.Handler {
	return s.recoverMiddleware(s.securityHeaders(s.cors(s.rateLimit(s.mux))))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /api/v1/campaign", s.campaign)
	s.mux.HandleFunc("POST /api/v1/auth/mock", s.authMock)
	s.mux.HandleFunc("POST /api/v1/auth/line", s.authLine)
	s.mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	s.mux.HandleFunc("GET /api/v1/me", s.me)
	s.mux.HandleFunc("POST /api/v1/consent", s.consent)
	s.mux.HandleFunc("POST /api/v1/squads", s.createSquad)
	s.mux.HandleFunc("POST /api/v1/squads/join", s.joinSquad)
	s.mux.HandleFunc("GET /api/v1/squads/{squadID}", s.getSquad)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/leave", s.leaveSquad)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/invitations", s.createInvitation)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/roles/{role}", s.claimRole)
	s.mux.HandleFunc("GET /api/v1/missions/{role}", s.mission)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/missions/{role}/start", s.startMission)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/missions/flavor-cup/{attemptID}/vote", s.flavorCupVote)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/missions/{role}/complete", s.completeMission)
	s.mux.HandleFunc("POST /api/v1/qr/validate", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusGone, "qr_retired", "This mission now requires a receipt photo")
	})
	s.mux.HandleFunc("POST /api/v1/missions/receipts/{attemptID}/verify", s.verifyReceipt)
	s.mux.HandleFunc("GET /api/v1/squads/{squadID}/reward", s.getReward)
	s.mux.HandleFunc("POST /api/v1/squads/{squadID}/reward/redeem", s.redeemReward)
	s.mux.HandleFunc("POST /api/v1/events", s.event)
	s.mux.HandleFunc("GET /api/v1/admin/metrics", s.adminMetrics)
	s.mux.HandleFunc("GET /api/v1/admin/events.csv", s.adminEventsCSV)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if checker, ok := s.game.(healthChecker); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := checker.Health(ctx); err != nil {
			s.logger.Error("readiness check failed", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) campaign(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"id": "lays-crunch-squad", "name": "Lay's Crunch Squad",
		"tagline": "รวมแก๊ง 4 คน พิชิต 4 ภารกิจ แล้วเปิด Crunch Vault", "squadSize": 4,
		"roles":    domain.Roles,
		"flavors":  []string{"Classic", "Bar-B-Q", "Nori Seaweed", "Sour Cream & Onion", "Hot & Spicy", "Cheese", "Truffle", "Zesty Lime", "Salt & Pepper", "Tom Yum", "Mala", "Sweet Basil", "Roasted Chicken", "Grilled Shrimp", "Pizza", "Honey Butter"},
		"missions": []string{"Crunch Hunt", "Flavor Cup", "Snack Detective", "Receipt Hunt"},
		"termsUrl": "/docs/placeholder-terms", "privacyUrl": "/docs/placeholder-privacy",
		"brand": map[string]string{"primary": "#ffd928", "accent": "#e44532", "assetStatus": "campaign-ready"},
	})
}

func (s *Server) authMock(w http.ResponseWriter, r *http.Request) {
	if !s.allowMockAuth {
		writeError(w, http.StatusNotFound, "not_found", "Not found")
		return
	}
	var request struct {
		MockUserID string `json:"mockUserId"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	name, ok := mockUsers[request.MockUserID]
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_mock_user", "Choose one of the configured mock users")
		return
	}
	user := domain.User{ID: "mock:" + request.MockUserID, DisplayName: name}
	s.game.AddUser(user)
	s.createSession(w, r, user)
}

func (s *Server) authLine(w http.ResponseWriter, r *http.Request) {
	if s.lineVerifier == nil {
		writeError(w, http.StatusServiceUnavailable, "line_not_configured", "LINE authentication is not configured")
		return
	}
	var request struct {
		IDToken string `json:"idToken"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	identity, err := s.lineVerifier.Verify(r.Context(), request.IDToken)
	if err != nil {
		s.logger.Warn("LINE authentication failed", "error", err)
		writeError(w, http.StatusUnauthorized, "authentication_failed", "Authentication failed")
		return
	}
	mac := hmac.New(sha256.New, s.pseudonymKey)
	_, _ = mac.Write([]byte(identity.Subject))
	user := domain.User{ID: "line:" + hex.EncodeToString(mac.Sum(nil)), DisplayName: identity.DisplayName}
	if user.DisplayName == "" {
		user.DisplayName = "Crunch Player"
	}
	if len(user.DisplayName) > 80 {
		user.DisplayName = user.DisplayName[:80]
	}
	s.game.AddUser(user)
	s.createSession(w, r, user)
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request, user domain.User) {
	token := randomToken()
	csrf := randomToken()
	sessionID := randomToken()
	expires := time.Now().UTC().Add(8 * time.Hour)
	if s.sessionStore != nil {
		var previousHash []byte
		if previous, err := r.Cookie(s.sessionCookieName()); err == nil {
			previousHash = digest(previous.Value)
		}
		stored, err := s.sessionStore.CreateSession(r.Context(), user.ID, digest(token), digest(csrf), previousHash, expires)
		if err != nil {
			s.logger.Error("session creation failed", "error", err)
			writeError(w, http.StatusServiceUnavailable, "session_unavailable", "Authentication is temporarily unavailable")
			return
		}
		sessionID = stored.ID
	} else {
		s.sessionMu.Lock()
		if cookie, err := r.Cookie(s.sessionCookieName()); err == nil {
			delete(s.sessions, cookie.Value)
		}
		for existingToken, existing := range s.sessions {
			if !existing.ExpiresAt.After(time.Now().UTC()) {
				delete(s.sessions, existingToken)
			}
		}
		s.sessions[token] = session{ID: sessionID, UserID: user.ID, CSRF: csrf, CSRFHash: digest(csrf), ExpiresAt: expires}
		s.sessionMu.Unlock()
	}
	s.game.RecordEvent(user.ID, domain.AnalyticsEvent{Name: "authentication_completed", SessionID: sessionID})
	w.Header().Set("Cache-Control", "no-store")
	http.SetCookie(w, &http.Cookie{Name: s.sessionCookieName(), Value: token, Path: "/", HttpOnly: true, Secure: s.secureCookies, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: int((8 * time.Hour).Seconds())})
	http.SetCookie(w, &http.Cookie{Name: s.csrfCookieName(), Value: csrf, Path: "/", HttpOnly: false, Secure: s.secureCookies, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: int((8 * time.Hour).Seconds())})
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "csrfToken": csrf, "expiresAt": expires})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	_, token, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	if s.sessionStore != nil {
		if err := s.sessionStore.RevokeSession(r.Context(), digest(token)); err != nil {
			s.logger.Error("session revocation failed", "error", err)
			writeError(w, http.StatusServiceUnavailable, "session_unavailable", "Logout is temporarily unavailable")
			return
		}
	} else {
		s.sessionMu.Lock()
		delete(s.sessions, token)
		s.sessionMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: s.sessionCookieName(), Value: "", Path: "/", HttpOnly: true, Secure: s.secureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.SetCookie(w, &http.Cookie{Name: s.csrfCookieName(), Value: "", Path: "/", Secure: s.secureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, false)
	if !ok {
		return
	}
	user, err := s.game.User(sess.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	payload := map[string]any{"user": user, "consent": s.game.Consent(user.ID), "csrfToken": sess.CSRF}
	if squad, exists := s.game.CurrentSquad(user.ID); exists {
		payload["squad"] = squad
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) consent(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var request struct {
		RequiredAccepted bool `json:"requiredAccepted"`
		AnalyticsAllowed bool `json:"analyticsAllowed"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	if err := s.game.UpdateConsent(sess.UserID, request.RequiredAccepted, request.AnalyticsAllowed); err != nil {
		writeServiceError(w, err)
		return
	}
	s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "consent_updated", SessionID: sess.ID})
	writeJSON(w, http.StatusOK, s.game.Consent(sess.UserID))
}

func (s *Server) createSquad(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	if len(request.Name) > 80 || strings.ContainsAny(request.Name, "\r\n\t") {
		writeError(w, http.StatusBadRequest, "invalid_squad_name", "Choose a shorter squad name")
		return
	}
	squad, invitation, err := s.game.CreateSquad(sess.UserID, request.Name)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "squad_created", SessionID: sess.ID, SquadID: squad.ID})
	writeJSON(w, http.StatusCreated, map[string]any{"squad": squad, "invitation": invitation})
}

func (s *Server) joinSquad(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var request struct {
		Token string `json:"token"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	squad, err := s.game.JoinSquad(sess.UserID, request.Token)
	if err != nil {
		s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "squad_join_failed", SessionID: sess.ID, Properties: map[string]any{"reason": publicErrorCode(err)}})
		writeServiceError(w, err)
		return
	}
	s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "squad_joined", SessionID: sess.ID, SquadID: squad.ID})
	writeJSON(w, http.StatusOK, squad)
}

func (s *Server) getSquad(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, false)
	if !ok {
		return
	}
	squad, err := s.game.GetSquad(sess.UserID, r.PathValue("squadID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, squad)
}

func (s *Server) leaveSquad(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	squad, err := s.game.LeaveSquad(sess.UserID, r.PathValue("squadID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, squad)
}

func (s *Server) createInvitation(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	invitation, err := s.game.CreateInvitation(sess.UserID, r.PathValue("squadID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, invitation)
}

func (s *Server) claimRole(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	role := domain.Role(r.PathValue("role"))
	squad, err := s.game.ClaimRole(sess.UserID, r.PathValue("squadID"), role)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "role_selected", SessionID: sess.ID, SquadID: squad.ID, Role: role})
	writeJSON(w, http.StatusOK, squad)
}

func (s *Server) mission(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.requireSession(w, r, false); !ok {
		return
	}
	role := domain.Role(r.PathValue("role"))
	if !role.Valid() {
		writeServiceError(w, service.ErrInvalidRole)
		return
	}
	content := map[domain.Role]map[string]any{
		domain.CrunchHunter:   {"title": "Crunch Hunt — Spot the Shelf", "kind": "crunch_hunt", "configSource": "mission challenge"},
		domain.FlavorReferee:  {"title": "Flavor Cup — Crown Your Crunch", "kind": "flavor_cup", "bracketSizes": []int{4, 8, 16}, "configSource": "mission challenge"},
		domain.SnackDetective: {"title": "แกะเบาะแสสายสแน็ก", "kind": "quiz", "contentSource": "issued attempt challenge", "variants": []string{"squad", "location"}},
		domain.QRRunner:       {"title": "Receipt Hunt — ถ่ายใบเสร็จ พิชิตภารกิจ", "kind": "receipt_ocr", "provider": "OpenThai 2.0 OCR Text"},
	}
	writeJSON(w, http.StatusOK, content[role])
}

func (s *Server) flavorCupVote(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var vote domain.FlavorCupVote
	if !decodeBody(w, r, &vote) {
		return
	}
	result, err := s.game.AdvanceFlavorCup(sess.UserID, r.PathValue("squadID"), r.PathValue("attemptID"), vote)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if result.Created {
		s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "flavor_cup_matchup_selected", SessionID: sess.ID, SquadID: r.PathValue("squadID"), Role: domain.FlavorReferee, Properties: map[string]any{"matchId": result.MatchID, "leftFlavor": result.LeftFlavor, "rightFlavor": result.RightFlavor, "winnerFlavor": result.WinnerID, "selectedSide": result.SelectedSide, "round": result.Round, "decisionMs": vote.DecisionMs}})
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) startMission(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	role := domain.Role(r.PathValue("role"))
	attempt, err := s.game.StartMission(sess.UserID, r.PathValue("squadID"), role)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "mission_started", SessionID: sess.ID, SquadID: attempt.SquadID, Role: role})
	writeJSON(w, http.StatusCreated, attempt)
}

func (s *Server) completeMission(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	idempotencyKey := r.Header.Get("Idempotency-Key")
	var request struct {
		AttemptID  string         `json:"attemptId"`
		Properties map[string]any `json:"properties"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	role := domain.Role(r.PathValue("role"))
	qrProofAvailable := true
	if role == domain.QRRunner {
		proof, proofErr := s.game.QRProof(sess.UserID, sess.ID, request.AttemptID)
		qrProofAvailable = proofErr == nil && proof.LocationID == service.ReceiptProofSource
		if qrProofAvailable {
			request.Properties = map[string]any{"qrVerified": true, "receiptVerified": true, "brand": "lays", "locationId": proof.LocationID, "receiptHash": proof.Nonce, "proofExpiresAt": proof.ExpiresAt}
		} else {
			// Nil properties request only an exact attempt/key replay. This lets a
			// client recover a successful response after the short-lived QR proof
			// expires or the API restarts, without accepting a new completion.
			request.Properties = nil
		}
	}
	squad, completion, created, err := s.game.CompleteMission(sess.UserID, r.PathValue("squadID"), role, request.AttemptID, idempotencyKey, request.Properties)
	if err != nil {
		if role == domain.QRRunner && !qrProofAvailable && errors.Is(err, service.ErrMissionFailed) {
			writeError(w, http.StatusUnprocessableEntity, "receipt_verification_required", "Upload a receipt containing Lay's first")
			return
		}
		if errors.Is(err, service.ErrMissionFailed) || errors.Is(err, service.ErrAttemptInvalid) {
			reason := "requirements"
			if errors.Is(err, service.ErrAttemptInvalid) {
				reason = "attempt_invalid"
			}
			s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "mission_failed", SessionID: sess.ID, SquadID: r.PathValue("squadID"), Role: role, Properties: map[string]any{"reason": reason}})
		}
		writeServiceError(w, err)
		return
	}
	if created {
		s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "mission_completed", SessionID: sess.ID, SquadID: squad.ID, Role: role, Properties: analyticsMissionProperties(role, request.Properties)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"squad": squad, "completion": completion})
}

func (s *Server) validateQR(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var request struct {
		Token     string `json:"token"`
		AttemptID string `json:"attemptId"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	claims, err := s.qr.Validate(request.Token)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_qr", "This QR code is invalid or expired")
		return
	}
	proof, err := s.game.VerifyQR(sess.UserID, sess.ID, request.AttemptID, domain.QRProof{AttemptID: request.AttemptID, LocationID: claims.LocationID, ExpiresAt: claims.ExpiresAt, Nonce: claims.Nonce})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, proof)
}

func (s *Server) getReward(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, false)
	if !ok {
		return
	}
	squad, err := s.game.GetSquad(sess.UserID, r.PathValue("squadID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var coupon *domain.RewardCoupon
	if squad.RewardRedeemed {
		value, err := s.game.RewardCoupon(sess.UserID, squad.ID)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		coupon = &value
	}
	writeJSON(w, http.StatusOK, map[string]any{"unlocked": squad.RewardUnlocked, "redeemed": squad.RewardRedeemed, "coupon": coupon})
}

func (s *Server) redeemReward(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	squad, created, err := s.game.RedeemReward(sess.UserID, r.PathValue("squadID"), r.Header.Get("Idempotency-Key"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if created {
		s.game.RecordEvent(sess.UserID, domain.AnalyticsEvent{Name: "reward_redeemed", SessionID: sess.ID, SquadID: squad.ID})
	}
	writeJSON(w, http.StatusOK, squad)
}

func (s *Server) event(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	var event domain.AnalyticsEvent
	if !decodeBody(w, r, &event) {
		return
	}
	if !validEventName(event.Name) {
		writeError(w, http.StatusBadRequest, "invalid_event", "Unknown event name")
		return
	}
	event.UserID = ""
	event.SessionID = sess.ID
	event.Role = ""
	if event.SquadID != "" {
		squad, err := s.game.GetSquad(sess.UserID, event.SquadID)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		for _, member := range squad.Members {
			if member.UserID == sess.UserID {
				event.Role = member.Role
				break
			}
		}
	}
	event.Properties = analyticsProperties(event.Name, event.Properties)
	stored := s.game.RecordEvent(sess.UserID, event)
	writeJSON(w, http.StatusAccepted, map[string]bool{"stored": stored})
}

func (s *Server) adminMetrics(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.game.Dashboard())
}

func (s *Server) adminEventsCSV(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=analytics-events.csv")
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"event_id", "name", "server_timestamp", "user_id", "squad_id", "role", "session_id", "consent_state", "properties"})
	for _, event := range s.game.Events() {
		properties, _ := json.Marshal(event.Properties)
		_ = writer.Write([]string{safeCSV(event.ID), safeCSV(event.Name), event.OccurredAt.Format(time.RFC3339), safeCSV(event.UserID), safeCSV(event.SquadID), safeCSV(string(event.Role)), safeCSV(event.SessionID), safeCSV(event.Consent), safeCSV(string(properties))})
	}
	writer.Flush()
}

func (s *Server) requireSession(w http.ResponseWriter, r *http.Request, csrf bool) (session, string, bool) {
	cookie, err := r.Cookie(s.sessionCookieName())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication required")
		return session{}, "", false
	}
	var sess session
	var ok bool
	if s.sessionStore != nil {
		stored, storeErr := s.sessionStore.Session(r.Context(), digest(cookie.Value))
		if storeErr != nil && !errors.Is(storeErr, service.ErrNotFound) {
			s.logger.Error("session lookup failed", "error", storeErr)
			writeError(w, http.StatusServiceUnavailable, "session_unavailable", "Session verification is temporarily unavailable")
			return session{}, "", false
		}
		if storeErr == nil {
			csrfCookie, cookieErr := r.Cookie(s.csrfCookieName())
			if cookieErr == nil && hmac.Equal(stored.CSRFHash, digest(csrfCookie.Value)) {
				sess = session{ID: stored.ID, UserID: stored.UserID, CSRF: csrfCookie.Value, CSRFHash: stored.CSRFHash, ExpiresAt: stored.ExpiresAt}
				ok = true
			}
		}
	} else {
		s.sessionMu.RLock()
		sess, ok = s.sessions[cookie.Value]
		s.sessionMu.RUnlock()
	}
	if !ok || !sess.ExpiresAt.After(time.Now().UTC()) {
		if ok && s.sessionStore == nil {
			s.sessionMu.Lock()
			delete(s.sessions, cookie.Value)
			s.sessionMu.Unlock()
		}
		writeError(w, http.StatusUnauthorized, "session_expired", "Session expired")
		return session{}, "", false
	}
	if csrf && !hmac.Equal([]byte(sess.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) {
		writeError(w, http.StatusForbidden, "csrf_failed", "Request verification failed")
		return session{}, "", false
	}
	return sess, cookie.Value, true
}

func digest(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func (s *Server) sessionCookieName() string {
	if s.secureCookies {
		return "__Host-crunch_session"
	}
	return "crunch_session"
}

func (s *Server) csrfCookieName() string {
	if s.secureCookies {
		return "__Host-crunch_csrf"
	}
	return "crunch_csrf"
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	provided := r.Header.Get("X-Admin-Token")
	if s.adminToken == "" || !hmac.Equal([]byte(s.adminToken), []byte(provided)) {
		writeError(w, http.StatusUnauthorized, "admin_authentication_required", "Administrator authentication required")
		return false
	}
	return true
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if origin != s.allowedOrigin {
				writeError(w, http.StatusForbidden, "origin_not_allowed", "Origin not allowed")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key, X-Admin-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(self)")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self' https://*.line.me; base-uri 'none'")
		if strings.HasPrefix(r.URL.Path, "/api/v1/auth/") || r.URL.Path == "/api/v1/me" || strings.HasPrefix(r.URL.Path, "/api/v1/admin/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.RemoteAddr
		if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
			key = host
		}
		if forwarded := r.Header.Get("X-Forwarded-For"); s.trustProxy && forwarded != "" {
			key = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
		now := time.Now().UTC()
		s.rateMu.Lock()
		if _, exists := s.rates[key]; !exists && len(s.rates) >= 1000 {
			for candidate, candidateWindow := range s.rates {
				if now.Sub(candidateWindow.Started) >= 2*time.Minute {
					delete(s.rates, candidate)
				}
			}
			// Collapse excess fresh keys into one bucket to keep the map bounded.
			if len(s.rates) >= 1000 {
				key = "__overflow__"
			}
		}
		window := s.rates[key]
		if now.Sub(window.Started) >= time.Minute {
			window = rateWindow{Started: now}
		}
		window.Count++
		s.rates[key] = window
		s.rateMu.Unlock()
		w.Header().Set("X-RateLimit-Limit", "240")
		if window.Count > 240 {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "error", recovered)
				writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Resource not found")
	case errors.Is(err, service.ErrUnauthorized):
		writeError(w, http.StatusForbidden, "forbidden", "This action is not allowed")
	case errors.Is(err, service.ErrConsentRequired):
		writeError(w, http.StatusPreconditionRequired, "consent_required", "Required consent must be accepted")
	case errors.Is(err, service.ErrSquadFull):
		writeError(w, http.StatusConflict, "squad_full", "This squad is already full. Create a new squad to continue")
	case errors.Is(err, service.ErrInvitationExpired):
		writeError(w, http.StatusGone, "invitation_expired", "This invitation has expired")
	case errors.Is(err, service.ErrRoleTaken):
		writeError(w, http.StatusConflict, "role_taken", "Another member claimed this role")
	case errors.Is(err, service.ErrAlreadyMember), errors.Is(err, service.ErrRoleAlreadyHeld), errors.Is(err, service.ErrConflict), errors.Is(err, service.ErrInvalidState):
		writeError(w, http.StatusConflict, publicErrorCode(err), "The request conflicts with the current game state")
	case errors.Is(err, service.ErrInvalidRole):
		writeError(w, http.StatusBadRequest, "invalid_role", "Choose an available role")
	case errors.Is(err, service.ErrMissionFailed):
		writeError(w, http.StatusUnprocessableEntity, "mission_not_complete", "Complete the mission requirements first")
	case errors.Is(err, service.ErrAttemptInvalid):
		writeError(w, http.StatusUnprocessableEntity, "attempt_invalid", "This mission attempt expired or was replaced")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong")
	}
}

func publicErrorCode(err error) string {
	switch {
	case errors.Is(err, service.ErrSquadFull):
		return "squad_full"
	case errors.Is(err, service.ErrInvitationExpired):
		return "invitation_expired"
	case errors.Is(err, service.ErrRoleTaken):
		return "role_taken"
	case errors.Is(err, service.ErrAlreadyMember):
		return "already_member"
	case errors.Is(err, service.ErrInvalidState):
		return "invalid_state"
	default:
		return "request_failed"
	}
}

func validEventName(name string) bool {
	allowed := map[string]bool{
		"liff_opened": true, "authentication_completed": true, "consent_updated": true,
		"squad_created": true, "invitation_created": true, "invitation_opened": true,
		"squad_joined": true, "squad_join_failed": true, "role_viewed": true,
		"role_selected": true, "mission_started": true, "mission_step_completed": true,
		"mission_failed": true, "mission_completed": true, "squad_completed": true,
		"reward_unlocked": true, "reward_viewed": true, "reward_redeemed": true,
		"share_initiated": true, "share_completed": true, "survey_completed": true,
		"crunch_hunt_started": true, "crunch_hunt_tap": true, "crunch_hunt_difference_found": true,
		"crunch_hunt_hint_used": true, "crunch_hunt_restarted": true, "crunch_hunt_timed_out": true, "crunch_hunt_completed": true,
		"flavor_cup_started": true, "flavor_cup_resumed": true, "flavor_cup_matchup_selected": true,
		"flavor_cup_completed": true, "flavor_cup_result_shared": true,
	}
	return allowed[name]
}

func analyticsProperties(name string, properties map[string]any) map[string]any {
	allowedByEvent := map[string]map[string]bool{
		"liff_opened":                  {"source": true, "deviceCategory": true},
		"invitation_opened":            {"source": true, "utmSource": true, "utmMedium": true, "utmCampaign": true},
		"squad_join_failed":            {"reason": true},
		"role_viewed":                  {"contentVersion": true},
		"mission_started":              {"contentVersion": true},
		"mission_step_completed":       {"step": true, "questionId": true},
		"mission_failed":               {"reason": true, "questionId": true},
		"share_initiated":              {"shareSurface": true},
		"share_completed":              {"shareSurface": true, "result": true},
		"survey_completed":             {"rating": true},
		"crunch_hunt_started":          {"timerSeconds": true, "differenceCount": true},
		"crunch_hunt_tap":              {"x": true, "y": true, "correct": true, "differenceId": true, "elapsedMs": true},
		"crunch_hunt_difference_found": {"differenceId": true, "findMs": true},
		"crunch_hunt_hint_used":        {"differenceId": true, "hintsUsed": true},
		"crunch_hunt_restarted":        {"foundCount": true},
		"crunch_hunt_timed_out":        {"foundCount": true, "wrongTaps": true, "hintsUsed": true, "missedDifferenceIds": true},
		"crunch_hunt_completed":        {"completionMs": true, "score": true, "correctTaps": true, "wrongTaps": true, "hintsUsed": true, "speedBonus": true, "missedDifferenceIds": true},
		"flavor_cup_started":           {"bracketSize": true},
		"flavor_cup_resumed":           {"selections": true, "currentRound": true},
		"flavor_cup_matchup_selected":  {"matchId": true, "leftFlavor": true, "rightFlavor": true, "winnerFlavor": true, "round": true, "decisionMs": true, "selectedSide": true},
		"flavor_cup_completed":         {"championId": true, "matchCount": true, "completionMs": true},
		"flavor_cup_result_shared":     {"championId": true, "shareSurface": true, "result": true},
	}
	allowed := allowedByEvent[name]
	result := map[string]any{}
	for key, value := range properties {
		if allowed[key] && safeAnalyticsValue(value) {
			result[key] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func analyticsMissionProperties(role domain.Role, properties map[string]any) map[string]any {
	allowed := map[domain.Role]map[string]bool{
		domain.CrunchHunter:   {"foundDifferenceIds": true, "completionMs": true, "correctTaps": true, "wrongTaps": true, "hintsUsed": true, "score": true, "speedBonus": true},
		domain.FlavorReferee:  {"championId": true, "matchCount": true, "completionMs": true},
		domain.SnackDetective: {"confidence": true, "accuracy": true, "difficultQuestions": true},
		domain.QRRunner:       {"receiptVerified": true, "brand": true},
	}[role]
	result := map[string]any{}
	for key, value := range properties {
		if allowed[key] && safeAnalyticsValue(value) {
			result[key] = value
		}
	}
	return result
}

func safeAnalyticsValue(value any) bool {
	switch typed := value.(type) {
	case string:
		return len(typed) <= 100
	case bool, float64, int, int64:
		return true
	case []any:
		if len(typed) > 10 {
			return false
		}
		for _, item := range typed {
			text, ok := item.(string)
			if !ok || len(text) > 100 {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func safeCSV(value string) string {
	if value != "" && strings.ContainsAny(value[:1], "=+-@") {
		return "'" + value
	}
	return value
}

func randomToken() string {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		panic(fmt.Sprintf("secure random source unavailable: %v", err))
	}
	return hex.EncodeToString(buffer)
}

func envBool(value string, fallback bool) bool {
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
