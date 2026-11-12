package domain

import "time"

type Role string

const (
	FlavorScout    Role = "flavor_scout"
	CrunchCreator  Role = "crunch_creator"
	SnackDetective Role = "snack_detective"
	QRRunner       Role = "qr_runner"
)

var Roles = []Role{FlavorScout, CrunchCreator, SnackDetective, QRRunner}

func (r Role) Valid() bool {
	for _, candidate := range Roles {
		if r == candidate {
			return true
		}
	}
	return false
}

type User struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type Consent struct {
	RequiredAccepted bool      `json:"requiredAccepted"`
	AnalyticsAllowed bool      `json:"analyticsAllowed"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Session struct {
	ID        string
	UserID    string
	CSRFHash  []byte
	ExpiresAt time.Time
}

type Member struct {
	UserID      string    `json:"userId"`
	DisplayName string    `json:"displayName"`
	Role        Role      `json:"role,omitempty"`
	Completed   bool      `json:"completed"`
	JoinedAt    time.Time `json:"joinedAt"`
}

type Squad struct {
	ID             string    `json:"id"`
	CampaignID     string    `json:"campaignId"`
	Name           string    `json:"name"`
	Status         string    `json:"status"`
	Members        []Member  `json:"members"`
	RewardUnlocked bool      `json:"rewardUnlocked"`
	RewardUnlockID string    `json:"rewardUnlockId,omitempty"`
	RewardRedeemed bool      `json:"rewardRedeemed"`
	CreatedAt      time.Time `json:"createdAt"`
	CompletedAt    time.Time `json:"completedAt,omitempty"`
}

type Invitation struct {
	Token     string    `json:"token"`
	SquadID   string    `json:"squadId"`
	ExpiresAt time.Time `json:"expiresAt"`
	UsedBy    string    `json:"usedBy,omitempty"`
}

type Completion struct {
	ID             string         `json:"id"`
	SquadID        string         `json:"squadId"`
	UserID         string         `json:"userId"`
	Role           Role           `json:"role"`
	IdempotencyKey string         `json:"idempotencyKey"`
	Properties     map[string]any `json:"properties"`
	CompletedAt    time.Time      `json:"completedAt"`
	AttemptID      string         `json:"-"`
	RequestHash    string         `json:"-"`
}

type MissionAttempt struct {
	ID        string         `json:"id"`
	SquadID   string         `json:"squadId"`
	UserID    string         `json:"-"`
	Role      Role           `json:"role"`
	Challenge map[string]any `json:"challenge"`
	Status    string         `json:"status"`
	StartedAt time.Time      `json:"startedAt"`
	ExpiresAt time.Time      `json:"expiresAt"`
}

type QRProof struct {
	AttemptID  string `json:"-"`
	UserID     string `json:"-"`
	SessionID  string `json:"-"`
	LocationID string `json:"locationId"`
	ExpiresAt  int64  `json:"expiresAt"`
	Nonce      string `json:"-"`
}

type AnalyticsEvent struct {
	ID         string         `json:"eventId"`
	Name       string         `json:"name"`
	UserID     string         `json:"userId,omitempty"`
	SquadID    string         `json:"squadId,omitempty"`
	Role       Role           `json:"role,omitempty"`
	SessionID  string         `json:"sessionId"`
	Consent    string         `json:"consentState"`
	Properties map[string]any `json:"properties"`
	OccurredAt time.Time      `json:"serverTimestamp"`
}

type Dashboard struct {
	UniquePlayers     int            `json:"uniquePlayers"`
	SquadsCreated     int            `json:"squadsCreated"`
	CompletedSquads   int            `json:"completedSquads"`
	RewardsUnlocked   int            `json:"rewardsUnlocked"`
	RewardsRedeemed   int            `json:"rewardsRedeemed"`
	EventsByName      map[string]int `json:"eventsByName"`
	CompletionsByRole map[Role]int   `json:"completionsByRole"`
}
