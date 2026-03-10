# NAI Meet Side Panel (MVP)

This app is a **side-panel-only** Google Meet add-on scaffold for the central join flow.

## MVP behavior
- Host starts a meeting session in side panel
- Participants join using NAI mobile app by entering meeting code
- Side panel shows participant verification states (`verified`, `pending`, `expired`, `failed`, `unlinked`)

## Meet SDK status
`src/lib/meetSdk.js` is intentionally defensive and uses:
1. URL query `?meetingCode=`
2. Best-effort Meet SDK probing (placeholder)
3. Fallback random meeting code

## TODO for production
- Wire real Google Meet add-on SDK session context and participant list APIs
- Configure Google Cloud project and Marketplace publish flow
- Serve this app from the configured `MEET_ADDON_BASE_URL`
- Replace token paste UX with proper host auth handoff in add-on context
