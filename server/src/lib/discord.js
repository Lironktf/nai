import crypto from 'crypto';
import { supabase } from '../db/supabase.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_REAUTH_MINUTES = 10;
const AUTH_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AUTH_CODE_LENGTH = 4;
const AUTH_CODE_TTL_MINUTES = 10;

function getBotToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured');
  return token;
}

async function apiCall(path, options = {}) {
  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${getBotToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[discord api] ${path} failed:`, data);
    throw new Error(data.message || 'Discord API request failed');
  }

  return data;
}

export async function sendChannelMessage(channelId, payload) {
  return apiCall(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function editChannelMessage(channelId, messageId, payload) {
  return apiCall(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getActiveSession(channelId) {
  const { data } = await supabase
    .from('discord_verification_sessions')
    .select('*')
    .eq('discord_channel_id', String(channelId))
    .eq('status', 'active')
    .maybeSingle();

  return data;
}

export async function createSession(channelId, guildId, hostUserId, meetCode = null, reauthIntervalMinutes = null) {
  const { data, error } = await supabase
    .from('discord_verification_sessions')
    .insert({
      discord_channel_id: String(channelId),
      discord_guild_id: guildId ? String(guildId) : null,
      host_user_id: hostUserId,
      meet_code: meetCode,
      reauth_interval_minutes: reauthIntervalMinutes,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function endSession(sessionId) {
  await supabase
    .from('discord_verification_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function upsertParticipant(sessionId, discordUser, member, status = 'pending') {
  const userId = String(discordUser.id);
  const { data: existing } = await supabase
    .from('discord_session_participants')
    .select('id, status, nai_user_id')
    .eq('discord_session_id', sessionId)
    .eq('discord_user_id', userId)
    .maybeSingle();

  if (existing?.status === 'verified' && status === 'pending') {
    return existing;
  }

  const displayName =
    member?.nick ||
    member?.global_name ||
    discordUser.global_name ||
    discordUser.username;

  const { data, error } = await supabase
    .from('discord_session_participants')
    .upsert({
      discord_session_id: sessionId,
      discord_user_id: userId,
      discord_username: discordUser.username,
      display_name: displayName,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'discord_session_id,discord_user_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSessionParticipants(sessionId) {
  const { data } = await supabase
    .from('discord_session_participants')
    .select('*')
    .eq('discord_session_id', sessionId)
    .order('created_at', { ascending: true });

  return data ?? [];
}

function randomAuthCode() {
  return Array.from({ length: AUTH_CODE_LENGTH }, () =>
    AUTH_CODE_CHARS[Math.floor(Math.random() * AUTH_CODE_CHARS.length)]
  ).join('');
}

export async function issueParticipantAuthCode(sessionId, discordUser, member) {
  const participant = await upsertParticipant(sessionId, discordUser, member, 'pending');

  for (let attempt = 0; attempt < 10; attempt++) {
    const authCode = randomAuthCode();
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + AUTH_CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('discord_session_participants')
      .update({
        auth_code: authCode,
        auth_code_issued_at: nowIso,
        auth_code_expires_at: expiresAtIso,
        status: 'pending',
        failure_reason: null,
        updated_at: nowIso,
      })
      .eq('id', participant.id)
      .select('*')
      .single();

    if (!error) return data;
    if (error.code !== '23505') throw error;
  }

  throw new Error('Failed to issue Discord auth code');
}

export function renderStatusMessage(session, participants) {
  const title = session.status === 'active'
    ? '🛡 NAI Verification Session'
    : '🏁 Session Ended';
  const meet = session.meet_code ? `\nMeet Code: ${session.meet_code}` : '';
  const reauth = session.reauth_interval_minutes
    ? `\nReverify Every: ${session.reauth_interval_minutes} min`
    : '';

  let list = '';
  if (!participants.length) {
    list = '\n\nNo participants yet. Click Authenticate to join.';
  } else {
    list = '\n\n' + participants.map((p) => {
      const icon = {
        verified: '✅',
        pending: '⏳',
        expired: '⌛',
        failed: '❌',
        unlinked: '🔗',
      }[p.status] || '❓';
      return `${icon} ${p.display_name || p.discord_username || 'Unknown'} (@${p.discord_username || 'unknown'})`;
    }).join('\n');
  }

  const footer = session.status === 'active'
    ? '\n\nUse the buttons below to authenticate or refresh.'
    : '';

  return `${title}${meet}${reauth}${list}${footer}`;
}

export function getStatusComponents(session) {
  if (session.status !== 'active') return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Authenticate', custom_id: `auth:${session.id}` },
        { type: 2, style: 2, label: 'Refresh', custom_id: `refresh:${session.id}` },
        { type: 2, style: 2, label: 'Reverify Me', custom_id: `reverify_me:${session.id}` },
      ],
    },
  ];
}

export function getDiscordReauthMinutes(session) {
  return session?.reauth_interval_minutes ?? DEFAULT_REAUTH_MINUTES;
}

function ed25519PublicKeyToSpkiDer(publicKeyHex) {
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return Buffer.concat([prefix, publicKey]);
}

export function verifyDiscordSignature(rawBody, signature, timestamp) {
  const publicKeyHex = process.env.DISCORD_APPLICATION_PUBLIC_KEY;
  if (!publicKeyHex) throw new Error('DISCORD_APPLICATION_PUBLIC_KEY is not configured');

  const spkiDer = ed25519PublicKeyToSpkiDer(publicKeyHex);
  const key = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  return crypto.verify(
    null,
    Buffer.concat([Buffer.from(timestamp), rawBody]),
    key,
    Buffer.from(signature, 'hex'),
  );
}
