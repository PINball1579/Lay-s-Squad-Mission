package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const operationTimeout = 8 * time.Second

// Game persists the complete game state in PostgreSQL. Every operation that
// spans multiple tables is transactional, and contention-sensitive operations
// take row locks before evaluating their invariants.
type Game struct {
	db           *sql.DB
	campaignSlug string
	campaignID   string
	squadSize    int
	inviteTTL    time.Duration
}

func Open(databaseURL, campaignSlug string, squadSize int, inviteTTL time.Duration) (*Game, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), operationTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	if campaignSlug == "" {
		campaignSlug = "demo-campaign"
	}
	if squadSize <= 0 {
		squadSize = 4
	}
	if inviteTTL <= 0 {
		inviteTTL = 24 * time.Hour
	}
	var campaignID string
	if err := db.QueryRowContext(ctx, `SELECT id FROM campaigns WHERE slug=$1`, campaignSlug).Scan(&campaignID); err != nil {
		db.Close()
		return nil, fmt.Errorf("resolve campaign %q: %w", campaignSlug, err)
	}
	return &Game{db: db, campaignSlug: campaignSlug, campaignID: campaignID, squadSize: squadSize, inviteTTL: inviteTTL}, nil
}

func (g *Game) Close() error { return g.db.Close() }

func (g *Game) Health(ctx context.Context) error {
	var applied bool
	if err := g.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='0011_replacement_missions.up.sql')`).Scan(&applied); err != nil {
		return err
	}
	if !applied {
		return errors.New("required database migrations are not applied")
	}
	return nil
}

func (g *Game) CreateSession(ctx context.Context, userID string, tokenHash, csrfHash, previousTokenHash []byte, expiresAt time.Time) (domain.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Session{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `WITH expired AS (SELECT id FROM sessions WHERE revoked_at IS NULL AND expires_at<=now() ORDER BY expires_at LIMIT 500) UPDATE sessions SET revoked_at=now() WHERE id IN (SELECT id FROM expired)`); err != nil {
		return domain.Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `WITH stale AS (SELECT id FROM sessions WHERE expires_at<now()-interval '30 days' AND revoked_at<now()-interval '30 days' ORDER BY expires_at LIMIT 500) DELETE FROM sessions WHERE id IN (SELECT id FROM stale)`); err != nil {
		return domain.Session{}, err
	}
	var internalUser string
	if err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE pseudonymous_id=$1`, userID).Scan(&internalUser); err != nil {
		return domain.Session{}, mapNotFound(err)
	}
	var previousUser sql.NullString
	if len(previousTokenHash) != 0 {
		err = tx.QueryRowContext(ctx, `SELECT user_id FROM sessions WHERE token_hash=$1`, previousTokenHash).Scan(&previousUser)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return domain.Session{}, err
		}
	}
	// Lock both the incoming account and any account represented by the prior
	// browser cookie in stable UUID order. This serializes same-account rotation
	// without introducing cross-account switch deadlocks.
	var previousArg any
	if previousUser.Valid {
		previousArg = previousUser.String
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE id=$1 OR id=$2 ORDER BY id FOR UPDATE`, internalUser, previousArg)
	if err != nil {
		return domain.Session{}, err
	}
	for rows.Next() {
		var locked string
		if err = rows.Scan(&locked); err != nil {
			rows.Close()
			return domain.Session{}, err
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return domain.Session{}, err
	}
	if err = rows.Close(); err != nil {
		return domain.Session{}, err
	}
	if len(previousTokenHash) != 0 {
		if _, err = tx.ExecContext(ctx, `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, previousTokenHash); err != nil {
			return domain.Session{}, err
		}
	}
	// One active login per user limits replay exposure and makes rotation
	// deterministic across API replicas.
	if _, err = tx.ExecContext(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, internalUser); err != nil {
		return domain.Session{}, err
	}
	created := domain.Session{UserID: userID, CSRFHash: append([]byte(nil), csrfHash...), ExpiresAt: expiresAt}
	if err = tx.QueryRowContext(ctx, `INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4) RETURNING id`, internalUser, tokenHash, csrfHash, expiresAt).Scan(&created.ID); err != nil {
		return domain.Session{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Session{}, err
	}
	return created, nil
}

func (g *Game) Session(ctx context.Context, tokenHash []byte) (domain.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	var result domain.Session
	err := g.db.QueryRowContext(ctx, `SELECT s.id,u.pseudonymous_id,s.csrf_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, tokenHash).Scan(&result.ID, &result.UserID, &result.CSRFHash, &result.ExpiresAt)
	return result, mapNotFound(err)
}

func (g *Game) RevokeSession(ctx context.Context, tokenHash []byte) error {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	_, err := g.db.ExecContext(ctx, `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash)
	return err
}

func (g *Game) AddUser(user domain.User) {
	ctx, cancel := g.context()
	defer cancel()
	_, err := g.db.ExecContext(ctx, `
		INSERT INTO users (pseudonymous_id, display_name) VALUES ($1, $2)
		ON CONFLICT (pseudonymous_id) DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now()`,
		user.ID, user.DisplayName)
	g.must(err)
}

func (g *Game) User(userID string) (domain.User, error) {
	ctx, cancel := g.context()
	defer cancel()
	var user domain.User
	err := g.db.QueryRowContext(ctx, `SELECT pseudonymous_id, display_name FROM users WHERE pseudonymous_id=$1`, userID).Scan(&user.ID, &user.DisplayName)
	return user, mapNotFound(err)
}

func (g *Game) UpdateConsent(userID string, required, analytics bool) error {
	if !required {
		analytics = false
	}
	ctx, cancel := g.context()
	defer cancel()
	result, err := g.db.ExecContext(ctx, `
		INSERT INTO consent_records (user_id, campaign_id, required_accepted, analytics_allowed, notice_version)
		SELECT id, $2, $3, $4, 'mvp-1' FROM users WHERE pseudonymous_id=$1`, userID, g.campaignID, required, analytics)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return service.ErrNotFound
	}
	return nil
}

func (g *Game) Consent(userID string) domain.Consent {
	ctx, cancel := g.context()
	defer cancel()
	var consent domain.Consent
	err := g.db.QueryRowContext(ctx, `
		SELECT required_accepted, analytics_allowed, recorded_at
		FROM consent_records c JOIN users u ON u.id=c.user_id
		WHERE u.pseudonymous_id=$1 AND c.campaign_id=$2 ORDER BY recorded_at DESC LIMIT 1`, userID, g.campaignID).
		Scan(&consent.RequiredAccepted, &consent.AnalyticsAllowed, &consent.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Consent{}
	}
	g.must(err)
	return consent
}

func (g *Game) CreateSquad(userID, name string) (domain.Squad, domain.Invitation, error) {
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	defer tx.Rollback()
	user, campaign, err := g.playableIDs(ctx, tx, userID)
	if err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	var existing bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM squad_members WHERE user_id=$1 AND campaign_id=$2 AND state='active')`, user, campaign).Scan(&existing)
	if err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	if existing {
		return domain.Squad{}, domain.Invitation{}, service.ErrAlreadyMember
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Crunch Squad"
	}
	var squadID string
	if err = tx.QueryRowContext(ctx, `INSERT INTO squads(campaign_id,name,status,created_by) VALUES($1,$2,'forming',$3) RETURNING id`, campaign, name, user).Scan(&squadID); err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO squad_members(squad_id,campaign_id,user_id,state) VALUES($1,$2,$3,'active')`, squadID, campaign, user); err != nil {
		return domain.Squad{}, domain.Invitation{}, mapUnique(err, service.ErrAlreadyMember)
	}
	invite, err := g.createInvitation(ctx, tx, user, squadID)
	if err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, domain.Invitation{}, err
	}
	squad, err := g.loadSquad(ctx, g.db, squadID)
	return squad, invite, err
}

func (g *Game) CreateInvitation(userID, squadID string) (domain.Invitation, error) {
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Invitation{}, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.Invitation{}, err
	}
	var internalUser string
	err = tx.QueryRowContext(ctx, `SELECT u.id FROM users u JOIN squad_members sm ON sm.user_id=u.id JOIN consent_records cr ON cr.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$3 ORDER BY recorded_at DESC LIMIT 1) WHERE u.pseudonymous_id=$1 AND sm.squad_id=$2 AND sm.campaign_id=$3 AND sm.state='active' AND cr.required_accepted`, userID, squadID, g.campaignID).Scan(&internalUser)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, service.ErrUnauthorized
	}
	if err != nil {
		return domain.Invitation{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM squad_members WHERE squad_id=$1 AND state='active'`, squadID).Scan(&count); err != nil {
		return domain.Invitation{}, err
	}
	if count >= g.squadSize {
		return domain.Invitation{}, service.ErrSquadFull
	}
	invite, err := g.createInvitation(ctx, tx, internalUser, squadID)
	if err != nil {
		return domain.Invitation{}, err
	}
	return invite, tx.Commit()
}

func (g *Game) JoinSquad(userID, token string) (domain.Squad, error) {
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, err
	}
	defer tx.Rollback()
	user, campaign, err := g.playableIDs(ctx, tx, userID)
	if err != nil {
		return domain.Squad{}, err
	}
	hash := sha256.Sum256([]byte(token))
	var squadID string
	var expires time.Time
	err = tx.QueryRowContext(ctx, `SELECT i.squad_id, i.expires_at FROM invitations i JOIN squads s ON s.id=i.squad_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND s.campaign_id=$2 FOR UPDATE OF i,s`, hash[:], campaign).Scan(&squadID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, service.ErrNotFound
	}
	if err != nil {
		return domain.Squad{}, err
	}
	if !expires.After(time.Now()) {
		return domain.Squad{}, service.ErrInvitationExpired
	}
	var current string
	err = tx.QueryRowContext(ctx, `SELECT squad_id FROM squad_members WHERE user_id=$1 AND campaign_id=$2 AND state='active'`, user, campaign).Scan(&current)
	if err == nil {
		if current == squadID {
			tx.Commit()
			return g.loadSquad(ctx, g.db, squadID)
		}
		return domain.Squad{}, service.ErrAlreadyMember
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM squad_members WHERE squad_id=$1 AND state='active'`, squadID).Scan(&count); err != nil {
		return domain.Squad{}, err
	}
	if count >= g.squadSize {
		return domain.Squad{}, service.ErrSquadFull
	}
	result, err := tx.ExecContext(ctx, `UPDATE squad_members SET state='active',joined_at=now(),left_at=NULL WHERE squad_id=$1 AND user_id=$2 AND state<>'active'`, squadID, user)
	if err != nil {
		return domain.Squad{}, err
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		if _, err = tx.ExecContext(ctx, `INSERT INTO squad_members(squad_id,campaign_id,user_id,state) VALUES($1,$2,$3,'active')`, squadID, campaign, user); err != nil {
			return domain.Squad{}, mapUnique(err, service.ErrAlreadyMember)
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE squads SET status='active',updated_at=now() WHERE id=$1`, squadID); err != nil {
		return domain.Squad{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, err
	}
	return g.loadSquad(ctx, g.db, squadID)
}

func (g *Game) ClaimRole(userID, squadID string, role domain.Role) (domain.Squad, error) {
	if !role.Valid() {
		return domain.Squad{}, service.ErrInvalidRole
	}
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.Squad{}, err
	}
	// Keep the campaign -> squad -> member lock order shared by claim,
	// completion, and leave to avoid claim/leave deadlocks.
	var lockedSquad string
	if err = tx.QueryRowContext(ctx, `SELECT id FROM squads WHERE id=$1 AND campaign_id=$2 FOR UPDATE`, squadID, g.campaignID).Scan(&lockedSquad); err != nil {
		return domain.Squad{}, mapNotFound(err)
	}
	var memberID, campaignID, roleID string
	err = tx.QueryRowContext(ctx, `SELECT sm.id,sm.campaign_id FROM squad_members sm JOIN users u ON u.id=sm.user_id JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$3 ORDER BY recorded_at DESC LIMIT 1) WHERE u.pseudonymous_id=$1 AND sm.squad_id=$2 AND sm.campaign_id=$3 AND sm.state='active' AND c.required_accepted FOR UPDATE OF sm`, userID, squadID, g.campaignID).Scan(&memberID, &campaignID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, service.ErrUnauthorized
	}
	if err != nil {
		return domain.Squad{}, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT id FROM roles WHERE campaign_id=$1 AND code=$2 AND active`, campaignID, role).Scan(&roleID); errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, service.ErrInvalidRole
	}
	if err != nil {
		return domain.Squad{}, err
	}
	var heldRole string
	err = tx.QueryRowContext(ctx, `SELECT r.code FROM role_assignments ra JOIN roles r ON r.id=ra.role_id WHERE ra.squad_id=$1 AND ra.member_id=$2 AND ra.status<>'released'`, squadID, memberID).Scan(&heldRole)
	if err == nil {
		if heldRole == string(role) {
			tx.Commit()
			return g.loadSquad(ctx, g.db, squadID)
		}
		return domain.Squad{}, service.ErrRoleAlreadyHeld
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO role_assignments(squad_id,member_id,role_id,status,campaign_id) VALUES($1,$2,$3,'claimed',$4)`, squadID, memberID, roleID, campaignID)
	if err != nil {
		return domain.Squad{}, mapUnique(err, service.ErrRoleTaken)
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, err
	}
	return g.loadSquad(ctx, g.db, squadID)
}

func (g *Game) StartMission(userID, squadID string, role domain.Role) (domain.MissionAttempt, error) {
	if !role.Valid() {
		return domain.MissionAttempt{}, service.ErrInvalidRole
	}
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.MissionAttempt{}, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.MissionAttempt{}, err
	}
	if _, err = tx.ExecContext(ctx, `SELECT 1 FROM squads WHERE id=$1 AND campaign_id=$2 FOR UPDATE`, squadID, g.campaignID); err != nil {
		return domain.MissionAttempt{}, mapNotFound(err)
	}
	var assignmentID, assignmentStatus string
	err = tx.QueryRowContext(ctx, `SELECT ra.id,ra.status FROM role_assignments ra JOIN roles r ON r.id=ra.role_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$4 ORDER BY recorded_at DESC LIMIT 1) WHERE ra.squad_id=$1 AND ra.campaign_id=$4 AND r.code=$2 AND u.pseudonymous_id=$3 AND sm.state='active' AND c.required_accepted FOR UPDATE OF ra`, squadID, role, userID, g.campaignID).Scan(&assignmentID, &assignmentStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.MissionAttempt{}, service.ErrUnauthorized
	}
	if err != nil {
		return domain.MissionAttempt{}, err
	}
	if assignmentStatus == "completed" {
		return domain.MissionAttempt{}, service.ErrInvalidState
	}
	if role == domain.FlavorReferee {
		var existing domain.MissionAttempt
		var properties []byte
		err = tx.QueryRowContext(ctx, `SELECT id,properties,started_at,expires_at FROM mission_attempts WHERE assignment_id=$1 AND status='started' AND expires_at>now() ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, assignmentID).Scan(&existing.ID, &properties, &existing.StartedAt, &existing.ExpiresAt)
		if err == nil {
			var metadata struct {
				Challenge map[string]any `json:"challenge"`
			}
			if json.Unmarshal(properties, &metadata) != nil {
				return domain.MissionAttempt{}, service.ErrInvalidState
			}
			existing.SquadID, existing.UserID, existing.Role, existing.Challenge, existing.Status = squadID, userID, role, metadata.Challenge, "started"
			if err = tx.Commit(); err != nil {
				return domain.MissionAttempt{}, err
			}
			return existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return domain.MissionAttempt{}, err
		}
	}
	missionConfig := map[string]any{}
	var configRaw []byte
	err = tx.QueryRowContext(ctx, `SELECT m.content FROM missions m JOIN roles r ON r.id=m.role_id WHERE r.campaign_id=$1 AND r.code=$2 AND m.active ORDER BY m.version DESC LIMIT 1`, g.campaignID, role).Scan(&configRaw)
	if err == nil {
		_ = json.Unmarshal(configRaw, &missionConfig)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return domain.MissionAttempt{}, err
	}
	challenge := service.NewMissionChallengeWithConfig(role, missionConfig)
	metadata, _ := json.Marshal(map[string]any{"challenge": challenge})
	if _, err = tx.ExecContext(ctx, `UPDATE mission_attempts SET status='failed',finished_at=now() WHERE assignment_id=$1 AND status='started'`, assignmentID); err != nil {
		return domain.MissionAttempt{}, err
	}
	attempt := domain.MissionAttempt{SquadID: squadID, UserID: userID, Role: role, Challenge: challenge, Status: "started"}
	expiresAt := time.Now().UTC().Add(service.MissionAttemptTTL(role))
	if err = tx.QueryRowContext(ctx, `INSERT INTO mission_attempts(assignment_id,status,properties,expires_at) VALUES($1,'started',$2,$3) RETURNING id,started_at,expires_at`, assignmentID, metadata, expiresAt).Scan(&attempt.ID, &attempt.StartedAt, &attempt.ExpiresAt); err != nil {
		return domain.MissionAttempt{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.MissionAttempt{}, err
	}
	return attempt, nil
}

func (g *Game) AdvanceFlavorCup(userID, squadID, attemptID string, vote domain.FlavorCupVote) (domain.FlavorCupVoteResult, error) {
	if !validUUID(attemptID) {
		return domain.FlavorCupVoteResult{}, service.ErrAttemptInvalid
	}
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.FlavorCupVoteResult{}, err
	}
	defer tx.Rollback()
	var attempt domain.MissionAttempt
	var properties []byte
	err = tx.QueryRowContext(ctx, `SELECT ma.id,ma.properties,ma.started_at,ma.expires_at FROM mission_attempts ma JOIN role_assignments ra ON ra.id=ma.assignment_id JOIN roles r ON r.id=ra.role_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=ra.campaign_id ORDER BY recorded_at DESC LIMIT 1) WHERE ma.id=$1 AND ra.squad_id=$2 AND ra.campaign_id=$3 AND r.code=$4 AND u.pseudonymous_id=$5 AND sm.state='active' AND c.required_accepted AND ma.status='started' AND ma.expires_at>now() FOR UPDATE OF ma`, attemptID, squadID, g.campaignID, domain.FlavorReferee, userID).Scan(&attempt.ID, &properties, &attempt.StartedAt, &attempt.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.FlavorCupVoteResult{}, service.ErrAttemptInvalid
	}
	if err != nil {
		return domain.FlavorCupVoteResult{}, err
	}
	var metadata struct {
		Challenge map[string]any `json:"challenge"`
	}
	if json.Unmarshal(properties, &metadata) != nil {
		return domain.FlavorCupVoteResult{}, service.ErrInvalidState
	}
	updated, result, err := service.ApplyFlavorCupVote(metadata.Challenge, vote)
	if err != nil {
		return domain.FlavorCupVoteResult{}, err
	}
	challengeRaw, _ := json.Marshal(updated)
	if result.Created {
		if err = tx.QueryRowContext(ctx, `UPDATE mission_attempts SET properties=jsonb_set(properties,'{challenge}',$2::jsonb,true),expires_at=GREATEST(expires_at,now()+interval '7 days') WHERE id=$1 RETURNING expires_at`, attemptID, challengeRaw).Scan(&attempt.ExpiresAt); err != nil {
			return domain.FlavorCupVoteResult{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return domain.FlavorCupVoteResult{}, err
	}
	attempt.SquadID, attempt.UserID, attempt.Role, attempt.Challenge, attempt.Status = squadID, userID, domain.FlavorReferee, updated, "started"
	result.Attempt = attempt
	return result, nil
}

func (g *Game) VerifyQR(userID, sessionID, attemptID string, proof domain.QRProof) (domain.QRProof, error) {
	if !validUUID(attemptID) || !validUUID(sessionID) || strings.TrimSpace(proof.LocationID) == "" || strings.TrimSpace(proof.Nonce) == "" {
		return domain.QRProof{}, service.ErrAttemptInvalid
	}
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.QRProof{}, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.QRProof{}, err
	}
	var locationID, locationCode string
	err = tx.QueryRowContext(ctx, `SELECT ql.id,ql.code FROM mission_attempts ma JOIN role_assignments ra ON ra.id=ma.assignment_id JOIN roles r ON r.id=ra.role_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id JOIN sessions s ON s.id=$2 AND s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=ra.campaign_id ORDER BY recorded_at DESC LIMIT 1) JOIN qr_locations ql ON ql.campaign_id=ra.campaign_id AND ql.code=$4 AND ql.active WHERE ma.id=$1 AND u.pseudonymous_id=$3 AND r.code='qr_runner' AND sm.state='active' AND c.required_accepted AND ma.status='started' AND ma.expires_at>now() AND to_timestamp($5)>now() FOR UPDATE OF ma`, attemptID, sessionID, userID, proof.LocationID, proof.ExpiresAt).Scan(&locationID, &locationCode)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.QRProof{}, service.ErrAttemptInvalid
	}
	if err != nil {
		return domain.QRProof{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE mission_attempts SET qr_location_id=$2,qr_session_id=$3,qr_nonce=$4,qr_proof_expires_at=to_timestamp($5) WHERE id=$1`, attemptID, locationID, sessionID, proof.Nonce, proof.ExpiresAt); err != nil {
		return domain.QRProof{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.QRProof{}, err
	}
	proof.AttemptID, proof.UserID, proof.SessionID, proof.LocationID = attemptID, userID, sessionID, locationCode
	return proof, nil
}

func (g *Game) QRProof(userID, sessionID, attemptID string) (domain.QRProof, error) {
	if !validUUID(attemptID) || !validUUID(sessionID) {
		return domain.QRProof{}, service.ErrMissionFailed
	}
	ctx, cancel := g.context()
	defer cancel()
	proof := domain.QRProof{AttemptID: attemptID, UserID: userID, SessionID: sessionID}
	var expiresAt time.Time
	err := g.db.QueryRowContext(ctx, `SELECT ql.code,ma.qr_nonce,ma.qr_proof_expires_at FROM mission_attempts ma JOIN role_assignments ra ON ra.id=ma.assignment_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id JOIN sessions s ON s.id=ma.qr_session_id AND s.id=$2 AND s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() JOIN qr_locations ql ON ql.id=ma.qr_location_id AND ql.campaign_id=ra.campaign_id AND ql.active WHERE ma.id=$1 AND u.pseudonymous_id=$3 AND ma.status='started' AND ma.expires_at>now() AND ma.qr_proof_expires_at>now()`, attemptID, sessionID, userID).Scan(&proof.LocationID, &proof.Nonce, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.QRProof{}, service.ErrMissionFailed
	}
	if err != nil {
		return domain.QRProof{}, err
	}
	proof.ExpiresAt = expiresAt.Unix()
	return proof, nil
}

func (g *Game) CompleteMission(userID, squadID string, role domain.Role, attemptID, idempotencyKey string, properties map[string]any) (domain.Squad, domain.Completion, bool, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return domain.Squad{}, domain.Completion{}, false, fmt.Errorf("%w: idempotency key required", service.ErrConflict)
	}
	replayOnly := properties == nil
	requestPayload, err := json.Marshal(properties)
	if err != nil {
		return domain.Squad{}, domain.Completion{}, false, service.ErrMissionFailed
	}
	requestHash := sha256.Sum256(append([]byte(attemptID+"\x00"), requestPayload...))
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	defer tx.Rollback()
	// Resolve an already committed, exactly bound request before mutable
	// campaign, consent, or membership checks. This makes a lost-response retry
	// stable while still proving ownership through the original assignment.
	{
		var replay domain.Completion
		var replayRaw []byte
		var storedAttempt sql.NullString
		var storedHash []byte
		replayErr := tx.QueryRowContext(ctx, `SELECT mc.id,mc.idempotency_key,mc.properties,mc.completed_at,mc.attempt_id,mc.request_hash FROM mission_completions mc JOIN role_assignments ra ON ra.id=mc.assignment_id JOIN roles r ON r.id=ra.role_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id WHERE ra.squad_id=$1 AND r.code=$2 AND u.pseudonymous_id=$3`, squadID, role, userID).Scan(&replay.ID, &replay.IdempotencyKey, &replayRaw, &replay.CompletedAt, &storedAttempt, &storedHash)
		if replayErr == nil {
			if replay.IdempotencyKey != idempotencyKey || (storedAttempt.Valid && storedAttempt.String != attemptID) || (!replayOnly && len(storedHash) != 0 && hex.EncodeToString(storedHash) != hex.EncodeToString(requestHash[:])) {
				return domain.Squad{}, domain.Completion{}, false, service.ErrConflict
			}
			_ = json.Unmarshal(replayRaw, &replay.Properties)
			replay.SquadID, replay.UserID, replay.Role = squadID, userID, role
			if err = tx.Commit(); err != nil {
				return domain.Squad{}, domain.Completion{}, false, err
			}
			squad, loadErr := g.loadSquad(ctx, g.db, squadID)
			return squad, replay, false, loadErr
		}
		if !errors.Is(replayErr, sql.ErrNoRows) {
			return domain.Squad{}, domain.Completion{}, false, replayErr
		}
	}
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	// Serialize all completions for a squad. Without this lock, two final
	// missions could each observe only three committed completions and neither
	// would allocate the reward.
	var campaignID string
	err = tx.QueryRowContext(ctx, `SELECT campaign_id FROM squads WHERE id=$1 AND campaign_id=$2 FOR UPDATE`, squadID, g.campaignID).Scan(&campaignID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, domain.Completion{}, false, service.ErrNotFound
	}
	if err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	var assignmentID string
	err = tx.QueryRowContext(ctx, `SELECT ra.id FROM role_assignments ra JOIN roles r ON r.id=ra.role_id JOIN squad_members sm ON sm.id=ra.member_id JOIN users u ON u.id=sm.user_id JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$4 ORDER BY recorded_at DESC LIMIT 1) WHERE ra.squad_id=$1 AND ra.campaign_id=$4 AND r.code=$2 AND u.pseudonymous_id=$3 AND sm.state='active' AND c.required_accepted FOR UPDATE OF ra`, squadID, role, userID, campaignID).Scan(&assignmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, domain.Completion{}, false, service.ErrUnauthorized
	}
	if err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	var completion domain.Completion
	var raw []byte
	var storedAttempt sql.NullString
	var storedHash []byte
	err = tx.QueryRowContext(ctx, `SELECT id,idempotency_key,properties,completed_at,attempt_id,request_hash FROM mission_completions WHERE assignment_id=$1`, assignmentID).Scan(&completion.ID, &completion.IdempotencyKey, &raw, &completion.CompletedAt, &storedAttempt, &storedHash)
	if err == nil {
		if completion.IdempotencyKey != idempotencyKey || (storedAttempt.Valid && storedAttempt.String != attemptID) || (!replayOnly && len(storedHash) != 0 && hex.EncodeToString(storedHash) != hex.EncodeToString(requestHash[:])) {
			return domain.Squad{}, domain.Completion{}, false, service.ErrConflict
		}
		_ = json.Unmarshal(raw, &completion.Properties)
		completion.SquadID, completion.UserID, completion.Role = squadID, userID, role
		if err = tx.Commit(); err != nil {
			return domain.Squad{}, domain.Completion{}, false, err
		}
		squad, loadErr := g.loadSquad(ctx, g.db, squadID)
		return squad, completion, false, loadErr
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	if replayOnly {
		return domain.Squad{}, domain.Completion{}, false, service.ErrMissionFailed
	}
	var attemptRaw []byte
	if !validUUID(attemptID) {
		return domain.Squad{}, domain.Completion{}, false, service.ErrAttemptInvalid
	}
	err = tx.QueryRowContext(ctx, `SELECT properties FROM mission_attempts WHERE id=$1 AND assignment_id=$2 AND status='started' AND expires_at>now() FOR UPDATE`, attemptID, assignmentID).Scan(&attemptRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, domain.Completion{}, false, service.ErrAttemptInvalid
	}
	if err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	var attemptMetadata struct {
		Challenge map[string]any `json:"challenge"`
	}
	if role == domain.QRRunner {
		location, _ := properties["locationId"].(string)
		var verified bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM mission_attempts ma JOIN qr_locations ql ON ql.id=ma.qr_location_id AND ql.active WHERE ma.id=$1 AND ma.assignment_id=$2 AND ma.qr_session_id IS NOT NULL AND ma.qr_nonce IS NOT NULL AND ma.qr_proof_expires_at>now() AND ql.code=$3)`, attemptID, assignmentID, location).Scan(&verified); err != nil {
			return domain.Squad{}, domain.Completion{}, false, err
		}
		if !verified {
			return domain.Squad{}, domain.Completion{}, false, service.ErrMissionFailed
		}
	}
	if json.Unmarshal(attemptRaw, &attemptMetadata) != nil || !service.ValidateMissionAttempt(role, attemptMetadata.Challenge, properties) {
		return domain.Squad{}, domain.Completion{}, false, service.ErrMissionFailed
	}
	raw = requestPayload
	completion = domain.Completion{SquadID: squadID, UserID: userID, Role: role, IdempotencyKey: idempotencyKey, Properties: properties}
	if err = tx.QueryRowContext(ctx, `INSERT INTO mission_completions(assignment_id,idempotency_key,properties,attempt_id,request_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,completed_at`, assignmentID, idempotencyKey, raw, attemptID, requestHash[:]).Scan(&completion.ID, &completion.CompletedAt); err != nil {
		return domain.Squad{}, domain.Completion{}, false, mapUnique(err, service.ErrConflict)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE role_assignments SET status='completed',completed_at=now() WHERE id=$1`, assignmentID); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE mission_attempts SET status='completed',finished_at=now(),properties=properties || jsonb_build_object('result',$2::jsonb) WHERE id=$1`, attemptID, raw); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	var completeCount int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM role_assignments WHERE squad_id=$1 AND status='completed'`, squadID).Scan(&completeCount); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	if completeCount == g.squadSize {
		var existing bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM reward_unlocks WHERE squad_id=$1)`, squadID).Scan(&existing); err != nil {
			return domain.Squad{}, domain.Completion{}, false, err
		}
		if !existing {
			var rewardID, inventoryID string
			err = tx.QueryRowContext(ctx, `SELECT r.id,ri.id FROM rewards r JOIN reward_inventory ri ON ri.reward_id=r.id AND ri.state='available' WHERE r.campaign_id=$1 AND r.active ORDER BY ri.id LIMIT 1 FOR UPDATE OF ri SKIP LOCKED`, campaignID).Scan(&rewardID, &inventoryID)
			if errors.Is(err, sql.ErrNoRows) {
				return domain.Squad{}, domain.Completion{}, false, service.ErrInvalidState
			}
			if err != nil {
				return domain.Squad{}, domain.Completion{}, false, err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE reward_inventory SET state='reserved',reserved_at=now() WHERE id=$1`, inventoryID); err != nil {
				return domain.Squad{}, domain.Completion{}, false, err
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO reward_unlocks(squad_id,reward_id,inventory_id,campaign_id) VALUES($1,$2,$3,$4)`, squadID, rewardID, inventoryID, campaignID); err != nil {
				return domain.Squad{}, domain.Completion{}, false, err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE squads SET status='reward_unlocked',completed_at=now(),updated_at=now() WHERE id=$1`, squadID); err != nil {
				return domain.Squad{}, domain.Completion{}, false, err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, domain.Completion{}, false, err
	}
	squad, err := g.loadSquad(ctx, g.db, squadID)
	return squad, completion, true, err
}

func (g *Game) RedeemReward(userID, squadID, idempotencyKey string) (domain.Squad, bool, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return domain.Squad{}, false, fmt.Errorf("%w: idempotency key required", service.ErrConflict)
	}
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, false, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.Squad{}, false, err
	}
	var user, unlock, inventory string
	err = tx.QueryRowContext(ctx, `SELECT u.id,ru.id,ru.inventory_id FROM users u JOIN squad_members sm ON sm.user_id=u.id AND sm.squad_id=$2 AND sm.campaign_id=$3 AND sm.state='active' JOIN reward_unlocks ru ON ru.squad_id=sm.squad_id AND ru.campaign_id=$3 JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$3 ORDER BY recorded_at DESC LIMIT 1) WHERE u.pseudonymous_id=$1 AND c.required_accepted FOR UPDATE OF ru`, userID, squadID, g.campaignID).Scan(&user, &unlock, &inventory)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, false, service.ErrUnauthorized
	}
	if err != nil {
		return domain.Squad{}, false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT idempotency_key FROM reward_redemptions WHERE unlock_id=$1`, unlock).Scan(&existing)
	if err == nil {
		if existing != idempotencyKey {
			return domain.Squad{}, false, service.ErrConflict
		}
		tx.Commit()
		squad, e := g.loadSquad(ctx, g.db, squadID)
		return squad, false, e
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO reward_redemptions(unlock_id,user_id,idempotency_key) VALUES($1,$2,$3)`, unlock, user, idempotencyKey); err != nil {
		return domain.Squad{}, false, mapUnique(err, service.ErrConflict)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE reward_inventory SET state='redeemed',redeemed_at=now() WHERE id=$1 AND state='reserved'`, inventory); err != nil {
		return domain.Squad{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, false, err
	}
	squad, e := g.loadSquad(ctx, g.db, squadID)
	return squad, true, e
}

func (g *Game) LeaveSquad(userID, squadID string) (domain.Squad, error) {
	ctx, cancel := g.context()
	defer cancel()
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Squad{}, err
	}
	defer tx.Rollback()
	if err = g.requireEligibleCampaign(ctx, tx); err != nil {
		return domain.Squad{}, err
	}
	// Use the same campaign -> squad lock order as mission completion so leave
	// cannot delete an assignment that has just completed.
	var locked bool
	if err = tx.QueryRowContext(ctx, `SELECT status IN ('reward_unlocked','completed','closed') FROM squads WHERE id=$1 AND campaign_id=$2 FOR UPDATE`, squadID, g.campaignID).Scan(&locked); err != nil {
		return domain.Squad{}, mapNotFound(err)
	}
	if locked {
		return domain.Squad{}, service.ErrInvalidState
	}
	var member, assignment string
	err = tx.QueryRowContext(ctx, `SELECT sm.id,COALESCE(ra.id::text,'') FROM squad_members sm JOIN users u ON u.id=sm.user_id JOIN consent_records c ON c.id=(SELECT id FROM consent_records WHERE user_id=u.id AND campaign_id=$3 ORDER BY recorded_at DESC LIMIT 1) LEFT JOIN role_assignments ra ON ra.member_id=sm.id AND ra.status<>'released' WHERE u.pseudonymous_id=$1 AND sm.squad_id=$2 AND sm.campaign_id=$3 AND sm.state='active' AND c.required_accepted FOR UPDATE OF sm`, userID, squadID, g.campaignID).Scan(&member, &assignment)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, service.ErrUnauthorized
	}
	if err != nil {
		return domain.Squad{}, err
	}
	if assignment != "" {
		var done bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM mission_completions WHERE assignment_id=$1)`, assignment).Scan(&done); err != nil {
			return domain.Squad{}, err
		}
		if done {
			return domain.Squad{}, service.ErrInvalidState
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM role_assignments WHERE id=$1`, assignment); err != nil {
			return domain.Squad{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE squad_members SET state='left',left_at=now() WHERE id=$1`, member); err != nil {
		return domain.Squad{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE squads SET status=CASE WHEN (SELECT count(*) FROM squad_members WHERE squad_id=$1 AND state='active')<=1 THEN 'forming' ELSE status END,updated_at=now() WHERE id=$1`, squadID); err != nil {
		return domain.Squad{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Squad{}, err
	}
	return g.loadSquad(ctx, g.db, squadID)
}

func (g *Game) GetSquad(userID, squadID string) (domain.Squad, error) {
	ctx, cancel := g.context()
	defer cancel()
	var ok bool
	if err := g.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM squad_members sm JOIN users u ON u.id=sm.user_id WHERE sm.squad_id=$1 AND sm.campaign_id=$3 AND u.pseudonymous_id=$2 AND sm.state='active')`, squadID, userID, g.campaignID).Scan(&ok); err != nil {
		return domain.Squad{}, err
	}
	if !ok {
		return domain.Squad{}, service.ErrUnauthorized
	}
	return g.loadSquad(ctx, g.db, squadID)
}

func (g *Game) CurrentSquad(userID string) (domain.Squad, bool) {
	ctx, cancel := g.context()
	defer cancel()
	var id string
	err := g.db.QueryRowContext(ctx, `SELECT sm.squad_id FROM squad_members sm JOIN users u ON u.id=sm.user_id WHERE u.pseudonymous_id=$1 AND sm.campaign_id=$2 AND sm.state='active'`, userID, g.campaignID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Squad{}, false
	}
	g.must(err)
	squad, err := g.loadSquad(ctx, g.db, id)
	g.must(err)
	return squad, true
}

func (g *Game) RecordEvent(userID string, event domain.AnalyticsEvent) bool {
	ctx, cancel := g.context()
	defer cancel()
	var user string
	var analytics bool
	err := g.db.QueryRowContext(ctx, `SELECT u.id,COALESCE((SELECT analytics_allowed FROM consent_records WHERE user_id=u.id AND campaign_id=$2 ORDER BY recorded_at DESC LIMIT 1),false) FROM users u WHERE u.pseudonymous_id=$1`, userID, g.campaignID).Scan(&user, &analytics)
	if errors.Is(err, sql.ErrNoRows) {
		return false
	}
	if err != nil {
		return false
	}
	if !analytics && !operationalEvent(event.Name) {
		return false
	}
	event.Consent = "required_only"
	var userArg any
	var squadArg any
	var roleArg any
	var sessionArg any
	props := map[string]any{}
	if analytics {
		event.Consent = "analytics_allowed"
		userArg = user
		if event.SquadID != "" {
			squadArg = event.SquadID
		}
		roleArg = nullString(string(event.Role))
		sessionArg = nullString(event.SessionID)
		props = event.Properties
	}
	raw, err := json.Marshal(props)
	if err != nil {
		return false
	}
	_, err = g.db.ExecContext(ctx, `INSERT INTO analytics_events(id,name,campaign_id,user_id,squad_id,role_code,session_id,consent_state,properties) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)`, event.Name, g.campaignID, userArg, squadArg, roleArg, sessionArg, event.Consent, raw)
	return err == nil
}

func (g *Game) Dashboard() domain.Dashboard {
	ctx, cancel := g.context()
	defer cancel()
	d := domain.Dashboard{EventsByName: map[string]int{}, CompletionsByRole: map[domain.Role]int{}}
	err := g.db.QueryRowContext(ctx, `SELECT (SELECT count(DISTINCT sm.user_id) FROM squad_members sm JOIN campaigns c ON c.id=sm.campaign_id WHERE c.slug=$1),(SELECT count(*) FROM squads s JOIN campaigns c ON c.id=s.campaign_id WHERE c.slug=$1),(SELECT count(*) FROM squads s JOIN campaigns c ON c.id=s.campaign_id WHERE c.slug=$1 AND s.completed_at IS NOT NULL),(SELECT count(*) FROM reward_unlocks ru JOIN campaigns c ON c.id=ru.campaign_id WHERE c.slug=$1),(SELECT count(*) FROM reward_redemptions rr JOIN reward_unlocks ru ON ru.id=rr.unlock_id JOIN campaigns c ON c.id=ru.campaign_id WHERE c.slug=$1)`, g.campaignSlug).Scan(&d.UniquePlayers, &d.SquadsCreated, &d.CompletedSquads, &d.RewardsUnlocked, &d.RewardsRedeemed)
	g.must(err)
	rows, err := g.db.QueryContext(ctx, `SELECT ae.name,count(*) FROM analytics_events ae JOIN campaigns c ON c.id=ae.campaign_id WHERE c.slug=$1 GROUP BY ae.name`, g.campaignSlug)
	g.must(err)
	for rows.Next() {
		var n string
		var c int
		g.must(rows.Scan(&n, &c))
		d.EventsByName[n] = c
	}
	rows.Close()
	g.must(rows.Err())
	rows, err = g.db.QueryContext(ctx, `SELECT r.code,count(*) FROM mission_completions mc JOIN role_assignments ra ON ra.id=mc.assignment_id JOIN roles r ON r.id=ra.role_id JOIN campaigns c ON c.id=ra.campaign_id WHERE c.slug=$1 GROUP BY r.code`, g.campaignSlug)
	g.must(err)
	for rows.Next() {
		var r domain.Role
		var c int
		g.must(rows.Scan(&r, &c))
		d.CompletionsByRole[r] = c
	}
	rows.Close()
	g.must(rows.Err())
	flavors := map[string]*domain.FlavorPerformance{}
	rows, err = g.db.QueryContext(ctx, `SELECT properties FROM analytics_events WHERE campaign_id=$1 AND name='flavor_cup_matchup_selected'`, g.campaignID)
	g.must(err)
	for rows.Next() {
		var raw []byte
		g.must(rows.Scan(&raw))
		var properties map[string]any
		_ = json.Unmarshal(raw, &properties)
		for _, key := range []string{"leftFlavor", "rightFlavor"} {
			if id, _ := properties[key].(string); id != "" {
				postgresFlavorMetric(flavors, id).ExposureCount++
			}
		}
		if id, _ := properties["winnerFlavor"].(string); id != "" {
			postgresFlavorMetric(flavors, id).WinCount++
		}
	}
	rows.Close()
	g.must(rows.Err())
	rows, err = g.db.QueryContext(ctx, `SELECT mc.properties FROM mission_completions mc JOIN role_assignments ra ON ra.id=mc.assignment_id JOIN roles r ON r.id=ra.role_id WHERE ra.campaign_id=$1 AND r.code=$2`, g.campaignID, domain.FlavorReferee)
	g.must(err)
	for rows.Next() {
		var raw []byte
		g.must(rows.Scan(&raw))
		var properties map[string]any
		_ = json.Unmarshal(raw, &properties)
		if id, _ := properties["championId"].(string); id != "" {
			postgresFlavorMetric(flavors, id).ChampionCount++
		}
	}
	rows.Close()
	g.must(rows.Err())
	for _, entry := range flavors {
		if entry.ExposureCount > 0 {
			entry.WinRate = float64(entry.WinCount) / float64(entry.ExposureCount)
		}
		d.FlavorPerformance = append(d.FlavorPerformance, *entry)
	}
	sort.Slice(d.FlavorPerformance, func(i, j int) bool { return d.FlavorPerformance[i].FlavorID < d.FlavorPerformance[j].FlavorID })
	return d
}

func postgresFlavorMetric(values map[string]*domain.FlavorPerformance, id string) *domain.FlavorPerformance {
	if values[id] == nil {
		values[id] = &domain.FlavorPerformance{FlavorID: id}
	}
	return values[id]
}

func (g *Game) Events() []domain.AnalyticsEvent {
	ctx, cancel := g.context()
	defer cancel()
	rows, err := g.db.QueryContext(ctx, `SELECT ae.id,ae.name,COALESCE(u.pseudonymous_id,''),COALESCE(ae.squad_id::text,''),COALESCE(ae.role_code,''),COALESCE(ae.session_id::text,''),ae.consent_state,ae.properties,ae.server_timestamp FROM analytics_events ae JOIN campaigns c ON c.id=ae.campaign_id LEFT JOIN users u ON u.id=ae.user_id WHERE c.slug=$1 ORDER BY ae.server_timestamp`, g.campaignSlug)
	g.must(err)
	defer rows.Close()
	out := []domain.AnalyticsEvent{}
	for rows.Next() {
		var e domain.AnalyticsEvent
		var raw []byte
		g.must(rows.Scan(&e.ID, &e.Name, &e.UserID, &e.SquadID, &e.Role, &e.SessionID, &e.Consent, &raw, &e.OccurredAt))
		_ = json.Unmarshal(raw, &e.Properties)
		out = append(out, e)
	}
	g.must(rows.Err())
	return out
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (g *Game) loadSquad(ctx context.Context, q queryer, squadID string) (domain.Squad, error) {
	var s domain.Squad
	var completed sql.NullTime
	err := q.QueryRowContext(ctx, `SELECT s.id,c.slug,s.name,s.status,s.created_at,s.completed_at,COALESCE(ru.id::text,''),EXISTS(SELECT 1 FROM reward_redemptions rr WHERE rr.unlock_id=ru.id) FROM squads s JOIN campaigns c ON c.id=s.campaign_id LEFT JOIN reward_unlocks ru ON ru.squad_id=s.id WHERE s.id=$1`, squadID).Scan(&s.ID, &s.CampaignID, &s.Name, &s.Status, &s.CreatedAt, &completed, &s.RewardUnlockID, &s.RewardRedeemed)
	if err != nil {
		return s, mapNotFound(err)
	}
	if completed.Valid {
		s.CompletedAt = completed.Time
	}
	s.RewardUnlocked = s.RewardUnlockID != ""
	rows, err := q.QueryContext(ctx, `SELECT u.pseudonymous_id,u.display_name,sm.joined_at,COALESCE(r.code,''),mc.id IS NOT NULL FROM squad_members sm JOIN users u ON u.id=sm.user_id LEFT JOIN role_assignments ra ON ra.member_id=sm.id AND ra.status<>'released' LEFT JOIN roles r ON r.id=ra.role_id LEFT JOIN mission_completions mc ON mc.assignment_id=ra.id WHERE sm.squad_id=$1 AND sm.state='active' ORDER BY sm.joined_at`, squadID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var m domain.Member
		if err = rows.Scan(&m.UserID, &m.DisplayName, &m.JoinedAt, &m.Role, &m.Completed); err != nil {
			return s, err
		}
		s.Members = append(s.Members, m)
	}
	return s, rows.Err()
}

func (g *Game) playableIDs(ctx context.Context, tx *sql.Tx, userID string) (string, string, error) {
	var user, campaign string
	var required bool
	err := tx.QueryRowContext(ctx, `SELECT u.id,c.id,COALESCE((SELECT required_accepted FROM consent_records WHERE user_id=u.id AND campaign_id=c.id ORDER BY recorded_at DESC LIMIT 1),false) FROM users u CROSS JOIN campaigns c WHERE u.pseudonymous_id=$1 AND c.id=$2 AND c.status='active' AND c.starts_at<=now() AND c.ends_at>now()`, userID, g.campaignID).Scan(&user, &campaign, &required)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", service.ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	if !required {
		return "", "", service.ErrConsentRequired
	}
	return user, campaign, nil
}

func (g *Game) requireEligibleCampaign(ctx context.Context, tx *sql.Tx) error {
	var id string
	err := tx.QueryRowContext(ctx, `SELECT id FROM campaigns WHERE id=$1 AND status='active' AND starts_at<=now() AND ends_at>now() FOR SHARE`, g.campaignID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return service.ErrInvalidState
	}
	return err
}
func (g *Game) createInvitation(ctx context.Context, tx *sql.Tx, user, squad string) (domain.Invitation, error) {
	token, err := randomToken(32)
	if err != nil {
		return domain.Invitation{}, err
	}
	hash := sha256.Sum256([]byte(token))
	invite := domain.Invitation{Token: token, SquadID: squad, ExpiresAt: time.Now().UTC().Add(g.inviteTTL)}
	_, err = tx.ExecContext(ctx, `INSERT INTO invitations(squad_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4)`, squad, hash[:], invite.ExpiresAt, user)
	return invite, err
}
func (g *Game) context() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), operationTimeout)
}
func (g *Game) must(err error) {
	if err != nil {
		panic(fmt.Errorf("postgres game store: %w", err))
	}
}
func mapNotFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return service.ErrNotFound
	}
	return err
}
func mapUnique(err, errorForUnique error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return errorForUnique
	}
	return err
}
func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	_, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil
}
func randomToken(bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
func operationalEvent(name string) bool {
	switch name {
	case "authentication_completed", "consent_updated", "squad_created", "squad_joined", "squad_join_failed", "mission_completed", "squad_completed", "reward_unlocked", "reward_redeemed":
		return true
	}
	return false
}

// Stable ordering makes snapshots and CSV exports deterministic.
func sortEvents(events []domain.AnalyticsEvent) {
	sort.Slice(events, func(i, j int) bool { return events[i].OccurredAt.Before(events[j].OccurredAt) })
}
