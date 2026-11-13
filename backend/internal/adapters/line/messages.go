package line

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/domain"
)

// Messenger uses a Messaging API token, never the LINE Login channel secret.
type Messenger struct {
	AccessToken string
	LIFFID      string
	Endpoint    string
	Client      *http.Client
}

func (m Messenger) SendCompletion(ctx context.Context, recipient string, squad domain.Squad, completion domain.Completion) error {
	if m.AccessToken == "" || m.LIFFID == "" || recipient == "" || completion.ID == "" {
		return errors.New("LINE messaging is not configured")
	}
	body, err := json.Marshal(map[string]any{"to": recipient, "messages": []any{CompletionCard(squad, completion, "https://liff.line.me/"+m.LIFFID)}})
	if err != nil {
		return errors.New("invalid LINE completion card")
	}
	endpoint := m.Endpoint
	if endpoint == "" {
		endpoint = "https://api.line.me/v2/bot/message/push"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("invalid LINE messaging endpoint")
	}
	request.Header.Set("Authorization", "Bearer "+m.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Line-Retry-Key", completionRetryKey(completion.ID))
	client := &http.Client{Timeout: 6 * time.Second}
	if m.Client != nil {
		*client = *m.Client
	}
	// Never forward the Messaging API credential to a redirect destination.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return errors.New("LINE messaging request failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK || (response.StatusCode == http.StatusConflict && response.Header.Get("X-Line-Accepted-Request-Id") != "") {
		return nil
	}
	// Do not log provider bodies, tokens, recipients, or card contents.
	return fmt.Errorf("LINE messaging returned HTTP %d", response.StatusCode)
}

// A stable UUID allows LINE to deduplicate a replay after an ambiguous timeout.
func completionRetryKey(id string) string {
	sum := sha256.Sum256([]byte("lays:mission-completion:" + id))
	sum[6] = (sum[6] & 0x0f) | 0x50
	sum[8] = (sum[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func CompletionCard(squad domain.Squad, completion domain.Completion, appURL string) map[string]any {
	mission := map[domain.Role]string{
		domain.CrunchHunter: "จับผิดภาพ Crunch Hunt", domain.FlavorReferee: "ศึก Flavor Cup",
		domain.SnackDetective: "นักสืบสายสแน็ก", domain.QRRunner: "นักล่าใบเสร็จ",
	}[completion.Role]
	completed := 0
	for _, member := range squad.Members {
		if member.Completed {
			completed++
		}
	}
	title, copy, action := "เก่งมาก ภารกิจสำเร็จแล้ว! 🎉", "บอกเพื่อนในทีมให้ลุยภารกิจที่เหลือ แล้วมาเปิด Crunch Vault ไปด้วยกัน!", "กลับไปดูทีมและชวนเพื่อน"
	if squad.RewardUnlocked {
		title, copy, action = "ทีมคุณครันช์ครบแล้ว! 🎉", "ครบทั้ง 4 ภารกิจแล้ว! รวมพลังสำเร็จ กลับไปรับรางวัลของทีมได้เลย", "กลับไปรับรางวัลของทีม"
	}
	text := func(value, size, color string, bold bool) map[string]any {
		item := map[string]any{"type": "text", "text": value, "size": size, "color": color, "wrap": true}
		if bold {
			item["weight"] = "bold"
		}
		return item
	}
	return map[string]any{
		"type": "flex", "altText": title + " ทีม " + strings.TrimSpace(squad.Name),
		"contents": map[string]any{
			"type":   "bubble",
			"header": map[string]any{"type": "box", "layout": "vertical", "backgroundColor": "#FFD928", "paddingAll": "20px", "contents": []any{text("LAY'S CRUNCH SQUAD", "sm", "#D93B2B", true), text(title, "xl", "#241D16", true)}},
			"body": map[string]any{"type": "box", "layout": "vertical", "spacing": "md", "backgroundColor": "#FFF8DA", "contents": []any{
				text("คุณพิชิตภารกิจ "+mission+" แล้ว", "lg", "#241D16", true),
				text("ทีม "+squad.Name, "md", "#594A3D", true),
				text(fmt.Sprintf("สำเร็จแล้ว %d / 4 ภารกิจ", completed), "md", "#D93B2B", true), text(copy, "sm", "#594A3D", false),
			}},
			"footer": map[string]any{"type": "box", "layout": "vertical", "backgroundColor": "#FFF8DA", "contents": []any{
				map[string]any{"type": "button", "style": "primary", "color": "#D93B2B", "action": map[string]any{"type": "uri", "label": action, "uri": appURL}},
			}},
		},
	}
}
