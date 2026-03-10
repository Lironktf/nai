import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  sendMessage,
  editMessage,
  answerCallbackQuery,
  getActiveSession,
  createSession,
  endSession,
  upsertParticipant,
  getSessionParticipants,
  renderStatusMessage,
  getStatusKeyboard,
  generateAuthDeepLink,
  isGroupAdmin
} from '../lib/telegram.js';

const router = Router();

// ── Webhook ──────────────────────────────────────────────────────────────────

router.post('/webhook', async (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const { message, callback_query } = req.body;

  try {
    if (message) await handleMessage(message);
    if (callback_query) await handleCallbackQuery(callback_query);
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }

  res.sendStatus(200);
});

async function handleMessage(msg) {
  const { chat, from, text, entities } = msg;
  if (!text || !text.startsWith('/')) return;

  const commandEntity = entities?.find(e => e.type === 'bot_command');
  if (!commandEntity) return;

  const fullCommand = text.substring(commandEntity.offset, commandEntity.offset + commandEntity.length);
  const command = fullCommand.split('@')[0]; // Handle /command@bot_name
  const args = text.substring(commandEntity.offset + commandEntity.length).trim();

  // 1. /nai_start [meet_code]
  if (command === '/nai_start') {
    if (!(await isGroupAdmin(chat.id, from.id))) {
      return sendMessage(chat.id, '❌ Only group admins can start a verification session.');
    }

    let session = await getActiveSession(chat.id);
    if (session) {
      return sendMessage(chat.id, '⚠️ A session is already active in this chat.');
    }

    const meetCode = args || null;
    session = await createSession(chat.id, null, meetCode); // We don't link host_user_id yet for simplicity
    
    const participants = [];
    const text = renderStatusMessage(session, participants);
    const keyboard = getStatusKeyboard(session);
    
    const sent = await sendMessage(chat.id, text, { reply_markup: keyboard });
    
    // Store the status message ID to edit it later
    await supabase
      .from('telegram_verification_sessions')
      .update({ status_message_id: String(sent.message_id) })
      .eq('id', session.id);
  }

  // 2. /nai_end
  if (command === '/nai_end') {
    if (!(await isGroupAdmin(chat.id, from.id))) {
      return sendMessage(chat.id, '❌ Only group admins can end the session.');
    }

    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, '❌ No active session found.');

    await endSession(session.id);
    
    const participants = await getSessionParticipants(session.id);
    const text = renderStatusMessage({ ...session, status: 'ended' }, participants);
    
    if (session.status_message_id) {
      await editMessage(chat.id, session.status_message_id, text).catch(() => {});
    }
    
    await sendMessage(chat.id, '🏁 Verification session ended.');
  }

  // 3. /nai_status
  if (command === '/nai_status') {
    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, '❌ No active session found.');

    const participants = await getSessionParticipants(session.id);
    const text = renderStatusMessage(session, participants);
    const keyboard = getStatusKeyboard(session);
    
    await sendMessage(chat.id, text, { reply_markup: keyboard });
  }

  // 4. /nai_reverify_all
  if (command === '/nai_reverify_all') {
    if (!(await isGroupAdmin(chat.id, from.id))) {
      return sendMessage(chat.id, '❌ Only group admins can trigger a full re-verification.');
    }

    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, '❌ No active session found.');

    // Mark all current participants as pending
    await supabase
      .from('telegram_session_participants')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('telegram_session_id', session.id);

    await refreshStatusMessage(session);
    await sendMessage(chat.id, '🔄 All participants have been marked for re-verification.');
  }
}

async function handleCallbackQuery(cb) {
  const { id, from, message, data } = cb;
  const [action, sessionId] = data.split(':');

  if (action === 'auth') {
    // Check if user is already linked
    const { data: link } = await supabase
      .from('telegram_account_links')
      .select('nai_user_id')
      .eq('telegram_user_id', String(from.id))
      .maybeSingle();

    if (link) {
      // Already linked! Mark as verified in this session if they were already active in NAI
      // For MVP, we'll just send them to auth anyway to ensure they have a fresh session
      // but later we can optimize this.
    }

    // Add them to the session participants list as 'pending'
    await upsertParticipant(sessionId, from, 'pending');
    
    // Fetch session and refresh UI
    const { data: session } = await supabase.from('telegram_verification_sessions').select('*').eq('id', sessionId).single();
    if (session) await refreshStatusMessage(session);

    const url = generateAuthDeepLink(from.id, sessionId);
    await answerCallbackQuery(id, 'Check your PM for the authentication link.', false);
    
    // Send deep link in private message
    await sendMessage(from.id, `🔐 <b>Identity Verification</b>\n\nTap the button below to verify your identity for the group session.`, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Verify with TrustHandshake', url }]]
      }
    }).catch(() => {
      // If user hasn't started the bot privately, we can't message them.
      // In a real app, we might tell them to /start the bot first.
    });
  }

  if (action === 'refresh') {
    const { data: session } = await supabase.from('telegram_verification_sessions').select('*').eq('id', sessionId).single();
    if (session) {
      await refreshStatusMessage(session);
      await answerCallbackQuery(id, 'Status refreshed.');
    }
  }

  if (action === 'reverify_me') {
    await upsertParticipant(sessionId, from, 'pending');
    const { data: session } = await supabase.from('telegram_verification_sessions').select('*').eq('id', sessionId).single();
    if (session) await refreshStatusMessage(session);
    await answerCallbackQuery(id, 'You have been marked for re-verification.');
  }
}

async function refreshStatusMessage(session) {
  const participants = await getSessionParticipants(session.id);
  const text = renderStatusMessage(session, participants);
  const keyboard = getStatusKeyboard(session);
  
  if (session.status_message_id) {
    await editMessage(session.telegram_chat_id, session.status_message_id, text, { reply_markup: keyboard }).catch(err => {
      console.warn('Failed to edit status message:', err.message);
    });
  }
}

// ── Auth Completion (Called by NAI app) ──────────────────────────────────────

// POST /telegram/complete-link
// Used by the web/mobile app after successful NAI authentication to link the TG account.
router.post('/complete-link', requireAuth, async (req, res) => {
  const { token } = req.body;
  const { userId } = req.user;

  if (!token) return res.status(400).json({ error: 'Missing linking token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { tgUserId, tgSessionId } = decoded;

    if (!tgUserId) return res.status(400).json({ error: 'Invalid token payload' });

    // 1. Create or update the link
    const { error: linkErr } = await supabase
      .from('telegram_account_links')
      .upsert({
        telegram_user_id: String(tgUserId),
        nai_user_id: userId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'telegram_user_id' });

    if (linkErr) throw linkErr;

    // 2. If there's a session ID, mark the participant as verified
    if (tgSessionId) {
      const { error: partErr } = await supabase
        .from('telegram_session_participants')
        .update({
          status: 'verified',
          nai_user_id: userId,
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('telegram_session_id', tgSessionId)
        .eq('telegram_user_id', String(tgUserId));

      if (partErr) console.error('Error updating participant status:', partErr);

      // 3. Trigger a background refresh of the status message
      const { data: session } = await supabase.from('telegram_verification_sessions').select('*').eq('id', tgSessionId).single();
      if (session) {
        setImmediate(() => refreshStatusMessage(session).catch(console.error));
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Account linking failed:', err);
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
});

export default router;
