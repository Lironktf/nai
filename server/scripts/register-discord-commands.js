const DISCORD_API_BASE = 'https://discord.com/api/v10';

const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken) {
  console.error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
  process.exit(1);
}

const commands = [
  {
    name: 'nai_start',
    description: 'Start a NAI verification session',
    options: [
      {
        type: 4,
        name: 'minutes',
        description: 'Reverification interval in minutes (5-60)',
        required: false,
        min_value: 5,
        max_value: 60,
      },
      {
        type: 3,
        name: 'meet_code',
        description: 'Optional meet code label',
        required: false,
      },
    ],
  },
  {
    name: 'nai_status',
    description: 'Refresh the current NAI verification session status',
  },
  {
    name: 'nai_reverify_all',
    description: 'Mark everyone in this NAI session for re-verification',
  },
  {
    name: 'nai_end',
    description: 'End the current NAI verification session',
  },
];

const path = guildId
  ? `/applications/${appId}/guilds/${guildId}/commands`
  : `/applications/${appId}/commands`;

const res = await fetch(`${DISCORD_API_BASE}${path}`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('Failed to register Discord commands:', data);
  process.exit(1);
}

console.log(`Registered ${commands.length} Discord commands${guildId ? ` for guild ${guildId}` : ''}.`);
