# nai2 Project Memory

## Purpose
- NAI is an identity and session-authentication system.
- The codebase currently spans a mobile app, a server, a small web client, a Google Meet side panel, and a Telegram bot integration.
- The main pattern is: establish a user identity once, then reuse that identity in different session contexts.

## Stack
- Mobile: Expo SDK 54, `expo-router`, React Native, NativeWind/Tailwind
- Server: Node.js, Express, Socket.IO
- Database: Supabase Postgres via service-role access on the server
- Storage and biometrics: AWS S3 and Rekognition
- Identity/KYC: Persona
- App auth: JWT
- Strong auth primitives: WebAuthn/passkeys, but not fully enforced everywhere yet

## Major Surfaces
- Mobile app: primary product surface for end users
- Web client: lightweight auth/KYC/enrollment web flow plus liveness page and Telegram handoff page
- Meet side panel: read-only session status UI inside Google Meet
- Telegram bot: group coordination plus account-linking flow
- Discord bot: channel coordination plus mobile short-code session auth

## Repo Map
- Mobile screens: `mobile/app/*.tsx`
- Mobile API client: `mobile/lib/api.ts`
- Server entry: `server/src/index.js`
- Server routes:
  - `server/src/routes/auth.js`
  - `server/src/routes/kyc.js`
  - `server/src/routes/enroll.js`
  - `server/src/routes/mobile.js`
  - `server/src/routes/meet.js`
  - `server/src/routes/telegram.js`
- Server libs:
  - `server/src/lib/persona.js`
  - `server/src/lib/rekognition.js`
  - `server/src/lib/webauthn.js`
  - `server/src/lib/telegram.js`
- Telegram schema: `supabase/migrations/20240105000001_telegram_integration.sql`

## Core User Lifecycle
- Register or log in
- Complete Persona KYC
- Wait for approval or sync fallback
- Complete enrollment and/or activation flow
- Become an active user
- Reuse active identity in session products like Meet or Telegram

## Current Auth and Status Model
- JWT is the normal API auth mechanism
- User statuses seen in the project include:
  - `pending_kyc`
  - `pending_video`
  - `pending_enrollment`
  - `pending_admin`
  - `active`
  - `rejected`
- The web app maps those statuses into the user journey in `client/src/App.jsx`

## KYC Flow
- KYC is powered by Persona
- Main route files:
  - `server/src/routes/kyc.js`
  - `server/src/lib/persona.js`
- The server mounts `express.raw()` specifically for `/kyc/webhook` before JSON parsing so Persona HMAC verification can work
- Persona webhook is the main source of truth for approval events
- There is also a sync fallback route because webhook delivery and payload shape have been unreliable in sandbox
- KYC approval is important because later flows rely on the user already having a trusted identity and a stored profile photo

## Face and Liveness
- Rekognition is used for liveness and face-match style checks
- The project has a web liveness page served from `/liveness`
- The mobile app opens that page in a WebView for Meet authentication
- The current implementation is oriented around creating a liveness session and then checking the result server-side

## Passkeys
- WebAuthn logic exists in `server/src/lib/webauthn.js`
- Passkey enrollment/auth endpoints exist in the project
- Passkeys are not consistently enforced in all session products yet
- Important current gap:
  - Meet has passkey routes but final auth currently bypasses passkey enforcement

## Current Meet Integration

### Product Shape
- Meet is the most complete session-authentication product in the repo
- It has three pieces:
  - mobile host flow
  - mobile participant auth flow
  - read-only Google Meet side panel

### Host Flow
- Host starts in `mobile/app/meet/host.tsx`
- The mobile app:
  - creates a meeting session with `POST /meet/session/start`
  - immediately joins that session as a participant with `POST /meet/join`
  - starts liveness with `POST /meet/session/:sessionId/liveness/start`
  - completes liveness with `POST /meet/session/:sessionId/liveness/complete`
  - marks the host participant verified with `POST /meet/session/:sessionId/complete-auth`
- If host liveness fails, the app ends the meeting session
- Once active, the host gets a meeting code to share

### Participant Flow
- Participant starts in `mobile/app/meet/join.tsx`
- They enter the meeting code from the host
- The app calls `POST /meet/join`
- That inserts or upserts a `meeting_participants` row and forces status back to `pending`
- Then the app navigates to `mobile/app/meet/authenticate.tsx`
- Authentication flow there is:
  - start liveness
  - complete liveness
  - if liveness passes, call `POST /meet/session/:sessionId/complete-auth`
  - participant becomes `verified` with `verification_expires_at`
- If liveness fails, the participant is marked `failed`

### Meet Verification Semantics
- Meet is a real session-auth flow, not just account linking
- A participant is only marked verified after a fresh liveness check
- The session has `reauth_interval_minutes`
- Server computes `verification_expires_at`
- Expired verified participants are converted to `expired` when session status is read
- Host can trigger:
  - verify all
  - reverify one participant
  - end session

### Meet Side Panel
- The Meet side panel lives in `meet/`
- It reads meeting context from the Meet SDK when possible
- It polls `GET /meet/session/status?code=...`
- It is display-oriented, not the place where authentication happens
- It merges NAI participants with unlinked Meet roster entries so the host can see who is present but not verified

### Meet Gaps
- Passkey is not actually enforced in final auth right now
- `server/src/routes/meet.js` contains a dev bypass in `complete-auth`
- Comments in the mobile Meet auth screen also confirm passkey assertion is currently skipped
- So Meet currently means "fresh liveness-based session auth", not "liveness plus passkey"

## Current Telegram Integration

### Product Shape
- Telegram is a bot-driven coordination layer for group verification sessions
- Main files:
  - `server/src/routes/telegram.js`
  - `server/src/lib/telegram.js`
  - `agents/TELEGRAM.md`

### Group Session Flow
- Group admin runs `/nai_start`
- Server creates a `telegram_verification_sessions` row
- Bot posts a status message into the group and stores the Telegram message id
- That status message is edited in place as participants change

### Participant Flow
- User taps `Authenticate` in the Telegram group
- Bot callback handler:
  - upserts them into `telegram_session_participants` as `pending`
  - generates a 4-character auth code
  - stores that code on the participant row with a short expiry
  - answers the Telegram callback with the code and also tries to DM it
- User opens the mobile app and goes to Telegram Auth
- Mobile app posts the code to `POST /telegram/mobile/start-auth`
- Mobile app starts liveness through `POST /telegram/mobile/liveness/start`
- After the liveness WebView finishes, mobile app calls `POST /telegram/mobile/complete-auth`
- That endpoint:
  - verifies the short code is valid and not expired
  - runs fresh liveness/face-match against the user’s KYC profile photo
  - upserts the Telegram account link
  - marks the participant `verified`
  - sets `verification_expires_at`
  - refreshes the Telegram status message

### Telegram Verification Semantics
- Telegram now performs a fresh mobile liveness check before a participant becomes `verified`
- It is closer to the Meet model than before
- It still does not enforce passkey assertion in the Telegram auth flow
- The old web `/auth/telegram` link-completion path still exists, but the intended current path is short code -> mobile app -> liveness -> verify

### Telegram Gaps
- No true per-session biometric re-auth
- No implemented expiry enforcement despite schema support
- DM delivery can fail if the user never started the bot privately
- DM send failures are swallowed, so UX recovery is weak
- `host_user_id` for Telegram sessions is currently not connected to an NAI identity at session start

## Current Discord Integration

### Product Shape
- Discord mirrors the Telegram model, but uses Discord slash commands and button interactions
- Main files:
  - `server/src/routes/discord.js`
  - `server/src/lib/discord.js`
  - `agents/DISCORD.md`

### Session Flow
- In Discord, someone runs `/nai_start`
- Server creates a `discord_verification_sessions` row
- Bot posts a canonical status message in the channel and stores the Discord message id
- Users click **Authenticate**
- Bot replies ephemerally with a 4-character auth code
- User opens the mobile app and goes to **Discord Auth**
- Mobile app validates the code, starts liveness, and completes auth through:
  - `POST /discord/mobile/start-auth`
  - `POST /discord/mobile/liveness/start`
  - `POST /discord/mobile/complete-auth`
- On success:
  - Discord account is linked
  - participant becomes `verified`
  - `verification_expires_at` is set
  - status message is edited in place

### Discord Commands
- `/nai_start`
- `/nai_status`
- `/nai_reverify_all`
- `/nai_end`

### Discord Gaps
- No passkey enforcement in the Discord auth flow
- Discord DMs are not used; code delivery is currently ephemeral in-channel interaction response
- Slash commands must be registered separately with `npm run discord:register`

## Web Client Role
- The web client is small and task-specific
- It currently handles:
  - auth screens
  - KYC/user lifecycle screens
  - liveness page
  - Telegram handoff page at `/auth/telegram`
- It is not the main session-auth product surface; mobile currently is

## Realtime
- Socket.IO is configured in `server/src/index.js`
- Meet uses it to push room updates like participant status changes and session end events
- Telegram does not use Socket.IO; it relies on Telegram message edits

## Important Data/Trust Assumptions
- KYC establishes the trusted identity basis
- Later session auth often depends on the stored KYC profile photo
- Meet assumes a participant is already a logged-in NAI user and then asks for fresh liveness
- Telegram currently assumes that linking a Telegram account to a logged-in NAI account is enough to mark session verification

## Current Reality Summary
- KYC exists and is central
- Liveness exists and is actively used in Meet
- Passkeys exist in code but are not consistently enforced
- Meet is the most complete session-auth flow
- Telegram is functional, but today it behaves more like account linking for group sessions than true fresh authentication

## Known Practical Caveats
- Persona webhook payloads can vary, so KYC sync fallback matters
- Meet auth progress is stored in a single-node in-memory map, so it is not horizontally scalable as-is
- Telegram flow depends on correct bot webhook setup and a reachable public auth base URL
- The liveness flow is tied closely to the server and mobile WebView path
