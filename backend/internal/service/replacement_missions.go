package service

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"strings"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

type flavorCupFlavor struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Color       string `json:"color"`
}

type flavorCupMatch struct {
	ID           string `json:"id"`
	Round        int    `json:"round"`
	Index        int    `json:"index"`
	LeftID       string `json:"leftId"`
	RightID      string `json:"rightId"`
	WinnerID     string `json:"winnerId,omitempty"`
	SelectedSide string `json:"selectedSide,omitempty"`
	DecisionMs   int64  `json:"decisionMs,omitempty"`
}

type flavorCupTournament struct {
	BracketSize    int               `json:"bracketSize"`
	Flavors        []flavorCupFlavor `json:"flavors"`
	Matches        []flavorCupMatch  `json:"matches"`
	CurrentMatchID string            `json:"currentMatchId"`
	ChampionID     string            `json:"championId,omitempty"`
	Completed      bool              `json:"completed"`
	SelectionCount int               `json:"selectionCount"`
}

type flavorCupConfig struct {
	BracketSize   int               `json:"bracketSize"`
	Flavors       []flavorCupFlavor `json:"flavors"`
	SeedOrder     []string          `json:"seedOrder"`
	PlacementMode string            `json:"placementMode"`
	ShareCard     map[string]any    `json:"shareCard"`
}

func MissionAttemptTTL(role domain.Role) time.Duration {
	if role == domain.FlavorReferee {
		return 7 * 24 * time.Hour
	}
	return 15 * time.Minute
}

func NewMissionChallengeWithConfig(role domain.Role, config map[string]any) map[string]any {
	switch role {
	case domain.QRRunner:
		return map[string]any{"kind": "receipt_ocr", "version": 2, "maxUploadBytes": 10 << 20, "provider": "OpenThai 2.0 OCR Text"}
	case domain.CrunchHunter:
		challenge := defaultCrunchHuntChallenge()
		for _, key := range []string{"timerSeconds", "maxHints", "images", "differences", "scoring", "comparisonMode"} {
			if value, ok := config[key]; ok {
				challenge[key] = value
			}
		}
		return challenge
	case domain.FlavorReferee:
		return newFlavorCupChallenge(config)
	default:
		return newLegacyMissionChallenge(role)
	}
}

func defaultCrunchHuntChallenge() map[string]any {
	return map[string]any{
		"kind": "crunch_hunt", "version": 2, "timerSeconds": 90, "maxHints": 2, "comparisonMode": "responsive",
		"images":  map[string]any{"left": "/missions/crunch-hunt-a.svg", "right": "/missions/crunch-hunt-b.svg", "alt": "ชั้นวางสินค้าแบบจำลองสำหรับเกมจับผิดภาพ"},
		"scoring": map[string]any{"basePerDifference": 100, "speedBonusPerSecond": 5, "wrongTapPenalty": 15, "hintPenalty": 25},
		"differences": []map[string]any{
			{"id": "promo-sign", "x": 0.50, "y": 0.13, "radius": 0.09, "hint": "ดูป้ายโปรโมชันด้านบน"},
			{"id": "missing-bag", "x": 0.19, "y": 0.43, "radius": 0.09, "hint": "ลองดูจำนวนถุงบนชั้นกลาง"},
			{"id": "color-swap", "x": 0.76, "y": 0.43, "radius": 0.09, "hint": "สีถุงหนึ่งใบไม่เหมือนกัน"},
			{"id": "shelf-label", "x": 0.35, "y": 0.72, "radius": 0.08, "hint": "ป้ายราคาบนชั้นล่างขยับไป"},
			{"id": "quantity", "x": 0.82, "y": 0.73, "radius": 0.09, "hint": "นับจำนวนสินค้าด้านขวาล่าง"},
		},
	}
}

func newFlavorCupChallenge(config map[string]any) map[string]any {
	defaults := flavorCupConfig{BracketSize: 16, Flavors: defaultFlavors(), PlacementMode: "random", ShareCard: map[string]any{"title": "My Flavor Champion", "accent": "#ffd928", "message": "แชมป์รสชาติของฉันคือ {flavor} จาก Lay's Crunch Squad"}}
	if len(config) != 0 {
		raw, _ := json.Marshal(config)
		var supplied flavorCupConfig
		if json.Unmarshal(raw, &supplied) == nil {
			if supplied.BracketSize == 4 || supplied.BracketSize == 8 || supplied.BracketSize == 16 {
				defaults.BracketSize = supplied.BracketSize
			}
			if len(supplied.Flavors) >= defaults.BracketSize {
				defaults.Flavors = supplied.Flavors
			}
			defaults.SeedOrder = supplied.SeedOrder
			if supplied.PlacementMode == "random" || supplied.PlacementMode == "alternate" {
				defaults.PlacementMode = supplied.PlacementMode
			}
			if len(supplied.ShareCard) != 0 {
				defaults.ShareCard = supplied.ShareCard
			}
		}
	}
	flavors := append([]flavorCupFlavor(nil), defaults.Flavors[:defaults.BracketSize]...)
	if seeded, ok := seedFlavors(flavors, defaults.SeedOrder); ok {
		flavors = seeded
		if defaults.PlacementMode == "alternate" {
			for pair := 1; pair < defaults.BracketSize/2; pair += 2 {
				left := pair * 2
				flavors[left], flavors[left+1] = flavors[left+1], flavors[left]
			}
		}
	} else {
		secureShuffleFlavors(flavors)
	}
	matches := make([]flavorCupMatch, 0, defaults.BracketSize-1)
	matchCount := defaults.BracketSize / 2
	for round := 1; matchCount >= 1; round++ {
		for index := 0; index < matchCount; index++ {
			match := flavorCupMatch{ID: flavorMatchID(round, index), Round: round, Index: index}
			if round == 1 {
				match.LeftID = flavors[index*2].ID
				match.RightID = flavors[index*2+1].ID
			}
			matches = append(matches, match)
		}
		matchCount /= 2
	}
	tournament := flavorCupTournament{BracketSize: defaults.BracketSize, Flavors: flavors, Matches: matches, CurrentMatchID: matches[0].ID}
	return map[string]any{"kind": "flavor_cup", "version": 3, "tournament": tournament, "shareCard": defaults.ShareCard, "placementMode": defaults.PlacementMode, "supportedBracketSizes": []int{4, 8, 16}}
}

func seedFlavors(flavors []flavorCupFlavor, seedOrder []string) ([]flavorCupFlavor, bool) {
	if len(seedOrder) < len(flavors) {
		return nil, false
	}
	byID := make(map[string]flavorCupFlavor, len(flavors))
	for _, flavor := range flavors {
		byID[flavor.ID] = flavor
	}
	seeded := make([]flavorCupFlavor, 0, len(flavors))
	seen := map[string]bool{}
	for _, id := range seedOrder {
		flavor, ok := byID[id]
		if !ok || seen[id] {
			return nil, false
		}
		seen[id] = true
		seeded = append(seeded, flavor)
		if len(seeded) == len(flavors) {
			return seeded, true
		}
	}
	return nil, false
}

func ApplyFlavorCupVote(challenge map[string]any, vote domain.FlavorCupVote) (map[string]any, domain.FlavorCupVoteResult, error) {
	var tournament flavorCupTournament
	raw, err := json.Marshal(challenge["tournament"])
	if err != nil || json.Unmarshal(raw, &tournament) != nil || len(tournament.Matches) == 0 {
		return nil, domain.FlavorCupVoteResult{}, ErrInvalidState
	}
	matchIndex := -1
	for index := range tournament.Matches {
		if tournament.Matches[index].ID == vote.MatchID {
			matchIndex = index
			break
		}
	}
	if matchIndex < 0 {
		return nil, domain.FlavorCupVoteResult{}, ErrNotFound
	}
	match := &tournament.Matches[matchIndex]
	if match.WinnerID != "" {
		if match.WinnerID == vote.WinnerID {
			return challenge, voteResult(tournament, *match, false), nil
		}
		return nil, domain.FlavorCupVoteResult{}, ErrConflict
	}
	if tournament.Completed || tournament.CurrentMatchID != vote.MatchID || (vote.WinnerID != match.LeftID && vote.WinnerID != match.RightID) || vote.DecisionMs < 0 || vote.DecisionMs > int64(time.Hour/time.Millisecond) {
		return nil, domain.FlavorCupVoteResult{}, ErrInvalidState
	}
	match.WinnerID = vote.WinnerID
	match.DecisionMs = vote.DecisionMs
	match.SelectedSide = "left"
	if vote.WinnerID == match.RightID {
		match.SelectedSide = "right"
	}
	tournament.SelectionCount++

	if match.Round == tournamentRoundCount(tournament.BracketSize) {
		tournament.Completed = true
		tournament.ChampionID = vote.WinnerID
		tournament.CurrentMatchID = ""
	} else {
		nextRound, nextIndex := match.Round+1, match.Index/2
		for index := range tournament.Matches {
			next := &tournament.Matches[index]
			if next.Round == nextRound && next.Index == nextIndex {
				if match.Index%2 == 0 {
					next.LeftID = vote.WinnerID
				} else {
					next.RightID = vote.WinnerID
				}
				break
			}
		}
		tournament.CurrentMatchID = ""
		for _, candidate := range tournament.Matches {
			if candidate.WinnerID == "" && candidate.LeftID != "" && candidate.RightID != "" {
				tournament.CurrentMatchID = candidate.ID
				break
			}
		}
	}
	updated := cloneMap(challenge)
	updated["tournament"] = tournament
	return updated, voteResult(tournament, *match, true), nil
}

func FlavorCupCompleted(challenge map[string]any, championID string) bool {
	var tournament flavorCupTournament
	raw, _ := json.Marshal(challenge["tournament"])
	return json.Unmarshal(raw, &tournament) == nil && tournament.Completed && tournament.ChampionID != "" && tournament.ChampionID == championID && tournament.SelectionCount == tournament.BracketSize-1
}

func CrunchHuntCompleted(challenge, properties map[string]any) bool {
	differences, ok := challenge["differences"].([]any)
	if !ok {
		raw, _ := json.Marshal(challenge["differences"])
		_ = json.Unmarshal(raw, &differences)
	}
	found, foundOK := properties["foundDifferenceIds"].([]any)
	if !foundOK || len(differences) == 0 || len(found) != len(differences) {
		return false
	}
	required := map[string]bool{}
	for _, item := range differences {
		entry, _ := item.(map[string]any)
		id, _ := entry["id"].(string)
		required[id] = id != ""
	}
	for _, item := range found {
		id, ok := item.(string)
		if !ok || !required[id] {
			return false
		}
		delete(required, id)
	}
	duration, durationOK := numberProperty(properties, "completionMs")
	timer, timerOK := numberProperty(challenge, "timerSeconds")
	score, scoreOK := numberProperty(properties, "score")
	return len(required) == 0 && durationOK && timerOK && scoreOK && duration >= 0 && duration <= timer*1000 && score >= 0
}

func voteResult(tournament flavorCupTournament, match flavorCupMatch, created bool) domain.FlavorCupVoteResult {
	return domain.FlavorCupVoteResult{MatchID: match.ID, WinnerID: match.WinnerID, LeftFlavor: match.LeftID, RightFlavor: match.RightID, SelectedSide: match.SelectedSide, Round: match.Round, ChampionID: tournament.ChampionID, Created: created}
}

func flavorMatchID(round, index int) string {
	return "r" + string(rune('0'+round)) + "m" + string(rune('1'+index))
}

func tournamentRoundCount(size int) int {
	rounds := 0
	for size > 1 {
		rounds++
		size /= 2
	}
	return rounds
}

func secureShuffleFlavors(values []flavorCupFlavor) {
	for index := len(values) - 1; index > 0; index-- {
		position, err := rand.Int(rand.Reader, big.NewInt(int64(index+1)))
		if err != nil {
			return
		}
		values[index], values[position.Int64()] = values[position.Int64()], values[index]
	}
}

func defaultFlavors() []flavorCupFlavor {
	return []flavorCupFlavor{
		{ID: "classic", Name: "Classic", Description: "เค็มคลาสสิก กรอบทุกคำ", Image: "/missions/products/classic.jpg", Color: "#d5a900"},
		{ID: "bbq", Name: "Bar-B-Q", Description: "หอมเข้มสไตล์บาร์บีคิว", Image: "/missions/products/barbecue.jpg", Color: "#b9472c"},
		{ID: "nori", Name: "Nori Seaweed", Description: "หอมสาหร่ายเต็มรส", Image: "/missions/products/salt-vinegar.jpg", Color: "#287443"},
		{ID: "sour-cream", Name: "Sour Cream & Onion", Description: "ครีมมี่ หอมหัวหอม", Image: "/missions/products/sour-cream.jpg", Color: "#4087a4"},
		{ID: "hot-spicy", Name: "Hot & Spicy", Description: "เผ็ดร้อนแบบถึงใจ", Image: "/missions/products/barbecue.jpg", Color: "#c12f26"},
		{ID: "cheese", Name: "Cheese", Description: "ชีสเข้มข้นทุกแผ่น", Image: "/missions/products/classic.jpg", Color: "#d87918"},
		{ID: "truffle", Name: "Truffle", Description: "หอมทรัฟเฟิลสไตล์พรีเมียม", Image: "/missions/products/classic.jpg", Color: "#493854"},
		{ID: "lime", Name: "Zesty Lime", Description: "เปรี้ยวซ่า สดชื่น", Image: "/missions/products/salt-vinegar.jpg", Color: "#6b9120"},
		{ID: "salt-pepper", Name: "Salt & Pepper", Description: "เค็มหอมพริกไทย", Image: "/missions/products/classic.jpg", Color: "#3f4148"},
		{ID: "tom-yum", Name: "Tom Yum", Description: "แซ่บครบรสต้มยำ", Image: "/missions/products/barbecue.jpg", Color: "#dc551f"},
		{ID: "mala", Name: "Mala", Description: "เผ็ดชา หอมเครื่องเทศ", Image: "/missions/products/barbecue.jpg", Color: "#722121"},
		{ID: "sweet-basil", Name: "Sweet Basil", Description: "หอมกะเพรา รสจัดจ้าน", Image: "/missions/products/sour-cream.jpg", Color: "#2c6337"},
		{ID: "chicken", Name: "Roasted Chicken", Description: "หอมไก่อบกลมกล่อม", Image: "/missions/products/classic.jpg", Color: "#985129"},
		{ID: "shrimp", Name: "Grilled Shrimp", Description: "หอมกุ้งย่าง", Image: "/missions/products/barbecue.jpg", Color: "#c85c51"},
		{ID: "pizza", Name: "Pizza", Description: "ชีสและมะเขือเทศลงตัว", Image: "/missions/products/barbecue.jpg", Color: "#aa362d"},
		{ID: "honey-butter", Name: "Honey Butter", Description: "หวานหอมเนย", Image: "/missions/products/sour-cream.jpg", Color: "#c78b22"},
	}
}

func cloneMap(source map[string]any) map[string]any {
	raw, _ := json.Marshal(source)
	var clone map[string]any
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func stringProperty(properties map[string]any, key string) string {
	value, _ := properties[key].(string)
	return strings.TrimSpace(value)
}
