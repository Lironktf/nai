# nai2 Project Memory

## Stack
- **Mobile**: Expo (SDK 54) + expo-router, React Native, NativeWind/Tailwind
- **Server**: Node.js/Express, Supabase (Postgres), AWS S3 + Rekognition
- **Auth**: JWT (15min expiry), WebAuthn/passkeys (react-native-passkey v3)
- **KYC**: Persona (sandbox), webhook at https://nai.lironkatsif.com/kyc/webhook
- **Tunnel**: Cloudflare named tunnel → nai.lironkatsif.com (permanent)

## Key File Paths
- Mobile app screens: `mobile/app/*.tsx`
- Mobile API client: `mobile/lib/api.ts`
- Server routes: `server/src/routes/mobile.js`, `kyc.js`, `enroll.js`
- WebAuthn logic: `server/src/lib/webauthn.js`
- Persona helpers: `server/src/lib/persona.js`
- Env vars: `.env` at repo root

## Current User Status Flow
```
pending_kyc → (Persona KYC) → pending_video → (face-verify bypass) → active
```
Passkeys are bypassed — see memory/passkey-activation.md for full re-enable steps.

## Active Dev Bypass
After KYC, users go to `/face-verify` screen (not `/passkey`).
`POST /mobile/face/activate-bypass` — Rekognition compare vs KYC photo → status = active.
Blocked in production (NODE_ENV check).

## Known Pending Issues
- `inquiry.approved` webhook: `userId` extraction may still be null for some Persona API versions.
  Added logging: `attrs_keys=...` and full snapshot dump when userId is null.
  Server also has `POST /kyc/sync` which directly queries Persona's API as fallback.
- Supabase migration for `phone` + `user_code` columns not yet applied:
  file: `supabase/migrations/20240106000000_add_phone_and_user_code.sql`

## User Preferences
- No ghost/extra dev buttons in production UI
- Permanent Cloudflare tunnel (not ephemeral URLs)
- Face verify (Rekognition) is the current activation method, passkeys are future

## See Also
- `memory/passkey-activation.md` — full step-by-step to enable WebAuthn passkeys
