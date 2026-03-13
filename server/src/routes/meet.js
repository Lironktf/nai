import { Router } from "express";
import { z } from "zod";

import { supabase } from "../db/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { io } from "../index.js";
import {
  createLivenessSession,
  getLivenessResult,
} from "../lib/rekognition.js";
import {
  generateAuthChallenge,
  verifyAuthChallenge,
  MOBILE_ORIGIN,
} from "../lib/webauthn.js";

const router = Router();

const DEFAULT_REAUTH_MINUTES = 10;
const MIN_REAUTH_MINUTES = 5;
const MAX_REAUTH_MINUTES = 60;

// Single-node in-memory auth progress for meeting auth state.
// Key: `${sessionId}:${userId}`
const meetingAuthProgress = new Map();

const startSessionSchema = z.object({
  meetingCode: z.string().min(3).max(64),
  reauthIntervalMinutes: z
    .number()
    .int()
    .min(MIN_REAUTH_MINUTES)
    .max(MAX_REAUTH_MINUTES)
    .optional(),
});

const joinSchema = z.object({
  meetingCode: z.string().min(3).max(64),
  displayName: z.string().min(1).max(120).optional(),
});

const completeAuthSchema = z.object({
  status: z.enum(["verified", "failed"]).default("verified"),
  failureReason: z.string().min(1).max(240).optional(),
});

const reverifySchema = z.object({
  reason: z.string().min(1).max(240).optional(),
});

const passkeyCompleteSchema = z.object({
  assertionResponse: z.any(),
});

const livenessCompleteSchema = z.object({
  livenessSessionId: z.string().min(1),
});

function canonicalMeetingCode(raw) {
  return raw.trim().replace(/\s+/g, "-").toUpperCase();
}

function authProgressKey(sessionId, userId) {
  return `${sessionId}:${userId}`;
}

function toIsoWithMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function ensureHostAccess(sessionId, userId) {
  const { data: session } = await supabase
    .from("meeting_sessions")
    .select(
      "id, host_user_id, status, meeting_code, reauth_interval_minutes, started_at, ended_at",
    )
    .eq("id", sessionId)
    .single();

  if (!session) return { error: { status: 404, message: "Session not found" } };
  if (session.host_user_id !== userId)
    return { error: { status: 403, message: "Host access required" } };
  return { session };
}

async function ensureParticipantAccess(sessionId, userId) {
  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("id, status, meeting_code, host_user_id, reauth_interval_minutes")
    .eq("id", sessionId)
    .single();

  if (!session) return { error: { status: 404, message: "Session not found" } };
  if (session.status !== "active") {
    return { error: { status: 409, message: "Meeting session is not active" } };
  }

  const { data: participant } = await supabase
    .from("meeting_participants")
    .select("id, status, verification_expires_at")
    .eq("meeting_session_id", sessionId)
    .eq("nai_user_id", userId)
    .maybeSingle();

  if (!participant) {
    return {
      error: { status: 403, message: "Join the meeting session first" },
    };
  }

  return { session, participant };
}

async function emitMeetingEvent(sessionId, eventType, payload = {}) {
  io.to(`meeting:${sessionId}`).emit(eventType, payload);
}

async function recordMeetingEvent({
  sessionId,
  participantId = null,
  eventType,
  metadata = {},
}) {
  await supabase.from("meeting_verification_events").insert({
    meeting_session_id: sessionId,
    meeting_participant_id: participantId,
    event_type: eventType,
    metadata,
  });
}

async function expireStaleVerifiedParticipants(sessionId) {
  await supabase
    .from("meeting_participants")
    .update({ status: "expired", failure_reason: null })
    .eq("meeting_session_id", sessionId)
    .eq("status", "verified")
    .lt("verification_expires_at", new Date().toISOString());
}

function effectiveStatus(participant) {
  if (
    participant.status === "verified" &&
    participant.verification_expires_at &&
    new Date(participant.verification_expires_at).getTime() <= Date.now()
  ) {
    return "expired";
  }
  return participant.status;
}

function mapParticipantRow(row) {
  const linkedFullName = row.users?.legal_name ?? null;
  const linkedEmail = row.users?.email ?? null;

  return {
    id: row.id,
    status: effectiveStatus(row),
    displayName: row.display_name,
    linkedUserId: row.nai_user_id,
    linkedFullName,
    linkedEmail,
    identityLabel:
      [row.display_name, linkedFullName ?? linkedEmail]
        .filter(Boolean)
        .join(" | ") || "Unknown",
    lastVerifiedAt: row.last_verified_at,
    verificationExpiresAt: row.verification_expires_at,
    failureReason: row.failure_reason,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

// POST /meet/session/start
router.post("/session/start", requireAuth, async (req, res) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });

  const { userId } = req.user;
  const meetingCode = canonicalMeetingCode(parsed.data.meetingCode);
  const reauthIntervalMinutes =
    parsed.data.reauthIntervalMinutes ?? DEFAULT_REAUTH_MINUTES;

  const { data: existingActive } = await supabase
    .from("meeting_sessions")
    .select("id")
    .eq("meeting_code", meetingCode)
    .eq("status", "active")
    .maybeSingle();

  if (existingActive) {
    return res.status(409).json({
      error: "An active session already exists for this meeting code",
      sessionId: existingActive.id,
    });
  }

  const { data: session, error } = await supabase
    .from("meeting_sessions")
    .insert({
      meeting_code: meetingCode,
      host_user_id: userId,
      status: "active",
      reauth_interval_minutes: reauthIntervalMinutes,
      started_at: new Date().toISOString(),
    })
    .select(
      "id, meeting_code, host_user_id, status, reauth_interval_minutes, started_at, ended_at, created_at, updated_at",
    )
    .single();

  if (error || !session) {
    console.error("[meet/session/start] insert error:", error);
    return res.status(500).json({ error: "Failed to create meeting session" });
  }

  await recordMeetingEvent({
    sessionId: session.id,
    eventType: "SESSION_STARTED",
    metadata: { meetingCode, hostUserId: userId, reauthIntervalMinutes },
  });

  return res.status(201).json({
    sessionId: session.id,
    meetingCode: session.meeting_code,
    status: session.status,
    reauthIntervalMinutes: session.reauth_interval_minutes,
    startedAt: session.started_at,
  });
});

// GET /meet/session/status?code=XXX  (no auth — read-only for side panel display)
// Returns active session + participant verification states for a given meeting code.
router.get("/session/status", async (req, res) => {
  try {
    const code = canonicalMeetingCode(String(req.query.code || ""));
    if (!code || code.length < 3)
      return res.status(400).json({ error: "Missing or invalid code" });

    const { data: session, error: sessionError } = await supabase
      .from("meeting_sessions")
      .select("id, meeting_code, status, reauth_interval_minutes")
      .eq("meeting_code", code)
      .eq("status", "active")
      .maybeSingle();

    if (sessionError) {
      console.error(
        "[meet/session/status] session lookup error:",
        sessionError,
      );
      return res.status(500).json({ error: "Failed to load meeting session" });
    }

    if (!session)
      return res
        .status(404)
        .json({ error: "No active session found for this code" });

    await expireStaleVerifiedParticipants(session.id);

    const { data: participantRows, error: participantsError } = await supabase
      .from("meeting_participants")
      .select(
        "id, display_name, status, last_verified_at, verification_expires_at, failure_reason, nai_user_id, joined_at, updated_at",
      )
      .eq("meeting_session_id", session.id)
      .order("updated_at", { ascending: false });

    if (participantsError) {
      console.error(
        "[meet/session/status] participant lookup error:",
        participantsError,
      );
      return res
        .status(500)
        .json({ error: "Failed to load meeting participants" });
    }

    const linkedUserIds = [
      ...new Set(
        (participantRows ?? []).map((row) => row.nai_user_id).filter(Boolean),
      ),
    ];
    let usersById = new Map();

    if (linkedUserIds.length) {
      const { data: linkedUsers, error: usersError } = await supabase
        .from("users")
        .select("id, legal_name, email")
        .in("id", linkedUserIds);

      if (usersError) {
        console.error(
          "[meet/session/status] linked user lookup error:",
          usersError,
        );
        return res.status(500).json({ error: "Failed to load linked users" });
      }

      usersById = new Map((linkedUsers ?? []).map((user) => [user.id, user]));
    }

    const participants = (participantRows ?? []).map((row) =>
      mapParticipantRow({
        ...row,
        users: row.nai_user_id
          ? (usersById.get(row.nai_user_id) ?? null)
          : null,
      }),
    );

    return res.json({
      sessionId: session.id,
      meetingCode: session.meeting_code,
      status: session.status,
      reauthIntervalMinutes: session.reauth_interval_minutes,
      participants,
    });
  } catch (error) {
    console.error("[meet/session/status] unexpected error:", error);
    return res.status(500).json({ error: "Failed to load meeting status" });
  }
});

// GET /meet/session/by-code?code=XXX
// Find the active session for a given meeting code (host only).
router.get("/session/by-code", requireAuth, async (req, res) => {
  const code = canonicalMeetingCode(String(req.query.code || ""));
  if (!code || code.length < 3)
    return res.status(400).json({ error: "Missing or invalid code" });

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select(
      "id, meeting_code, host_user_id, status, reauth_interval_minutes, started_at, ended_at",
    )
    .eq("meeting_code", code)
    .eq("status", "active")
    .eq("host_user_id", req.user.userId)
    .maybeSingle();

  if (!session)
    return res
      .status(404)
      .json({ error: "No active session found for this code" });

  return res.json({
    id: session.id,
    sessionId: session.id,
    meetingCode: session.meeting_code,
    status: session.status,
    reauthIntervalMinutes: session.reauth_interval_minutes,
    startedAt: session.started_at,
    endedAt: session.ended_at,
  });
});

// GET /meet/sessions/current
// Active meeting sessions where the user is either the host or a participant.
router.get("/sessions/current", requireAuth, async (req, res) => {
  const { userId } = req.user;

  const { data: hostedSessions, error: hostedError } = await supabase
    .from("meeting_sessions")
    .select(
      "id, meeting_code, status, reauth_interval_minutes, started_at, ended_at, host_user_id",
    )
    .eq("host_user_id", userId)
    .eq("status", "active")
    .order("started_at", { ascending: false });

  if (hostedError) {
    console.error("[meet/sessions/current] hosted lookup error:", hostedError);
    return res
      .status(500)
      .json({ error: "Failed to load active Meet sessions" });
  }

  const { data: participantRows, error: participantError } = await supabase
    .from("meeting_participants")
    .select(
      "meeting_session_id, status, verification_expires_at, last_verified_at, joined_at, display_name",
    )
    .eq("nai_user_id", userId)
    .order("joined_at", { ascending: false });

  if (participantError) {
    console.error(
      "[meet/sessions/current] participant lookup error:",
      participantError,
    );
    return res
      .status(500)
      .json({ error: "Failed to load active Meet sessions" });
  }

  const participantSessionIds = [
    ...new Set(
      (participantRows ?? [])
        .map((row) => row.meeting_session_id)
        .filter(Boolean),
    ),
  ];

  let participantSessions = [];
  if (participantSessionIds.length) {
    const { data, error } = await supabase
      .from("meeting_sessions")
      .select(
        "id, meeting_code, status, reauth_interval_minutes, started_at, ended_at, host_user_id",
      )
      .in("id", participantSessionIds)
      .eq("status", "active");

    if (error) {
      console.error(
        "[meet/sessions/current] participant session lookup error:",
        error,
      );
      return res
        .status(500)
        .json({ error: "Failed to load active Meet sessions" });
    }

    participantSessions = data ?? [];
  }

  const participantBySessionId = new Map(
    (participantRows ?? []).map((row) => [row.meeting_session_id, row]),
  );
  const sessionMap = new Map();

  for (const session of hostedSessions ?? []) {
    sessionMap.set(session.id, {
      sessionId: session.id,
      meetingCode: session.meeting_code,
      sessionStatus: session.status,
      role: "host",
      participantStatus: "verified",
      reauthIntervalMinutes: session.reauth_interval_minutes,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      verificationExpiresAt: null,
      lastVerifiedAt: null,
      displayName: null,
    });
  }

  for (const session of participantSessions) {
    const participant = participantBySessionId.get(session.id);
    if (!participant) continue;
    sessionMap.set(session.id, {
      sessionId: session.id,
      meetingCode: session.meeting_code,
      sessionStatus: session.status,
      role: session.host_user_id === userId ? "host" : "participant",
      participantStatus: effectiveStatus(participant),
      reauthIntervalMinutes: session.reauth_interval_minutes,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      verificationExpiresAt: participant.verification_expires_at,
      lastVerifiedAt: participant.last_verified_at,
      displayName: participant.display_name,
    });
  }

  return res.json(
    [...sessionMap.values()].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    ),
  );
});

// GET /meet/session/:sessionId
router.get("/session/:sessionId", requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
  if (hostAccess.error)
    return res
      .status(hostAccess.error.status)
      .json({ error: hostAccess.error.message });

  const { session } = hostAccess;
  return res.json({
    id: session.id,
    meetingCode: session.meeting_code,
    status: session.status,
    reauthIntervalMinutes: session.reauth_interval_minutes,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    hostUserId: session.host_user_id,
  });
});

// GET /meet/session/:sessionId/participants
router.get(
  "/session/:sessionId/participants",
  requireAuth,
  async (req, res) => {
    const { sessionId } = req.params;
    const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
    if (hostAccess.error)
      return res
        .status(hostAccess.error.status)
        .json({ error: hostAccess.error.message });

    await expireStaleVerifiedParticipants(sessionId);

    const { data: participants, error } = await supabase
      .from("meeting_participants")
      .select(
        `
      id,
      meeting_session_id,
      nai_user_id,
      display_name,
      status,
      last_verified_at,
      verification_expires_at,
      failure_reason,
      joined_at,
      updated_at,
      users (legal_name, email)
    `,
      )
      .eq("meeting_session_id", sessionId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[meet/participants] query error:", error);
      return res.status(500).json({ error: "Failed to load participants" });
    }

    return res.json((participants ?? []).map(mapParticipantRow));
  },
);

// GET /meet/session/:sessionId/events
router.get("/session/:sessionId/events", requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
  if (hostAccess.error)
    return res
      .status(hostAccess.error.status)
      .json({ error: hostAccess.error.message });

  const limit = Math.min(Number(req.query.limit ?? 40), 100);

  const { data: events, error } = await supabase
    .from("meeting_verification_events")
    .select("id, event_type, metadata, created_at, meeting_participant_id")
    .eq("meeting_session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[meet/events] query error:", error);
    return res.status(500).json({ error: "Failed to load events" });
  }

  return res.json(events ?? []);
});

// POST /meet/session/:sessionId/verify-all
router.post("/session/:sessionId/verify-all", requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
  if (hostAccess.error)
    return res
      .status(hostAccess.error.status)
      .json({ error: hostAccess.error.message });

  const { error } = await supabase
    .from("meeting_participants")
    .update({
      status: "pending",
      last_verified_at: null,
      verification_expires_at: null,
      failure_reason: null,
    })
    .eq("meeting_session_id", sessionId);

  if (error) {
    console.error("[meet/verify-all] update error:", error);
    return res
      .status(500)
      .json({ error: "Failed to mark participants for reverification" });
  }

  await recordMeetingEvent({
    sessionId,
    eventType: "VERIFY_ALL_TRIGGERED",
    metadata: { hostUserId: req.user.userId },
  });

  await emitMeetingEvent(sessionId, "meeting:participants-updated", {
    reason: "verify-all",
  });

  return res.json({ ok: true });
});

// POST /meet/session/:sessionId/participant/:participantId/reverify
router.post(
  "/session/:sessionId/participant/:participantId/reverify",
  requireAuth,
  async (req, res) => {
    const bodyParsed = reverifySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success)
      return res.status(400).json({ error: bodyParsed.error.flatten() });

    const { sessionId, participantId } = req.params;
    const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
    if (hostAccess.error)
      return res
        .status(hostAccess.error.status)
        .json({ error: hostAccess.error.message });

    const { data: updated, error } = await supabase
      .from("meeting_participants")
      .update({
        status: "pending",
        last_verified_at: null,
        verification_expires_at: null,
        failure_reason: null,
      })
      .eq("id", participantId)
      .eq("meeting_session_id", sessionId)
      .select("id")
      .single();

    if (error || !updated) {
      return res
        .status(404)
        .json({ error: "Participant not found in this session" });
    }

    await recordMeetingEvent({
      sessionId,
      participantId,
      eventType: "PARTICIPANT_REVERIFY_TRIGGERED",
      metadata: {
        hostUserId: req.user.userId,
        reason: bodyParsed.data.reason ?? null,
      },
    });

    await emitMeetingEvent(sessionId, "meeting:participants-updated", {
      reason: "participant-reverify",
      participantId,
    });

    return res.json({ ok: true });
  },
);

// POST /meet/session/:sessionId/end
router.post("/session/:sessionId/end", requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
  if (hostAccess.error)
    return res
      .status(hostAccess.error.status)
      .json({ error: hostAccess.error.message });

  const { error } = await supabase
    .from("meeting_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "active");

  if (error) {
    console.error("[meet/end] update error:", error);
    return res.status(500).json({ error: "Failed to end meeting session" });
  }

  await recordMeetingEvent({
    sessionId,
    eventType: "SESSION_ENDED",
    metadata: { hostUserId: req.user.userId },
  });

  await emitMeetingEvent(sessionId, "meeting:ended", { sessionId });

  return res.json({ ok: true });
});

// POST /meet/join
router.post("/join", requireAuth, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });

  const { userId } = req.user;
  const meetingCode = canonicalMeetingCode(parsed.data.meetingCode);

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("id, meeting_code, status, reauth_interval_minutes")
    .eq("meeting_code", meetingCode)
    .eq("status", "active")
    .single();

  if (!session)
    return res
      .status(404)
      .json({ error: "No active meeting session found for this code" });

  // Always allow reauth: joining pushes state back to pending.
  const participantPayload = {
    meeting_session_id: session.id,
    nai_user_id: userId,
    display_name: parsed.data.displayName ?? null,
    status: "pending",
    last_verified_at: null,
    verification_expires_at: null,
    failure_reason: null,
    joined_at: new Date().toISOString(),
  };

  const { data: participant, error } = await supabase
    .from("meeting_participants")
    .upsert(participantPayload, {
      onConflict: "meeting_session_id,nai_user_id",
    })
    .select("id, status, display_name, joined_at")
    .single();

  if (error || !participant) {
    console.error("[meet/join] upsert error:", error);
    return res.status(500).json({ error: "Failed to join meeting session" });
  }

  meetingAuthProgress.delete(authProgressKey(session.id, userId));

  await recordMeetingEvent({
    sessionId: session.id,
    participantId: participant.id,
    eventType: "PARTICIPANT_JOINED",
    metadata: { userId, displayName: parsed.data.displayName ?? null },
  });

  await emitMeetingEvent(session.id, "meeting:participants-updated", {
    reason: "participant-joined",
    participantId: participant.id,
  });

  return res.json({
    sessionId: session.id,
    meetingCode: session.meeting_code,
    participantId: participant.id,
    status: participant.status,
    reauthIntervalMinutes:
      session.reauth_interval_minutes ?? DEFAULT_REAUTH_MINUTES,
  });
});

// POST /meet/session/:sessionId/liveness/start
router.post(
  "/session/:sessionId/liveness/start",
  requireAuth,
  async (req, res) => {
    const { sessionId } = req.params;
    const participantAccess = await ensureParticipantAccess(
      sessionId,
      req.user.userId,
    );
    if (participantAccess.error) {
      return res
        .status(participantAccess.error.status)
        .json({ error: participantAccess.error.message });
    }

    try {
      const livenessSessionId = await createLivenessSession();
      const key = authProgressKey(sessionId, req.user.userId);
      const current = meetingAuthProgress.get(key) ?? {};
      meetingAuthProgress.set(key, {
        ...current,
        livenessSessionId,
        livenessPassed: false,
      });

      return res.json({ livenessSessionId });
    } catch (err) {
      console.error("[meet/liveness/start] error:", err.message);
      return res
        .status(502)
        .json({ error: "Failed to create liveness session" });
    }
  },
);

// POST /meet/session/:sessionId/liveness/complete
router.post(
  "/session/:sessionId/liveness/complete",
  requireAuth,
  async (req, res) => {
    const parsed = livenessCompleteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { sessionId } = req.params;
    const { livenessSessionId } = parsed.data;

    const participantAccess = await ensureParticipantAccess(
      sessionId,
      req.user.userId,
    );
    if (participantAccess.error) {
      return res
        .status(participantAccess.error.status)
        .json({ error: participantAccess.error.message });
    }

    const { data: user } = await supabase
      .from("users")
      .select("profile_photo_s3_key")
      .eq("id", req.user.userId)
      .single();

    if (!user?.profile_photo_s3_key) {
      return res.status(422).json({
        error: "No reference face photo found. Please complete KYC first.",
      });
    }

    try {
      const result = await getLivenessResult(
        livenessSessionId,
        user.profile_photo_s3_key,
      );

      const key = authProgressKey(sessionId, req.user.userId);
      const current = meetingAuthProgress.get(key) ?? {};
      meetingAuthProgress.set(key, {
        ...current,
        livenessSessionId,
        livenessPassed: Boolean(result.livenessPass && result.faceMatchPassed),
        livenessConfidence: result.livenessConfidence,
        faceMatchScore: result.faceMatchScore,
        livenessCheckedAt: new Date().toISOString(),
      });

      return res.json(result);
    } catch (err) {
      console.error("[meet/liveness/complete] error:", err.message);
      return res.status(422).json({
        error: err.message,
        livenessPass: false,
        faceMatchPassed: false,
        livenessConfidence: 0,
        faceMatchScore: 0,
      });
    }
  },
);

// POST /meet/session/:sessionId/passkey/assert/start
router.post(
  "/session/:sessionId/passkey/assert/start",
  requireAuth,
  async (req, res) => {
    const { sessionId } = req.params;

    const participantAccess = await ensureParticipantAccess(
      sessionId,
      req.user.userId,
    );
    if (participantAccess.error) {
      return res
        .status(participantAccess.error.status)
        .json({ error: participantAccess.error.message });
    }

    const { data: creds } = await supabase
      .from("webauthn_credentials")
      .select("credential_id, transports")
      .eq("user_id", req.user.userId)
      .eq("status", "active");

    if (!creds?.length) {
      return res.status(404).json({
        error: "No active passkey found. Please complete enrollment first.",
      });
    }

    const challengeOptions = await generateAuthChallenge(
      req.user.userId,
      creds,
    );
    return res.json({ challengeOptions });
  },
);

// POST /meet/session/:sessionId/passkey/assert/complete
router.post(
  "/session/:sessionId/passkey/assert/complete",
  requireAuth,
  async (req, res) => {
    const parsed = passkeyCompleteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { sessionId } = req.params;

    const participantAccess = await ensureParticipantAccess(
      sessionId,
      req.user.userId,
    );
    if (participantAccess.error) {
      return res
        .status(participantAccess.error.status)
        .json({ error: participantAccess.error.message });
    }

    const { data: cred } = await supabase
      .from("webauthn_credentials")
      .select("credential_id, public_key, sign_count, transports")
      .eq("user_id", req.user.userId)
      .eq("status", "active")
      .maybeSingle();

    if (!cred)
      return res.status(404).json({ error: "No active credential found" });

    let authInfo;
    try {
      authInfo = await verifyAuthChallenge(
        req.user.userId,
        parsed.data.assertionResponse,
        cred,
        MOBILE_ORIGIN,
      );
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await supabase
      .from("webauthn_credentials")
      .update({ sign_count: authInfo.newCounter })
      .eq("credential_id", cred.credential_id);

    const key = authProgressKey(sessionId, req.user.userId);
    const current = meetingAuthProgress.get(key) ?? {};
    meetingAuthProgress.set(key, {
      ...current,
      passkeyPassed: true,
      passkeyVerifiedAt: new Date().toISOString(),
    });

    return res.json({ ok: true });
  },
);

// POST /meet/session/:sessionId/complete-auth
router.post(
  "/session/:sessionId/complete-auth",
  requireAuth,
  async (req, res) => {
    const parsed = completeAuthSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { sessionId } = req.params;
    const participantAccess = await ensureParticipantAccess(
      sessionId,
      req.user.userId,
    );
    if (participantAccess.error) {
      return res
        .status(participantAccess.error.status)
        .json({ error: participantAccess.error.message });
    }

    const { participant, session } = participantAccess;
    const key = authProgressKey(sessionId, req.user.userId);
    const progress = meetingAuthProgress.get(key) ?? {};

    if (parsed.data.status === "failed") {
      await supabase
        .from("meeting_participants")
        .update({
          status: "failed",
          failure_reason: parsed.data.failureReason ?? "Authentication failed",
          last_verified_at: null,
          verification_expires_at: null,
        })
        .eq("id", participant.id);

      await recordMeetingEvent({
        sessionId,
        participantId: participant.id,
        eventType: "AUTH_FAILED",
        metadata: {
          userId: req.user.userId,
          failureReason: parsed.data.failureReason ?? "Authentication failed",
        },
      });

      await emitMeetingEvent(sessionId, "meeting:participants-updated", {
        reason: "auth-failed",
        participantId: participant.id,
      });

      meetingAuthProgress.delete(key);
      return res.json({ ok: true, status: "failed" });
    }

    if (!progress.livenessPassed) {
      return res.status(409).json({
        error:
          "Liveness and face match must pass before completing authentication",
      });
    }

    // DEV BYPASS: passkey assertion skipped until WebAuthn enrollment is wired up.
    // To re-enable: remove this block and restore the passkeyPassed check.
    if (
      !progress.passkeyPassed &&
      process.env.NODE_ENV === "production" &&
      false
    ) {
      return res.status(409).json({
        error: "Passkey assertion must pass before completing authentication",
      });
    }

    const reauthIntervalMinutes =
      session.reauth_interval_minutes ?? DEFAULT_REAUTH_MINUTES;
    const nowIso = new Date().toISOString();
    const expiresAtIso = toIsoWithMinutes(reauthIntervalMinutes);

    await supabase
      .from("meeting_participants")
      .update({
        status: "verified",
        last_verified_at: nowIso,
        verification_expires_at: expiresAtIso,
        failure_reason: null,
      })
      .eq("id", participant.id);

    await recordMeetingEvent({
      sessionId,
      participantId: participant.id,
      eventType: "AUTH_VERIFIED",
      metadata: {
        userId: req.user.userId,
        livenessConfidence: progress.livenessConfidence ?? null,
        faceMatchScore: progress.faceMatchScore ?? null,
        reauthIntervalMinutes,
        expiresAt: expiresAtIso,
      },
    });

    await emitMeetingEvent(sessionId, "meeting:participants-updated", {
      reason: "auth-verified",
      participantId: participant.id,
    });

    meetingAuthProgress.delete(key);

    return res.json({
      ok: true,
      status: "verified",
      verificationExpiresAt: expiresAtIso,
      reauthIntervalMinutes,
    });
  },
);

// POST /meet/session/:sessionId/subscribe
// Convenience endpoint to validate host access before socket room join attempts.
router.post("/session/:sessionId/subscribe", requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const hostAccess = await ensureHostAccess(sessionId, req.user.userId);
  if (hostAccess.error)
    return res
      .status(hostAccess.error.status)
      .json({ error: hostAccess.error.message });
  return res.json({ ok: true, room: `meeting:${sessionId}` });
});

export default router;
