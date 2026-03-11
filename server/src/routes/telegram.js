import { Router } from "express";
import jwt from "jsonwebtoken";
import { supabase } from "../db/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createLivenessSession,
  getLivenessResult,
} from "../lib/rekognition.js";
import {
  sendMessage,
  editMessage,
  answerCallbackQuery,
  getActiveSession,
  createSession,
  endSession,
  upsertParticipant,
  issueParticipantAuthCode,
  getSessionParticipants,
  renderStatusMessage,
  getStatusKeyboard,
  getTelegramReauthMinutes,
} from "../lib/telegram.js";

const router = Router();
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const MIN_REAUTH_MINUTES = 5;
const MAX_REAUTH_MINUTES = 60;

// ── Webhook ──────────────────────────────────────────────────────────────────

router.post("/webhook", async (req, res) => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (
    process.env.TELEGRAM_WEBHOOK_SECRET &&
    secret !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return res.status(401).end();
  }

  const { message, callback_query } = req.body;

  try {
    if (message) await handleMessage(message);
    if (callback_query) await handleCallbackQuery(callback_query);
  } catch (err) {
    console.error("Telegram webhook error:", err);
  }

  res.sendStatus(200);
});

async function handleMessage(msg) {
  const { chat, from, text, entities } = msg;
  if (!text || !text.startsWith("/")) return;

  const commandEntity = entities?.find((e) => e.type === "bot_command");
  if (!commandEntity) return;

  const fullCommand = text.substring(
    commandEntity.offset,
    commandEntity.offset + commandEntity.length,
  );
  const command = fullCommand.split("@")[0]; // Handle /command@bot_name
  const args = text
    .substring(commandEntity.offset + commandEntity.length)
    .trim();

  // 1. /nai_start [minutes] [meet_code]
  if (command === "/nai_start") {
    let session = await getActiveSession(chat.id);
    if (session) {
      return sendMessage(
        chat.id,
        "⚠️ A session is already active in this chat.",
      );
    }

    let meetCode = null;
    let reauthIntervalMinutes = null;
    const parts = args ? args.split(/\s+/).filter(Boolean) : [];

    if (parts.length > 0 && /^\d+$/.test(parts[0])) {
      const parsedMinutes = Number(parts[0]);
      if (
        !Number.isInteger(parsedMinutes) ||
        parsedMinutes < MIN_REAUTH_MINUTES ||
        parsedMinutes > MAX_REAUTH_MINUTES
      ) {
        return sendMessage(
          chat.id,
          `❌ Reverification time must be between ${MIN_REAUTH_MINUTES} and ${MAX_REAUTH_MINUTES} minutes.\n\nExample: <code>/nai_start 15</code> or <code>/nai_start 15 DAILY</code>`,
        );
      }
      reauthIntervalMinutes = parsedMinutes;
      meetCode = parts.slice(1).join(" ") || null;
    } else {
      meetCode = args || null;
    }

    session = await createSession(
      chat.id,
      null,
      meetCode,
      reauthIntervalMinutes,
    ); // We don't link host_user_id yet for simplicity

    const participants = [];
    const text = renderStatusMessage(session, participants);
    const keyboard = getStatusKeyboard(session);

    const sent = await sendMessage(chat.id, text, { reply_markup: keyboard });

    // Store the status message ID to edit it later
    await supabase
      .from("telegram_verification_sessions")
      .update({ status_message_id: String(sent.message_id) })
      .eq("id", session.id);
  }

  // 2. /nai_end
  if (command === "/nai_end") {
    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, "❌ No active session found.");

    await endSession(session.id);

    const participants = await getSessionParticipants(session.id);
    const text = renderStatusMessage(
      { ...session, status: "ended" },
      participants,
    );

    if (session.status_message_id) {
      await editMessage(chat.id, session.status_message_id, text).catch(
        () => {},
      );
    }

    await sendMessage(chat.id, "🏁 Verification session ended.");
  }

  // 3. /nai_status
  if (command === "/nai_status") {
    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, "❌ No active session found.");

    const participants = await getSessionParticipants(session.id);
    const text = renderStatusMessage(session, participants);
    const keyboard = getStatusKeyboard(session);

    await sendMessage(chat.id, text, { reply_markup: keyboard });
  }

  // 4. /nai_reverify_all
  if (command === "/nai_reverify_all") {
    const session = await getActiveSession(chat.id);
    if (!session) return sendMessage(chat.id, "❌ No active session found.");

    // Mark all current participants as pending
    await supabase
      .from("telegram_session_participants")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("telegram_session_id", session.id);

    await refreshStatusMessage(session);
    await sendMessage(
      chat.id,
      "🔄 All participants have been marked for re-verification.",
    );
  }
}

async function handleCallbackQuery(cb) {
  const { id, from, message, data } = cb;
  const [action, sessionId] = data.split(":");

  if (action === "auth") {
    const participant = await issueParticipantAuthCode(sessionId, from);

    // Fetch session and refresh UI
    const { data: session } = await supabase
      .from("telegram_verification_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (session) await refreshStatusMessage(session);

    await answerCallbackQuery(
      id,
      `Your NAI code is ${participant.auth_code}`,
      false,
    );

    await sendMessage(
      from.id,
      `🔐 <b>NAI Authentication Code</b>\n\nCode: <code>${participant.auth_code}</code>\nExpires in 10 minutes.\n\nOpen the NAI mobile app and paste this code into Telegram Auth.`,
    ).catch(() => {});
  }

  if (action === "refresh") {
    const { data: session } = await supabase
      .from("telegram_verification_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (session) {
      await refreshStatusMessage(session);
      await answerCallbackQuery(id, "Status refreshed.");
    }
  }

  if (action === "reverify_me") {
    await upsertParticipant(sessionId, from, "pending");
    const { data: session } = await supabase
      .from("telegram_verification_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (session) await refreshStatusMessage(session);
    await answerCallbackQuery(id, "You have been marked for re-verification.");
  }
}

async function refreshStatusMessage(session) {
  const participants = await getSessionParticipants(session.id);
  const text = renderStatusMessage(session, participants);
  const keyboard = getStatusKeyboard(session);

  if (session.status_message_id) {
    await editMessage(
      session.telegram_chat_id,
      session.status_message_id,
      text,
      { reply_markup: keyboard },
    ).catch((err) => {
      console.warn("Failed to edit status message:", err.message);
    });
  }
}

// ── Auth Completion (Called by NAI app) ──────────────────────────────────────

function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

async function getParticipantByCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) return { code, participant: null, session: null };

  const { data: participant } = await supabase
    .from("telegram_session_participants")
    .select("*")
    .eq("auth_code", code)
    .maybeSingle();

  if (!participant) return { code, participant: null, session: null };

  const { data: session } = await supabase
    .from("telegram_verification_sessions")
    .select("*")
    .eq("id", participant.telegram_session_id)
    .maybeSingle();

  return { code, participant, session };
}

// POST /telegram/mobile/start-auth
router.post("/mobile/start-auth", requireAuth, async (req, res) => {
  const { code: rawCode } = req.body ?? {};
  const { code, participant, session } = await getParticipantByCode(rawCode);

  if (!CODE_RE.test(code))
    return res.status(400).json({ error: "Enter a valid 4-character code" });
  if (!participant || !session)
    return res.status(404).json({ error: "Code not found" });
  if (session.status !== "active")
    return res.status(409).json({ error: "Telegram session is not active" });
  if (
    !participant.auth_code_expires_at ||
    new Date(participant.auth_code_expires_at).getTime() <= Date.now()
  ) {
    return res
      .status(410)
      .json({ error: "Code expired. Generate a new code from Telegram." });
  }

  return res.json({
    ok: true,
    code,
    sessionId: session.id,
    participantId: participant.id,
    displayName: participant.display_name,
    telegramUsername: participant.telegram_username,
    reauthIntervalMinutes: getTelegramReauthMinutes(session),
  });
});

// POST /telegram/mobile/liveness/start
router.post("/mobile/liveness/start", requireAuth, async (_req, res) => {
  try {
    const livenessSessionId = await createLivenessSession();
    return res.json({ livenessSessionId });
  } catch (err) {
    console.error("[telegram/mobile/liveness/start] error:", err.message);
    return res.status(502).json({ error: "Failed to create liveness session" });
  }
});

// POST /telegram/mobile/complete-auth
router.post("/mobile/complete-auth", requireAuth, async (req, res) => {
  const { code: rawCode, livenessSessionId } = req.body ?? {};
  const { userId } = req.user;
  const { code, participant, session } = await getParticipantByCode(rawCode);

  if (!CODE_RE.test(code))
    return res.status(400).json({ error: "Enter a valid 4-character code" });
  if (!livenessSessionId)
    return res.status(400).json({ error: "Missing livenessSessionId" });
  if (!participant || !session)
    return res.status(404).json({ error: "Code not found" });
  if (session.status !== "active")
    return res.status(409).json({ error: "Telegram session is not active" });
  if (
    !participant.auth_code_expires_at ||
    new Date(participant.auth_code_expires_at).getTime() <= Date.now()
  ) {
    return res
      .status(410)
      .json({ error: "Code expired. Generate a new code from Telegram." });
  }

  const { data: user } = await supabase
    .from("users")
    .select("profile_photo_s3_key")
    .eq("id", userId)
    .single();

  if (!user?.profile_photo_s3_key) {
    return res.status(422).json({
      error: "No reference face photo found. Please complete KYC first.",
    });
  }

  let liveness;
  try {
    liveness = await getLivenessResult(
      livenessSessionId,
      user.profile_photo_s3_key,
    );
  } catch (err) {
    await supabase
      .from("telegram_session_participants")
      .update({
        status: "failed",
        failure_reason: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", participant.id);
    if (session)
      setImmediate(() => refreshStatusMessage(session).catch(console.error));
    return res.status(422).json({ error: err.message });
  }

  if (!liveness.livenessPass || !liveness.faceMatchPassed) {
    await supabase
      .from("telegram_session_participants")
      .update({
        status: "failed",
        failure_reason: "Liveness or face match did not pass",
        updated_at: new Date().toISOString(),
      })
      .eq("id", participant.id);
    if (session)
      setImmediate(() => refreshStatusMessage(session).catch(console.error));
    return res.status(422).json({
      error:
        "Liveness or face match failed. Generate a new code from Telegram and retry.",
    });
  }

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(
    Date.now() + getTelegramReauthMinutes(session) * 60 * 1000,
  ).toISOString();

  const { error: linkErr } = await supabase
    .from("telegram_account_links")
    .upsert(
      {
        telegram_user_id: participant.telegram_user_id,
        telegram_username: participant.telegram_username,
        telegram_chat_id: session.telegram_chat_id,
        nai_user_id: userId,
        linked_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "telegram_user_id" },
    );

  if (linkErr) {
    console.error("[telegram/mobile/complete-auth] link error:", linkErr);
    return res.status(500).json({ error: "Failed to link Telegram account" });
  }

  const { error: partErr } = await supabase
    .from("telegram_session_participants")
    .update({
      nai_user_id: userId,
      status: "verified",
      last_verified_at: nowIso,
      verification_expires_at: expiresAtIso,
      failure_reason: null,
      auth_code: null,
      auth_code_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", participant.id);

  if (partErr) {
    console.error(
      "[telegram/mobile/complete-auth] participant error:",
      partErr,
    );
    return res
      .status(500)
      .json({ error: "Failed to update Telegram participant status" });
  }

  setImmediate(() => refreshStatusMessage(session).catch(console.error));

  return res.json({
    ok: true,
    status: "verified",
    verificationExpiresAt: expiresAtIso,
    reauthIntervalMinutes: getTelegramReauthMinutes(session),
  });
});

// POST /telegram/complete-link
// Used by the web/mobile app after successful NAI authentication to link the TG account.
router.post("/complete-link", requireAuth, async (req, res) => {
  const { token } = req.body;
  const { userId } = req.user;

  if (!token) return res.status(400).json({ error: "Missing linking token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { tgUserId, tgSessionId } = decoded;

    if (!tgUserId)
      return res.status(400).json({ error: "Invalid token payload" });

    // 1. Create or update the link
    const { error: linkErr } = await supabase
      .from("telegram_account_links")
      .upsert(
        {
          telegram_user_id: String(tgUserId),
          nai_user_id: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_user_id" },
      );

    if (linkErr) throw linkErr;

    // 2. If there's a session ID, mark the participant as verified
    if (tgSessionId) {
      const { error: partErr } = await supabase
        .from("telegram_session_participants")
        .update({
          status: "verified",
          nai_user_id: userId,
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("telegram_session_id", tgSessionId)
        .eq("telegram_user_id", String(tgUserId));

      if (partErr) console.error("Error updating participant status:", partErr);

      // 3. Trigger a background refresh of the status message
      const { data: session } = await supabase
        .from("telegram_verification_sessions")
        .select("*")
        .eq("id", tgSessionId)
        .single();
      if (session) {
        setImmediate(() => refreshStatusMessage(session).catch(console.error));
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Account linking failed:", err);
    return res.status(400).json({ error: "Invalid or expired token" });
  }
});

export default router;
