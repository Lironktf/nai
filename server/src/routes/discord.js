import { Router } from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { createLivenessSession, getLivenessResult } from '../lib/rekognition.js';
import {
  verifyDiscordSignature,
  sendChannelMessage,
  editChannelMessage,
  getActiveSession,
  createSession,
  endSession,
  upsertParticipant,
  issueParticipantAuthCode,
  getSessionParticipants,
  renderStatusMessage,
  getStatusComponents,
  getDiscordReauthMinutes,
} from '../lib/discord.js';

const router = Router();
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const MIN_REAUTH_MINUTES = 5;
const MAX_REAUTH_MINUTES = 60;

function jsonResponse(res, body) {
  return res.status(200).json(body);
}

function interactionMessage(content, { ephemeral = false, components = [] } = {}) {
  return {
    type: 4,
    data: {
      content,
      components,
      ...(ephemeral ? { flags: 64 } : {}),
    },
  };
}

async function refreshStatusMessage(session) {
  if (!session?.status_message_id) return;
  const participants = await getSessionParticipants(session.id);
  await editChannelMessage(session.discord_channel_id, session.status_message_id, {
    content: renderStatusMessage(session, participants),
    components: getStatusComponents(session),
  });
}

function parseStartOptions(options = []) {
  const byName = new Map(options.map((opt) => [opt.name, opt.value]));
  const minutes = byName.has('minutes') ? Number(byName.get('minutes')) : null;
  const meetCode = byName.get('meet_code') ?? null;
  return { minutes, meetCode };
}

router.post('/interactions', (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp || !verifyDiscordSignature(rawBody, String(signature), String(timestamp))) {
    return res.status(401).send('invalid request signature');
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid Discord payload' });
  }

  handleInteraction(interaction, res).catch((err) => {
    console.error('[discord interactions] error:', err);
    jsonResponse(res, interactionMessage('Discord bot error.', { ephemeral: true }));
  });
});

async function handleInteraction(interaction, res) {
  if (interaction.type === 1) {
    return jsonResponse(res, { type: 1 });
  }

  if (interaction.type === 2) {
    return handleApplicationCommand(interaction, res);
  }

  if (interaction.type === 3) {
    return handleComponentInteraction(interaction, res);
  }

  return jsonResponse(res, interactionMessage('Unsupported Discord interaction.', { ephemeral: true }));
}

async function handleApplicationCommand(interaction, res) {
  const { data, channel_id: channelId, guild_id: guildId, member } = interaction;
  const command = data?.name;

  if (command === 'nai_start') {
    let session = await getActiveSession(channelId);
    if (session) {
      return jsonResponse(res, interactionMessage('A session is already active in this channel.', { ephemeral: true }));
    }

    const { minutes, meetCode } = parseStartOptions(data.options ?? []);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < MIN_REAUTH_MINUTES || minutes > MAX_REAUTH_MINUTES)) {
      return jsonResponse(
        res,
        interactionMessage(`Reverification time must be between ${MIN_REAUTH_MINUTES} and ${MAX_REAUTH_MINUTES} minutes.`, { ephemeral: true }),
      );
    }

    session = await createSession(channelId, guildId, null, meetCode, minutes);
    const statusMessage = await sendChannelMessage(channelId, {
      content: renderStatusMessage(session, []),
      components: getStatusComponents(session),
    });

    await supabase
      .from('discord_verification_sessions')
      .update({ status_message_id: String(statusMessage.id) })
      .eq('id', session.id);

    return jsonResponse(res, interactionMessage('NAI verification session started.', { ephemeral: true }));
  }

  if (command === 'nai_status') {
    const session = await getActiveSession(channelId);
    if (!session) {
      return jsonResponse(res, interactionMessage('No active session found in this channel.', { ephemeral: true }));
    }

    await refreshStatusMessage(session);
    return jsonResponse(res, interactionMessage('Session status refreshed.', { ephemeral: true }));
  }

  if (command === 'nai_reverify_all') {
    const session = await getActiveSession(channelId);
    if (!session) {
      return jsonResponse(res, interactionMessage('No active session found in this channel.', { ephemeral: true }));
    }

    await supabase
      .from('discord_session_participants')
      .update({
        status: 'pending',
        last_verified_at: null,
        verification_expires_at: null,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('discord_session_id', session.id);

    await refreshStatusMessage(session);
    return jsonResponse(res, interactionMessage('All participants have been marked for re-verification.', { ephemeral: true }));
  }

  if (command === 'nai_end') {
    const session = await getActiveSession(channelId);
    if (!session) {
      return jsonResponse(res, interactionMessage('No active session found in this channel.', { ephemeral: true }));
    }

    await endSession(session.id);
    await refreshStatusMessage({ ...session, status: 'ended' });
    return jsonResponse(res, interactionMessage('NAI verification session ended.', { ephemeral: true }));
  }

  return jsonResponse(res, interactionMessage(`Unknown command: ${command}`, { ephemeral: true }));
}

async function handleComponentInteraction(interaction, res) {
  const [action, sessionId] = String(interaction.data?.custom_id || '').split(':');
  const discordUser = interaction.member?.user ?? interaction.user;
  const member = interaction.member;

  if (action === 'auth') {
    const participant = await issueParticipantAuthCode(sessionId, discordUser, member);
    const { data: session } = await supabase
      .from('discord_verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (session) await refreshStatusMessage(session);
    return jsonResponse(
      res,
      interactionMessage(
        `Your NAI code is \`${participant.auth_code}\`.\nOpen the NAI mobile app, tap Discord Auth, and paste this code within 10 minutes.`,
        { ephemeral: true },
      ),
    );
  }

  if (action === 'refresh') {
    const { data: session } = await supabase
      .from('discord_verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (session) await refreshStatusMessage(session);
    return jsonResponse(res, interactionMessage('Status refreshed.', { ephemeral: true }));
  }

  if (action === 'reverify_me') {
    await upsertParticipant(sessionId, discordUser, member, 'pending');
    const { data: session } = await supabase
      .from('discord_verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (session) await refreshStatusMessage(session);
    return jsonResponse(res, interactionMessage('You have been marked for re-verification.', { ephemeral: true }));
  }

  return jsonResponse(res, interactionMessage('Unknown action.', { ephemeral: true }));
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

async function getParticipantByCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) return { code, participant: null, session: null };

  const { data: participant } = await supabase
    .from('discord_session_participants')
    .select('*')
    .eq('auth_code', code)
    .maybeSingle();

  if (!participant) return { code, participant: null, session: null };

  const { data: session } = await supabase
    .from('discord_verification_sessions')
    .select('*')
    .eq('id', participant.discord_session_id)
    .maybeSingle();

  return { code, participant, session };
}

router.post('/mobile/start-auth', requireAuth, async (req, res) => {
  const { code: rawCode } = req.body ?? {};
  const { code, participant, session } = await getParticipantByCode(rawCode);

  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Enter a valid 4-character code' });
  if (!participant || !session) return res.status(404).json({ error: 'Code not found' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Discord session is not active' });
  if (!participant.auth_code_expires_at || new Date(participant.auth_code_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'Code expired. Generate a new code from Discord.' });
  }

  return res.json({
    ok: true,
    code,
    sessionId: session.id,
    participantId: participant.id,
    displayName: participant.display_name,
    discordUsername: participant.discord_username,
    reauthIntervalMinutes: getDiscordReauthMinutes(session),
  });
});

router.post('/mobile/liveness/start', requireAuth, async (_req, res) => {
  try {
    const livenessSessionId = await createLivenessSession();
    return res.json({ livenessSessionId });
  } catch (err) {
    console.error('[discord/mobile/liveness/start] error:', err.message);
    return res.status(502).json({ error: 'Failed to create liveness session' });
  }
});

router.post('/mobile/complete-auth', requireAuth, async (req, res) => {
  const { code: rawCode, livenessSessionId } = req.body ?? {};
  const { userId } = req.user;
  const { code, participant, session } = await getParticipantByCode(rawCode);

  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Enter a valid 4-character code' });
  if (!livenessSessionId) return res.status(400).json({ error: 'Missing livenessSessionId' });
  if (!participant || !session) return res.status(404).json({ error: 'Code not found' });
  if (session.status !== 'active') return res.status(409).json({ error: 'Discord session is not active' });
  if (!participant.auth_code_expires_at || new Date(participant.auth_code_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'Code expired. Generate a new code from Discord.' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('profile_photo_s3_key')
    .eq('id', userId)
    .single();

  if (!user?.profile_photo_s3_key) {
    return res.status(422).json({ error: 'No reference face photo found. Please complete KYC first.' });
  }

  let liveness;
  try {
    liveness = await getLivenessResult(livenessSessionId, user.profile_photo_s3_key);
  } catch (err) {
    await supabase
      .from('discord_session_participants')
      .update({
        status: 'failed',
        failure_reason: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', participant.id);
    if (session) setImmediate(() => refreshStatusMessage(session).catch(console.error));
    return res.status(422).json({ error: err.message });
  }

  if (!liveness.livenessPass || !liveness.faceMatchPassed) {
    await supabase
      .from('discord_session_participants')
      .update({
        status: 'failed',
        failure_reason: 'Liveness or face match did not pass',
        updated_at: new Date().toISOString(),
      })
      .eq('id', participant.id);
    if (session) setImmediate(() => refreshStatusMessage(session).catch(console.error));
    return res.status(422).json({ error: 'Liveness or face match failed. Generate a new code from Discord and retry.' });
  }

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + getDiscordReauthMinutes(session) * 60 * 1000).toISOString();

  const { error: linkErr } = await supabase
    .from('discord_account_links')
    .upsert({
      discord_user_id: participant.discord_user_id,
      discord_username: participant.discord_username,
      discord_channel_id: session.discord_channel_id,
      discord_guild_id: session.discord_guild_id,
      nai_user_id: userId,
      linked_at: nowIso,
      updated_at: nowIso,
    }, { onConflict: 'discord_user_id' });

  if (linkErr) {
    console.error('[discord/mobile/complete-auth] link error:', linkErr);
    return res.status(500).json({ error: 'Failed to link Discord account' });
  }

  const { error: partErr } = await supabase
    .from('discord_session_participants')
    .update({
      nai_user_id: userId,
      status: 'verified',
      last_verified_at: nowIso,
      verification_expires_at: expiresAtIso,
      failure_reason: null,
      auth_code: null,
      auth_code_expires_at: null,
      updated_at: nowIso,
    })
    .eq('id', participant.id);

  if (partErr) {
    console.error('[discord/mobile/complete-auth] participant error:', partErr);
    return res.status(500).json({ error: 'Failed to update Discord participant status' });
  }

  setImmediate(() => refreshStatusMessage(session).catch(console.error));

  return res.json({
    ok: true,
    status: 'verified',
    verificationExpiresAt: expiresAtIso,
    reauthIntervalMinutes: getDiscordReauthMinutes(session),
  });
});

export default router;
