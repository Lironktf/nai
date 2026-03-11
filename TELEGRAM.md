# NAI Telegram Bot Integration

The Telegram bot acts as a coordination layer for NAI verification sessions in groups. It allows group admins to manage verification rounds and members to verify their identity using the existing TrustHandshake system.

## Setup

### 1. Create a Telegram Bot
1. Message [@BotFather](https://t.me/botfather) on Telegram.
2. Use `/newbot` and follow the instructions to get your **Bot Token**.
3. Use `/setcommands` to add the following commands:
   - `nai_start` - Start a verification session
   - `nai_status` - Show current session status
   - `nai_reverify_all` - Force everyone to re-verify
   - `nai_end` - End the verification session

### 2. Configure Environment Variables
Add these to your `.env` file:
```env
TELEGRAM_BOT_TOKEN=your-token-from-botfather
TELEGRAM_BOT_USERNAME=your_bot_username
TELEGRAM_WEBHOOK_SECRET=a-secure-random-string
TELEGRAM_WEBHOOK_BASE_URL=https://your-public-url.ngrok-free.app
NAI_PUBLIC_AUTH_BASE_URL=https://your-public-url.ngrok-free.app
```

### 3. Set the Webhook
You need to tell Telegram where to send updates. You can do this by visiting:
`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WEBHOOK_BASE_URL>/telegram/webhook&secret_token=<YOUR_WEBHOOK_SECRET>`

### 4. Database Migration
The migration `20240105000000_telegram_integration.sql` should be applied to your Supabase instance.

## Usage

1. Add the bot to a Telegram Group.
2. Make the bot an **Administrator** (so it can edit its own status messages).
3. A group admin runs `/nai_start`.
4. Users tap **Authenticate**. The bot will PM them a secure link.
5. Users click the link, log in to TrustHandshake (if not already), and their account is linked.
6. The status message in the group updates to **✅ Verified**.

## Architecture Notes

- **Shared Engine:** Uses the same `users` and `identity_verifications` tables as the mobile/web apps.
- **Deep Linking:** Uses JWT-signed tokens to safely pass Telegram context to the web auth flow.
- **Bot logic:** Isolated in `server/src/lib/telegram.js` and `server/src/routes/telegram.js`.
- **Atomic Updates:** The bot maintains a single status message per group, editing it as participants join or verify.

## Future Hardening
- **Mini App:** The `/auth/telegram` flow can be moved into a Telegram Mini App for a more seamless "in-bot" experience.
- **Automatic Expiry:** Implement a background job or periodic check to mark sessions as `ended` or participants as `expired` based on `reauth_interval_minutes`.
- **Meet Sync:** Further integrate the `meet_code` to show real-time "who is in the call" vs "who is verified" stats.
