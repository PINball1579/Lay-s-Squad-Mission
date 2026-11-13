package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/adapters/ocr"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/service"
)

type ReceiptOCR interface {
	ReadText(context.Context, []byte, string) (string, error)
}

func (s *Server) verifyReceipt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	sess, _, ok := s.requireSession(w, r, true)
	if !ok {
		return
	}
	attemptID := r.PathValue("attemptID")
	if err := s.game.CheckReceiptAttempt(sess.UserID, attemptID); err != nil {
		writeServiceError(w, err)
		return
	}
	if s.receiptOCR == nil {
		writeError(w, 503, "ocr_not_configured", "Receipt OCR is not configured")
		return
	}
	now := time.Now()
	s.rateMu.Lock()
	key := "receipt:" + sess.UserID
	window := s.rates[key]
	if now.Sub(window.Started) >= time.Minute {
		window = rateWindow{Started: now}
	}
	window.Count++
	s.rates[key] = window
	s.rateMu.Unlock()
	if window.Count > 6 {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "ocr_rate_limited", "Please wait before trying another receipt")
		return
	}
	select {
	case s.receiptSlots <- struct{}{}:
		defer func() { <-s.receiptSlots }()
	default:
		w.Header().Set("Retry-After", "10")
		writeError(w, 429, "ocr_rate_limited", "OCR is busy")
		return
	}
	const limit = 10 << 20
	r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
	if r.ParseMultipartForm(limit+(1<<20)) != nil {
		writeError(w, 413, "receipt_too_large", "Upload a JPEG or PNG under 10 MB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if r.FormValue("receiptConsent") != "true" {
		writeError(w, 400, "receipt_consent_required", "Confirm receipt processing first")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "receipt_required", "Select a receipt photo")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || len(data) > limit || len(data) == 0 {
		writeError(w, 413, "receipt_too_large", "Upload a JPEG or PNG under 10 MB")
		return
	}
	extension := ""
	switch http.DetectContentType(data) {
	case "image/jpeg":
		extension = ".jpg"
	case "image/png":
		extension = ".png"
	default:
		writeError(w, 415, "receipt_format", "Use a JPEG or PNG photo")
		return
	}
	dimensions, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || dimensions.Width <= 0 || dimensions.Height <= 0 || int64(dimensions.Width)*int64(dimensions.Height) > 40_000_000 {
		writeError(w, 415, "receipt_format", "The receipt photo could not be read")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	text, err := s.receiptOCR.ReadText(ctx, data, extension)
	if err != nil {
		if errors.Is(err, ocr.ErrRateLimited) {
			writeError(w, 429, "ocr_rate_limited", "OCR is busy; please retry later")
		} else {
			writeError(w, 503, "ocr_unavailable", "Receipt OCR is temporarily unavailable")
		}
		return
	}
	if !ocr.ContainsLays(text) {
		writeError(w, 422, "lays_not_found", "Lay's was not found on this receipt")
		return
	}
	digest := sha256.Sum256(data)
	_, err = s.game.VerifyQR(sess.UserID, sess.ID, attemptID, domain.QRProof{LocationID: service.ReceiptProofSource, Nonce: hex.EncodeToString(digest[:]), ExpiresAt: time.Now().Add(15 * time.Minute).Unix()})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"verified": true, "brand": "lays"})
}
