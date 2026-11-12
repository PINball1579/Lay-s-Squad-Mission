# Analytics event dictionary

Behavioral analytics is stored only after optional analytics consent. Essential operational events may be retained without user-level identifiers or free-form properties so the service can enforce security, integrity, and reward accountability.

| Event | When emitted | Allowed properties |
| --- | --- | --- |
| `liff_opened` | LIFF bootstrap begins | source, device category |
| `authentication_completed` | server session is created | auth mode (`mock`/`line`) |
| `consent_updated` | consent choice is saved | required/optional booleans |
| `squad_created` | creator transaction commits | squad size target |
| `invitation_created` | user explicitly requests share/copy | source |
| `invitation_opened` | invitation route loads | source/UTM values |
| `squad_joined` / `squad_join_failed` | join transaction resolves | safe reason code |
| `role_viewed` / `role_selected` | role UI viewed/claim commits | role code |
| `mission_started` | mission interaction begins | role, content version |
| `mission_step_completed` | configured step completes | step number, non-sensitive choices |
| `mission_failed` | attempt fails | safe reason, question ID |
| `mission_completed` | idempotent completion commits | duration, configured preference answers |
| `squad_completed` | fourth unique role completes | elapsed seconds |
| `reward_unlocked` / `reward_viewed` / `reward_redeemed` | reward transition commits | reward type, never coupon secret |
| `share_initiated` / `share_completed` | explicit share action starts/resolves | share surface, result |
| `survey_completed` | optional survey submits | rating and configured answers |

Every stored event receives a server-generated event ID and timestamp. Campaign, session, squad, role, mission, source, device category, and consent state are attached from trusted server/session context where relevant. Prohibited properties include raw LINE tokens, access tokens, full LINE profiles, QR signing material, coupon codes, secrets, free-form sensitive data, and inferred sensitive traits.

Dashboard language must describe observed selections and completion behavior. It must not label flavor or creative choices as purchase intent.

