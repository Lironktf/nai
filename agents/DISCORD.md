# NAI Discord Bot Integration

The Discord bot mirrors the Telegram bot flow: start a verification session in a Discord channel, let users request a short auth code, and finish real verification in the NAI mobile app.

## Setup

### 1. Create the Discord Application and Bot
1. Create an application in the Discord Developer Portal.
2. Add a bot user.
3. Copy:
   - Bot token
   - Application ID
   - Public key
4. Put them in `.env`:
```env
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_APPLICATION_ID=your-discord-application-id
DISCORD_APPLICATION_PUBLIC_KEY=your-discord-application-public-key
DISCORD_GUILD_ID=optional-dev-guild-id
```

### 2. Configure the Interaction Endpoint
Set the Discord interactions endpoint URL to:
```text
https://your-public-domain/discord/interactions
```

### 3. Apply Migrations
Apply:
- `20240105000001_telegram_integration.sql`
- `20240107000000_telegram_auth_codes.sql`
- `20240108000000_discord_integration.sql`

### 4. Register Slash Commands
Run:
```bash
cd server
npm run discord:register
```

If `DISCORD_GUILD_ID` is set, commands register into that guild for faster propagation. Otherwise they register globally.

## Commands
- `/nai_start`
- `/nai_start minutes:15`
- `/nai_start minutes:15 meet_code:DAILY`
- `/nai_status`
- `/nai_reverify_all`
- `/nai_end`

## Usage
1. Add the bot to a Discord server.
2. In a channel, run `/nai_start`.
3. Users click **Authenticate**.
4. The bot replies ephemerally with a 4-character code.
5. Users open the mobile app, go to **Discord Auth**, and paste the code.
6. The mobile app runs liveness / face match against the user’s KYC photo.
7. The Discord session status updates to **✅ verified**.
