package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	lineadapter "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/line"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/ocr"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/httpapi"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
	postgresstore "github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/storage/postgres"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		response, err := client.Get("http://127.0.0.1:" + env("PORT", "8080") + "/healthz")
		if err != nil || response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		_ = response.Body.Close()
		return
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	mockMode := strings.EqualFold(env("MOCK_LIFF", "false"), "true")
	qrSecret := os.Getenv("QR_SIGNING_SECRET")
	pseudonymKey := os.Getenv("PSEUDONYM_KEY")
	adminToken := os.Getenv("ADMIN_API_TOKEN")
	databaseURL := os.Getenv("DATABASE_URL")
	secureCookies := strings.EqualFold(env("SECURE_COOKIES", "false"), "true")
	if !mockMode && (len(qrSecret) < 32 || len(pseudonymKey) < 32 || len(adminToken) < 32 || databaseURL == "") {
		logger.Error("production mode requires DATABASE_URL and QR_SIGNING_SECRET, PSEUDONYM_KEY, and ADMIN_API_TOKEN of at least 32 bytes")
		os.Exit(1)
	}
	if !mockMode && (qrSecret == "local-qr-signing-key-change-me-32-byte" || pseudonymKey == "local-pseudonym-key-change-me-32-bytes" || adminToken == "local-admin-demo-token" || strings.Contains(databaseURL, "crunch-local-only")) {
		logger.Error("production mode refuses known local-only credentials")
		os.Exit(1)
	}
	if !mockMode && !secureCookies {
		logger.Error("production mode requires SECURE_COOKIES=true")
		os.Exit(1)
	}
	if !mockMode && strings.TrimSpace(os.Getenv("LINE_CHANNEL_ID")) == "" {
		logger.Error("production mode requires LINE_CHANNEL_ID for server-side LINE Login verification")
		os.Exit(1)
	}

	var game httpapi.GameStore
	var sessions httpapi.SessionStore
	var closeStore func() error
	if databaseURL != "" {
		store, err := postgresstore.Open(databaseURL, env("CAMPAIGN_ID", "demo-campaign"), 4, 24*time.Hour)
		if err != nil {
			logger.Error("database startup failed", "error", err)
			os.Exit(1)
		}
		game = store
		sessions = store
		closeStore = store.Close
		logger.Info("PostgreSQL game store connected")
	} else {
		if !mockMode {
			logger.Error("production mode requires DATABASE_URL")
			os.Exit(1)
		}
		logger.Warn("DATABASE_URL is unset; using non-persistent in-memory game store")
		game = service.NewGame(service.Config{CampaignID: env("CAMPAIGN_ID", "demo-campaign"), SquadSize: 4, InviteTTL: 24 * time.Hour})
	}
	if closeStore != nil {
		defer closeStore()
	}
	var verifier httpapi.LineVerifier
	if channelID := os.Getenv("LINE_CHANNEL_ID"); channelID != "" {
		verifier = lineadapter.Verifier{ChannelID: channelID}
	}
	var receiptOCR httpapi.ReceiptOCR
	if key := os.Getenv("IAPP_API_KEY"); key != "" {
		receiptOCR = ocr.OpenThai{APIKey: key, URL: env("IAPP_OCR_ENDPOINT", ocr.Endpoint)}
	}
	server := httpapi.New(httpapi.ServerConfig{
		ReceiptOCR: receiptOCR,
		Game:       game, SessionStore: sessions, LineVerifier: verifier, AllowMockAuth: mockMode,
		AllowedOrigin: env("ALLOWED_ORIGIN", "http://localhost:5173"),
		AdminToken:    adminToken, PseudonymKey: []byte(pseudonymKey),
		QRSecret: []byte(qrSecret), SecureCookies: secureCookies, Logger: logger,
		TrustProxy: strings.EqualFold(env("TRUST_PROXY_HEADERS", "false"), "true"),
	})
	httpServer := &http.Server{Addr: ":" + env("PORT", "8080"), Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second}

	go func() {
		logger.Info("API listening", "address", httpServer.Addr, "mockLiff", mockMode)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("API stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
