package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

var (
	ErrNotFound          = errors.New("not found")
	ErrUnauthorized      = errors.New("unauthorized")
	ErrConsentRequired   = errors.New("required consent is missing")
	ErrAlreadyMember     = errors.New("user already belongs to a campaign squad")
	ErrSquadFull         = errors.New("squad is full")
	ErrInvitationExpired = errors.New("invitation expired")
	ErrRoleTaken         = errors.New("role is already assigned")
	ErrRoleAlreadyHeld   = errors.New("member already has a role")
	ErrInvalidRole       = errors.New("invalid role")
	ErrInvalidState      = errors.New("invalid state transition")
	ErrConflict          = errors.New("conflict")
	ErrMissionFailed     = errors.New("mission success criteria were not met")
	ErrAttemptInvalid    = errors.New("mission attempt is missing, expired, or replaced")
)

type Config struct {
	CampaignID string
	SquadSize  int
	InviteTTL  time.Duration
	Now        func() time.Time
	NewID      func() string
}

type Game struct {
	mu sync.RWMutex

	campaignID string
	squadSize  int
	inviteTTL  time.Duration
	now        func() time.Time
	newID      func() string

	users                  map[string]domain.User
	consents               map[string]domain.Consent
	squads                 map[string]*domain.Squad
	userSquad              map[string]string
	invitations            map[string]*domain.Invitation
	assignments            map[string]map[domain.Role]string
	memberRoles            map[string]map[string]domain.Role
	completions            map[string]domain.Completion
	completionByAssignment map[string]string
	attempts               map[string]domain.MissionAttempt
	qrProofs               map[string]domain.QRProof
	rewardUnlocks          map[string]string
	redemptionKeys         map[string]string
	events                 []domain.AnalyticsEvent
}

func NewGame(config Config) *Game {
	if config.CampaignID == "" {
		config.CampaignID = "demo-campaign"
	}
	if config.SquadSize <= 0 {
		config.SquadSize = 4
	}
	if config.InviteTTL <= 0 {
		config.InviteTTL = 24 * time.Hour
	}
	if config.Now == nil {
		config.Now = func() time.Time { return time.Now().UTC() }
	}
	if config.NewID == nil {
		config.NewID = randomID
	}
	return &Game{
		campaignID:             config.CampaignID,
		squadSize:              config.SquadSize,
		inviteTTL:              config.InviteTTL,
		now:                    config.Now,
		newID:                  config.NewID,
		users:                  make(map[string]domain.User),
		consents:               make(map[string]domain.Consent),
		squads:                 make(map[string]*domain.Squad),
		userSquad:              make(map[string]string),
		invitations:            make(map[string]*domain.Invitation),
		assignments:            make(map[string]map[domain.Role]string),
		memberRoles:            make(map[string]map[string]domain.Role),
		completions:            make(map[string]domain.Completion),
		completionByAssignment: make(map[string]string),
		attempts:               make(map[string]domain.MissionAttempt),
		qrProofs:               make(map[string]domain.QRProof),
		rewardUnlocks:          make(map[string]string),
		redemptionKeys:         make(map[string]string),
		events:                 make([]domain.AnalyticsEvent, 0),
	}
}

func (g *Game) VerifyQR(userID, sessionID, attemptID string, proof domain.QRProof) (domain.QRProof, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	attempt, ok := g.attempts[attemptID]
	if !ok || attempt.UserID != userID || attempt.Role != domain.QRRunner || attempt.Status != "started" || !attempt.ExpiresAt.After(g.now()) || !time.Unix(proof.ExpiresAt, 0).After(g.now()) || strings.TrimSpace(proof.LocationID) == "" || strings.TrimSpace(sessionID) == "" {
		return domain.QRProof{}, ErrAttemptInvalid
	}
	proof.AttemptID, proof.UserID, proof.SessionID = attemptID, userID, sessionID
	g.qrProofs[attemptID] = proof
	return proof, nil
}

func (g *Game) QRProof(userID, sessionID, attemptID string) (domain.QRProof, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	proof, ok := g.qrProofs[attemptID]
	attempt := g.attempts[attemptID]
	if !ok || proof.UserID != userID || proof.SessionID != sessionID || attempt.Status != "started" || !attempt.ExpiresAt.After(g.now()) || !time.Unix(proof.ExpiresAt, 0).After(g.now()) {
		return domain.QRProof{}, ErrMissionFailed
	}
	return proof, nil
}

func (g *Game) StartMission(userID, squadID string, role domain.Role) (domain.MissionAttempt, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !role.Valid() {
		return domain.MissionAttempt{}, ErrInvalidRole
	}
	if err := g.canPlayLocked(userID); err != nil {
		return domain.MissionAttempt{}, err
	}
	if !g.isActiveMemberLocked(userID, squadID) || g.assignments[squadID][role] != userID {
		return domain.MissionAttempt{}, ErrUnauthorized
	}
	if g.completionByAssignment[squadID+":"+string(role)] != "" {
		return domain.MissionAttempt{}, ErrInvalidState
	}
	for id, previous := range g.attempts {
		if previous.UserID == userID && previous.SquadID == squadID && previous.Role == role && previous.Status == "started" {
			previous.Status = "failed"
			g.attempts[id] = previous
		}
	}
	now := g.now()
	attempt := domain.MissionAttempt{ID: g.newID(), SquadID: squadID, UserID: userID, Role: role, Challenge: NewMissionChallenge(role), Status: "started", StartedAt: now, ExpiresAt: now.Add(15 * time.Minute)}
	g.attempts[attempt.ID] = attempt
	return attempt, nil
}

func randomID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		panic(fmt.Sprintf("secure random source unavailable: %v", err))
	}
	return hex.EncodeToString(buffer)
}

func (g *Game) AddUser(user domain.User) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.users[user.ID] = user
}

func (g *Game) User(userID string) (domain.User, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	user, ok := g.users[userID]
	if !ok {
		return domain.User{}, ErrNotFound
	}
	return user, nil
}

func (g *Game) UpdateConsent(userID string, required, analytics bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.users[userID]; !ok {
		return ErrNotFound
	}
	if !required {
		analytics = false
	}
	g.consents[userID] = domain.Consent{RequiredAccepted: required, AnalyticsAllowed: analytics, UpdatedAt: g.now()}
	return nil
}

func (g *Game) Consent(userID string) domain.Consent {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.consents[userID]
}

func (g *Game) CreateSquad(userID, name string) (domain.Squad, domain.Invitation, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	if _, exists := g.userSquad[userID]; exists {
		return domain.Squad{}, domain.Invitation{}, ErrAlreadyMember
	}
	if strings.TrimSpace(name) == "" {
		name = "Crunch Squad"
	}
	now := g.now()
	squad := &domain.Squad{
		ID: g.newID(), CampaignID: g.campaignID, Name: strings.TrimSpace(name), Status: "forming", CreatedAt: now,
		Members: []domain.Member{{UserID: userID, DisplayName: g.users[userID].DisplayName, JoinedAt: now}},
	}
	g.squads[squad.ID] = squad
	g.userSquad[userID] = squad.ID
	g.assignments[squad.ID] = make(map[domain.Role]string)
	g.memberRoles[squad.ID] = make(map[string]domain.Role)
	invite := g.createInvitationLocked(squad.ID)
	return cloneSquad(squad), invite, nil
}

func (g *Game) CreateInvitation(userID, squadID string) (domain.Invitation, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Invitation{}, err
	}
	if !g.isActiveMemberLocked(userID, squadID) {
		return domain.Invitation{}, ErrUnauthorized
	}
	squad := g.squads[squadID]
	if len(squad.Members) >= g.squadSize {
		return domain.Invitation{}, ErrSquadFull
	}
	return g.createInvitationLocked(squadID), nil
}

func (g *Game) createInvitationLocked(squadID string) domain.Invitation {
	invite := domain.Invitation{Token: g.newID() + g.newID(), SquadID: squadID, ExpiresAt: g.now().Add(g.inviteTTL)}
	g.invitations[invite.Token] = &invite
	return invite
}

func (g *Game) JoinSquad(userID, token string) (domain.Squad, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, err
	}
	if existing, ok := g.userSquad[userID]; ok {
		if invite := g.invitations[token]; invite != nil && invite.SquadID == existing {
			return cloneSquad(g.squads[existing]), nil
		}
		return domain.Squad{}, ErrAlreadyMember
	}
	invite, ok := g.invitations[token]
	if !ok {
		return domain.Squad{}, ErrNotFound
	}
	if !invite.ExpiresAt.After(g.now()) {
		return domain.Squad{}, ErrInvitationExpired
	}
	squad, ok := g.squads[invite.SquadID]
	if !ok {
		return domain.Squad{}, ErrNotFound
	}
	if len(squad.Members) >= g.squadSize {
		return domain.Squad{}, ErrSquadFull
	}
	user := g.users[userID]
	squad.Members = append(squad.Members, domain.Member{UserID: userID, DisplayName: user.DisplayName, JoinedAt: g.now()})
	if len(squad.Members) > 1 {
		squad.Status = "active"
	}
	g.userSquad[userID] = squad.ID
	return cloneSquad(squad), nil
}

func (g *Game) ClaimRole(userID, squadID string, role domain.Role) (domain.Squad, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, err
	}
	if !role.Valid() {
		return domain.Squad{}, ErrInvalidRole
	}
	if !g.isActiveMemberLocked(userID, squadID) {
		return domain.Squad{}, ErrUnauthorized
	}
	if held := g.memberRoles[squadID][userID]; held != "" {
		if held == role {
			return cloneSquad(g.squads[squadID]), nil
		}
		return domain.Squad{}, ErrRoleAlreadyHeld
	}
	if _, taken := g.assignments[squadID][role]; taken {
		return domain.Squad{}, ErrRoleTaken
	}
	g.assignments[squadID][role] = userID
	g.memberRoles[squadID][userID] = role
	squad := g.squads[squadID]
	for i := range squad.Members {
		if squad.Members[i].UserID == userID {
			squad.Members[i].Role = role
		}
	}
	return cloneSquad(squad), nil
}

func (g *Game) CompleteMission(userID, squadID string, role domain.Role, attemptID, idempotencyKey string, properties map[string]any) (domain.Squad, domain.Completion, bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if strings.TrimSpace(idempotencyKey) == "" {
		return domain.Squad{}, domain.Completion{}, false, fmt.Errorf("%w: idempotency key required", ErrConflict)
	}
	requestKey := userID + ":" + idempotencyKey
	replayOnly := properties == nil
	requestHash := completionRequestHash(attemptID, properties)
	if existing, ok := g.completions[requestKey]; ok {
		if existing.SquadID != squadID || existing.Role != role || existing.AttemptID != attemptID || (!replayOnly && existing.RequestHash != requestHash) {
			return domain.Squad{}, domain.Completion{}, false, ErrConflict
		}
		return cloneSquad(g.squads[squadID]), existing, false, nil
	}
	if replayOnly {
		return domain.Squad{}, domain.Completion{}, false, ErrMissionFailed
	}
	if !g.isActiveMemberLocked(userID, squadID) || g.assignments[squadID][role] != userID {
		return domain.Squad{}, domain.Completion{}, false, ErrUnauthorized
	}
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	assignmentKey := squadID + ":" + string(role)
	if _, done := g.completionByAssignment[assignmentKey]; done {
		return domain.Squad{}, domain.Completion{}, false, ErrConflict
	}
	attempt, ok := g.attempts[attemptID]
	if !ok || attempt.UserID != userID || attempt.SquadID != squadID || attempt.Role != role || attempt.Status != "started" || !attempt.ExpiresAt.After(g.now()) {
		return domain.Squad{}, domain.Completion{}, false, ErrAttemptInvalid
	}
	if role == domain.QRRunner {
		proof, verified := g.qrProofs[attemptID]
		if !verified || proof.UserID != userID || !time.Unix(proof.ExpiresAt, 0).After(g.now()) || properties["locationId"] != proof.LocationID {
			return domain.Squad{}, domain.Completion{}, false, ErrMissionFailed
		}
	}
	if !ValidateMissionAttempt(role, attempt.Challenge, properties) {
		return domain.Squad{}, domain.Completion{}, false, ErrMissionFailed
	}
	completion := domain.Completion{
		ID: g.newID(), SquadID: squadID, UserID: userID, Role: role, IdempotencyKey: idempotencyKey,
		Properties: cloneProperties(properties), CompletedAt: g.now(), AttemptID: attemptID, RequestHash: requestHash,
	}
	g.completions[requestKey] = completion
	g.completionByAssignment[assignmentKey] = requestKey
	attempt.Status = "completed"
	g.attempts[attemptID] = attempt
	squad := g.squads[squadID]
	for i := range squad.Members {
		if squad.Members[i].UserID == userID {
			squad.Members[i].Completed = true
		}
	}
	if g.allRolesCompleteLocked(squadID) {
		if _, exists := g.rewardUnlocks[squadID]; !exists {
			unlockID := g.newID()
			g.rewardUnlocks[squadID] = unlockID
			squad.RewardUnlockID = unlockID
			squad.RewardUnlocked = true
			squad.Status = "reward_unlocked"
			squad.CompletedAt = g.now()
		}
	}
	return cloneSquad(squad), completion, true, nil
}

func (g *Game) RedeemReward(userID, squadID, idempotencyKey string) (domain.Squad, bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if strings.TrimSpace(idempotencyKey) == "" {
		return domain.Squad{}, false, fmt.Errorf("%w: idempotency key required", ErrConflict)
	}
	if !g.isActiveMemberLocked(userID, squadID) {
		return domain.Squad{}, false, ErrUnauthorized
	}
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, false, err
	}
	squad := g.squads[squadID]
	if !squad.RewardUnlocked {
		return domain.Squad{}, false, ErrInvalidState
	}
	if existing := g.redemptionKeys[squadID]; existing != "" {
		if existing != idempotencyKey {
			return cloneSquad(squad), false, ErrConflict
		}
		return cloneSquad(squad), false, nil
	}
	g.redemptionKeys[squadID] = idempotencyKey
	squad.RewardRedeemed = true
	return cloneSquad(squad), true, nil
}

func (g *Game) LeaveSquad(userID, squadID string) (domain.Squad, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.canPlayLocked(userID); err != nil {
		return domain.Squad{}, err
	}
	if !g.isActiveMemberLocked(userID, squadID) {
		return domain.Squad{}, ErrUnauthorized
	}
	squad := g.squads[squadID]
	if squad.RewardUnlocked {
		return domain.Squad{}, ErrInvalidState
	}
	role := g.memberRoles[squadID][userID]
	if role != "" && g.completionByAssignment[squadID+":"+string(role)] != "" {
		return domain.Squad{}, ErrInvalidState
	}
	members := squad.Members[:0]
	for _, member := range squad.Members {
		if member.UserID != userID {
			members = append(members, member)
		}
	}
	squad.Members = members
	delete(g.userSquad, userID)
	delete(g.memberRoles[squadID], userID)
	if role != "" {
		delete(g.assignments[squadID], role)
	}
	if len(squad.Members) <= 1 {
		squad.Status = "forming"
	}
	return cloneSquad(squad), nil
}

func (g *Game) GetSquad(userID, squadID string) (domain.Squad, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if !g.isActiveMemberLocked(userID, squadID) {
		return domain.Squad{}, ErrUnauthorized
	}
	return cloneSquad(g.squads[squadID]), nil
}

func (g *Game) CurrentSquad(userID string) (domain.Squad, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	squadID, ok := g.userSquad[userID]
	if !ok || g.squads[squadID] == nil {
		return domain.Squad{}, false
	}
	return cloneSquad(g.squads[squadID]), true
}

func (g *Game) RecordEvent(userID string, event domain.AnalyticsEvent) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	consent := g.consents[userID]
	if !consent.AnalyticsAllowed && !isOperationalEvent(event.Name) {
		return false
	}
	event.ID = g.newID()
	event.OccurredAt = g.now()
	event.Consent = "required_only"
	if consent.AnalyticsAllowed {
		event.Consent = "analytics_allowed"
		event.UserID = userID
	} else {
		event.UserID = ""
		event.SessionID = ""
		event.SquadID = ""
		event.Role = ""
		event.Properties = nil
	}
	g.events = append(g.events, event)
	return true
}

func (g *Game) Dashboard() domain.Dashboard {
	g.mu.RLock()
	defer g.mu.RUnlock()
	metrics := domain.Dashboard{UniquePlayers: len(g.users), SquadsCreated: len(g.squads), EventsByName: map[string]int{}, CompletionsByRole: map[domain.Role]int{}}
	for _, squad := range g.squads {
		if squad.RewardUnlocked {
			metrics.CompletedSquads++
			metrics.RewardsUnlocked++
		}
		if squad.RewardRedeemed {
			metrics.RewardsRedeemed++
		}
	}
	for _, completion := range g.completions {
		metrics.CompletionsByRole[completion.Role]++
	}
	for _, event := range g.events {
		metrics.EventsByName[event.Name]++
	}
	return metrics
}

func (g *Game) Events() []domain.AnalyticsEvent {
	g.mu.RLock()
	defer g.mu.RUnlock()
	result := append([]domain.AnalyticsEvent(nil), g.events...)
	sort.Slice(result, func(i, j int) bool { return result[i].OccurredAt.Before(result[j].OccurredAt) })
	return result
}

func (g *Game) canPlayLocked(userID string) error {
	if _, ok := g.users[userID]; !ok {
		return ErrNotFound
	}
	if !g.consents[userID].RequiredAccepted {
		return ErrConsentRequired
	}
	return nil
}

func (g *Game) isActiveMemberLocked(userID, squadID string) bool {
	return g.userSquad[userID] == squadID && g.squads[squadID] != nil
}

func (g *Game) allRolesCompleteLocked(squadID string) bool {
	for _, role := range domain.Roles {
		if g.completionByAssignment[squadID+":"+string(role)] == "" {
			return false
		}
	}
	return true
}

func cloneSquad(source *domain.Squad) domain.Squad {
	if source == nil {
		return domain.Squad{}
	}
	clone := *source
	clone.Members = append([]domain.Member(nil), source.Members...)
	return clone
}

func cloneProperties(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func isOperationalEvent(name string) bool {
	switch name {
	case "authentication_completed", "consent_updated", "squad_created", "squad_joined", "squad_join_failed", "mission_completed", "squad_completed", "reward_unlocked", "reward_redeemed":
		return true
	default:
		return false
	}
}

func ValidateMissionAttempt(role domain.Role, challenge, properties map[string]any) bool {
	switch role {
	case domain.FlavorScout:
		order, ok := properties["discoveryOrder"].([]any)
		required, requiredOK := challenge["requiredOrder"].([]any)
		duration, durationOK := numberProperty(properties, "completionMs")
		if !ok || !requiredOK || len(order) != len(required) || len(order) != 3 || !durationOK || duration < 0 {
			return false
		}
		for index := range required {
			if order[index] != required[index] {
				return false
			}
		}
		return true
	case domain.CrunchCreator:
		for _, key := range []string{"occasion", "mood", "flavor", "background", "caption", "creativeStyle"} {
			value, ok := properties[key].(string)
			if !ok || strings.TrimSpace(value) == "" || len(value) > 100 {
				return false
			}
		}
		return properties["occasion"] == challenge["requiredOccasion"] && allowedString(properties["mood"], "Bold", "Cozy", "Playful", "Chill") && allowedString(properties["flavor"], "Sunny Salt", "Smoky BBQ", "Zesty Lime", "Spicy Spark") && allowedString(properties["background"], "Sunburst", "Warm waves", "Night pop") && properties["creativeStyle"] == "template-card"
	case domain.SnackDetective:
		answers, ok := properties["answers"].(map[string]any)
		if !ok {
			return false
		}
		if challenge["variant"] == "location" {
			return answers["q1"] == "QR Runner" && answers["q2"] == "Mock Crunch Badge"
		}
		return ok && answers["q1"] == "Four" && answers["q2"] == "All four missions"
	case domain.QRRunner:
		verified, _ := properties["qrVerified"].(bool)
		location, _ := properties["locationId"].(string)
		return verified && strings.TrimSpace(location) != ""
	default:
		return false
	}
}

func NewMissionChallenge(role domain.Role) map[string]any {
	challenge := map[string]any{"kind": string(role), "version": 1}
	switch role {
	case domain.FlavorScout:
		values := []any{"Sunny Salt", "Smoky BBQ", "Zesty Lime"}
		for index := len(values) - 1; index > 0; index-- {
			swap, err := rand.Int(rand.Reader, big.NewInt(int64(index+1)))
			if err != nil {
				panic(fmt.Sprintf("secure random source unavailable: %v", err))
			}
			position := int(swap.Int64())
			values[index], values[position] = values[position], values[index]
		}
		challenge["requiredOrder"] = values
	case domain.CrunchCreator:
		values := []string{"Movie night", "Game night", "Road trip", "Study break"}
		choice, err := rand.Int(rand.Reader, big.NewInt(int64(len(values))))
		if err != nil {
			panic(fmt.Sprintf("secure random source unavailable: %v", err))
		}
		challenge["requiredOccasion"] = values[choice.Int64()]
	case domain.SnackDetective:
		choice, err := rand.Int(rand.Reader, big.NewInt(2))
		if err != nil {
			panic(fmt.Sprintf("secure random source unavailable: %v", err))
		}
		if choice.Int64() == 1 {
			challenge["variant"] = "location"
			challenge["questions"] = []map[string]any{{"id": "q1", "prompt": "Which role verifies the campaign location?", "options": []string{"QR Runner", "Flavor Scout", "Crunch Creator"}}, {"id": "q2", "prompt": "What reward exists in this unofficial demo?", "options": []string{"Mock Crunch Badge", "Cash coupon", "Real product"}}}
		} else {
			challenge["variant"] = "squad"
			challenge["questions"] = []map[string]any{{"id": "q1", "prompt": "How many unique roles complete a squad?", "options": []string{"Two", "Three", "Four"}}, {"id": "q2", "prompt": "What unlocks the Crunch Vault?", "options": []string{"All four missions", "One share", "A purchase"}}}
		}
	}
	return challenge
}

func allowedString(value any, allowed ...string) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	for _, candidate := range allowed {
		if text == candidate {
			return true
		}
	}
	return false
}

func completionRequestHash(attemptID string, properties map[string]any) string {
	payload, _ := json.Marshal(properties)
	sum := sha256.Sum256(append([]byte(attemptID+"\x00"), payload...))
	return hex.EncodeToString(sum[:])
}

func numberProperty(properties map[string]any, key string) (float64, bool) {
	switch value := properties[key].(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}
