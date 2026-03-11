import { supabase } from "../db/supabase.js";
import { signToken } from "./jwt.js";

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const DEFAULT_REAUTH_MINUTES = 10;
const AUTH_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AUTH_CODE_LENGTH = 4;
const AUTH_CODE_TTL_MINUTES = 10;

// ── Telegram API Helpers ─────────────────────────────────────────────────────

async function apiCall(method, body = {}) {
  const res = await fetch(`${TELEGRAM_API_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API error (${method}):`, data.description);
    throw new Error(data.description);
  }
  return data.result;
}

export const sendMessage = (chatId, text, options = {}) =>
  apiCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...options,
  });

export const editMessage = (chatId, messageId, text, options = {}) =>
  apiCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...options,
  });

export const answerCallbackQuery = (callbackQueryId, text, showAlert = false) =>
  apiCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });

// ── Session Management ───────────────────────────────────────────────────────

export async function getActiveSession(chatId) {
  const { data } = await supabase
    .from("telegram_verification_sessions")
    .select("*")
    .eq("telegram_chat_id", String(chatId))
    .eq("status", "active")
    .maybeSingle();
  return data;
}

export async function createSession(
  chatId,
  hostUserId,
  meetCode = null,
  reauthIntervalMinutes = null,
) {
  const { data, error } = await supabase
    .from("telegram_verification_sessions")
    .insert({
      telegram_chat_id: String(chatId),
      host_user_id: hostUserId,
      meet_code: meetCode,
      reauth_interval_minutes: reauthIntervalMinutes,
      status: "active",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function endSession(sessionId) {
  await supabase
    .from("telegram_verification_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// ── Participant Logic ────────────────────────────────────────────────────────

export async function upsertParticipant(sessionId, tgUser, status = "pending") {
  const { data: existing } = await supabase
    .from("telegram_session_participants")
    .select("id, status, nai_user_id")
    .eq("telegram_session_id", sessionId)
    .eq("telegram_user_id", String(tgUser.id))
    .maybeSingle();

  // If already verified, don't downgrade to pending unless forced
  if (existing?.status === "verified" && status === "pending") {
    return existing;
  }

  const { data, error } = await supabase
    .from("telegram_session_participants")
    .upsert(
      {
        telegram_session_id: sessionId,
        telegram_user_id: String(tgUser.id),
        telegram_username: tgUser.username,
        display_name:
          tgUser.first_name + (tgUser.last_name ? ` ${tgUser.last_name}` : ""),
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_session_id,telegram_user_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSessionParticipants(sessionId) {
  const { data } = await supabase
    .from("telegram_session_participants")
    .select("*")
    .eq("telegram_session_id", sessionId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

function randomAuthCode() {
  return Array.from(
    { length: AUTH_CODE_LENGTH },
    () => AUTH_CODE_CHARS[Math.floor(Math.random() * AUTH_CODE_CHARS.length)],
  ).join("");
}

export async function issueParticipantAuthCode(sessionId, tgUser) {
  const participant = await upsertParticipant(sessionId, tgUser, "pending");

  for (let attempt = 0; attempt < 10; attempt++) {
    const authCode = randomAuthCode();
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(
      Date.now() + AUTH_CODE_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from("telegram_session_participants")
      .update({
        auth_code: authCode,
        auth_code_issued_at: nowIso,
        auth_code_expires_at: expiresAtIso,
        status: "pending",
        failure_reason: null,
        updated_at: nowIso,
      })
      .eq("id", participant.id)
      .select("*")
      .single();

    if (!error) return data;
    if (error.code !== "23505") throw error;
  }

  throw new Error("Failed to issue Telegram auth code");
}

// ── Status Message Rendering ─────────────────────────────────────────────────

export function renderStatusMessage(session, participants) {
  const title =
    session.status === "active"
      ? "🛡 <b>NAI Verification Session</b>"
      : "🏁 <b>Session Ended</b>";
  const meet = session.meet_code
    ? `\n\n<b>Meet Code:</b> <code>${session.meet_code}</code>`
    : "";
  const reauth = session.reauth_interval_minutes
    ? `\n<b>Reverify Every:</b> ${session.reauth_interval_minutes} min`
    : "";

  let list = "";
  if (participants.length === 0) {
    list = "\n\n<i>No participants yet. Tap Authenticate to join.</i>";
  } else {
    list =
      "\n\n" +
      participants
        .map((p) => {
          const icon =
            {
              verified: "✅",
              pending: "⏳",
              expired: "⌛️",
              failed: "❌",
              unlinked: "🔗",
            }[p.status] || "❓";
          return `${icon} <b>${p.display_name}</b> (@${p.telegram_username || "unknown"})`;
        })
        .join("\n");
  }

  const footer =
    session.status === "active"
      ? "\n\nTap the button below to verify your identity."
      : "";

  return `${title}${meet}${reauth}${list}${footer}`;
}

export function getStatusKeyboard(session) {
  if (session.status !== "active") return undefined;
  return {
    inline_keyboard: [
      [
        { text: "🔐 Authenticate", callback_data: `auth:${session.id}` },
        { text: "🔄 Refresh", callback_data: `refresh:${session.id}` },
      ],
      [{ text: "🔁 Reverify Me", callback_data: `reverify_me:${session.id}` }],
    ],
  };
}

// ── Auth Handoff ─────────────────────────────────────────────────────────────

export function generateAuthDeepLink(tgUserId, tgSessionId) {
  // Sign a short-lived token containing the TG context.
  // This will be passed to the web/mobile app to link the account.
  const token = signToken({ tgUserId: String(tgUserId), tgSessionId }, "30m");
  const baseUrl =
    process.env.NAI_PUBLIC_AUTH_BASE_URL || process.env.CLIENT_URL;
  return `${baseUrl}/auth/telegram?token=${token}`;
}

export function getTelegramReauthMinutes(session) {
  return session?.reauth_interval_minutes ?? DEFAULT_REAUTH_MINUTES;
}

// ── Admin Check ─────────────────────────────────────────────────────────────

export async function isGroupAdmin(chatId, userId) {
  // Private chats: the user is the admin
  if (chatId > 0) return true;

  try {
    const member = await apiCall("getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    return ["creator", "administrator"].includes(member.status);
  } catch {
    return false;
  }
}
