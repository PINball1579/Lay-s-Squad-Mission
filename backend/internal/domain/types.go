package domain

import "time"

type Role string

const (
	// The stored role codes stay stable so historical completions and analytics
	// remain queryable after the mission replacement.
	CrunchHunter   Role = "flavor_scout"
	FlavorReferee  Role = "crunch_creator"
	SnackDetective Role = "snack_detective"
	QRRunner       Role = "qr_runner"
)

var Roles = []Role{CrunchHunter, FlavorReferee, SnackDetective, QRRunner}

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

// RewardCoupon is disclosed only to active squad members after a claim.
// Never attach it to squad snapshots, logs, or analytics.
type RewardCoupon struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	TestOnly bool   `json:"testOnly"`
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

type FlavorCupVote struct {
	MatchID    string `json:"matchId"`
	WinnerID   string `json:"winnerId"`
	DecisionMs int64  `json:"decisionMs"`
}

type FlavorCupVoteResult struct {
	Attempt      MissionAttempt `json:"attempt"`
	MatchID      string         `json:"matchId"`
	WinnerID     string         `json:"winnerId"`
	LeftFlavor   string         `json:"leftFlavor"`
	RightFlavor  string         `json:"rightFlavor"`
	SelectedSide string         `json:"selectedSide"`
	Round        int            `json:"round"`
	ChampionID   string         `json:"championId,omitempty"`
	Created      bool           `json:"created"`
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
	UniquePlayers     int                 `json:"uniquePlayers"`
	SquadsCreated     int                 `json:"squadsCreated"`
	CompletedSquads   int                 `json:"completedSquads"`
	RewardsUnlocked   int                 `json:"rewardsUnlocked"`
	RewardsRedeemed   int                 `json:"rewardsRedeemed"`
	EventsByName      map[string]int      `json:"eventsByName"`
	CompletionsByRole map[Role]int        `json:"completionsByRole"`
	FlavorPerformance []FlavorPerformance `json:"flavorPerformance"`
}

type FlavorPerformance struct {
	FlavorID      string  `json:"flavorId"`
	ExposureCount int     `json:"exposureCount"`
	WinCount      int     `json:"winCount"`
	ChampionCount int     `json:"championCount"`
	WinRate       float64 `json:"winRate"`
}
