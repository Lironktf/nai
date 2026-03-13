const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function getToken() {
  return localStorage.getItem("th_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("th_token", token);
  else localStorage.removeItem("th_token");
}

export function clearToken() {
  localStorage.removeItem("th_token");
}

async function parseResponse(res) {
  return res.json().catch(() => ({}));
}

async function request(path, options = {}) {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 45000,
  );
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  const data = await parseResponse(res);
  if (res.status === 401) {
    clearToken();
    throw Object.assign(
      new Error(data.error || "Session expired. Please sign in again."),
      { status: 401, data },
    );
  }
  if (!res.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: res.status,
      data,
    });
  return data;
}

async function requestRaw(path, options = {}) {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 45000,
  );
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  const data = await parseResponse(res);
  if (res.status === 401) {
    clearToken();
    throw Object.assign(
      new Error(data.error || "Session expired. Please sign in again."),
      { status: 401, data },
    );
  }
  if (!res.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: res.status,
      data,
    });
  return data;
}

export const api = {
  register: (email, password, legalName, phone) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, legalName, phone }),
    }),

  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request("/mobile/me"),

  publicConfig: () => request("/mobile/public-config"),

  kycStatus: () => request("/kyc/status"),

  kycSync: () => request("/kyc/sync", { method: "POST" }),

  mobileKycStart: () => request("/mobile/kyc/start", { method: "POST" }),

  faceActivateBypass: (imageBase64) =>
    request("/mobile/face/activate-bypass", {
      method: "POST",
      body: JSON.stringify({ imageBase64 }),
    }),

  searchUsers: (q) =>
    request(`/mobile/users/search?q=${encodeURIComponent(q)}`),

  requestVerification: (recipientId) =>
    request("/mobile/verification/request", {
      method: "POST",
      body: JSON.stringify({ recipientId }),
    }),

  acceptVerification: (sessionId) =>
    request("/mobile/verification/accept", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  declineVerification: (sessionId) =>
    request("/mobile/verification/decline", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  sessionStatus: (sessionId) =>
    request(`/mobile/verification/session/${sessionId}`),

  recentVerifications: () => request("/mobile/verification/recent"),

  livenessStart: () => request("/mobile/liveness/start", { method: "POST" }),

  livenessComplete: (sessionId) =>
    request("/mobile/liveness/complete", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  postKycActivate: (livenessSessionId) =>
    request("/mobile/post-kyc/activate", {
      method: "POST",
      body: JSON.stringify({ livenessSessionId }),
    }),

  postKycFinalize: () =>
    request("/mobile/post-kyc/finalize", {
      method: "POST",
    }),

  testAssertBypass: (sessionId) =>
    request("/mobile/test/assert-bypass", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  meetStartSession: (meetingCode, reauthIntervalMinutes) =>
    request("/meet/session/start", {
      method: "POST",
      body: JSON.stringify({ meetingCode, reauthIntervalMinutes }),
    }),

  meetJoin: (meetingCode, displayName) =>
    request("/meet/join", {
      method: "POST",
      body: JSON.stringify({ meetingCode, displayName }),
    }),

  meetLivenessStart: (sessionId) =>
    request(`/meet/session/${sessionId}/liveness/start`, { method: "POST" }),

  meetLivenessComplete: (sessionId, livenessSessionId) =>
    request(`/meet/session/${sessionId}/liveness/complete`, {
      method: "POST",
      body: JSON.stringify({ livenessSessionId }),
    }),

  meetCompleteAuth: (sessionId, payload = { status: "verified" }) =>
    request(`/meet/session/${sessionId}/complete-auth`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  meetEndSession: (sessionId) =>
    request(`/meet/session/${sessionId}/end`, { method: "POST" }),

  meetCurrentSessions: () => request("/meet/sessions/current"),
  meetCancelSession: (sessionId) =>
    request(`/meet/session/${sessionId}/cancel`, { method: "POST" }),

  telegramCompleteLink: (token) =>
    request("/telegram/complete-link", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  telegramCurrentSessions: () => request("/telegram/sessions/current"),
  telegramCancelSession: (sessionId) =>
    request(`/telegram/session/${sessionId}/cancel`, { method: "POST" }),

  telegramStartAuth: (code) =>
    request("/telegram/mobile/start-auth", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  telegramLivenessStart: () =>
    request("/telegram/mobile/liveness/start", { method: "POST" }),

  telegramCompleteAuth: (code, livenessSessionId) =>
    request("/telegram/mobile/complete-auth", {
      method: "POST",
      body: JSON.stringify({ code, livenessSessionId }),
    }),

  discordStartAuth: (code) =>
    request("/discord/mobile/start-auth", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  discordLivenessStart: () =>
    request("/discord/mobile/liveness/start", { method: "POST" }),

  discordCompleteAuth: (code, livenessSessionId) =>
    request("/discord/mobile/complete-auth", {
      method: "POST",
      body: JSON.stringify({ code, livenessSessionId }),
    }),

  discordCurrentSessions: () => request("/discord/sessions/current"),
  discordCancelSession: (sessionId) =>
    request(`/discord/session/${sessionId}/cancel`, { method: "POST" }),

  enrollStart: () => request("/enroll/start", { method: "POST" }),

  enrollVideoUpload: (formData) =>
    requestRaw("/enroll/video-upload", { method: "POST", body: formData }),

  enrollWebauthnComplete: (registrationResponse) =>
    request("/enroll/webauthn-complete", {
      method: "POST",
      body: JSON.stringify(registrationResponse),
    }),

  enrollmentQueue: () => request("/admin/enrollment-queue"),

  enrollmentReview: (enrollmentVideoId, decision, rejectReason) =>
    request("/admin/enrollment-review", {
      method: "POST",
      body: JSON.stringify({ enrollmentVideoId, decision, rejectReason }),
    }),
};
