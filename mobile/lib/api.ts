import { router } from 'expo-router';
import { clearToken, getToken } from './storage';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await clearToken();
    router.replace('/');
    throw Object.assign(new Error('Session expired. Please sign in again.'), { status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error((data as any).error ?? 'Request failed'), { status: res.status });
  return data as T;
}

export const api = {
  // Auth (reuses existing server endpoints)
  register: (email: string, password: string, legalName?: string, phone?: string) =>
    request<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, legalName, phone }) }),

  login: (email: string, password: string) =>
    request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  me: () =>
    request<{ legalName: string; email: string }>('/mobile/me'),

  // KYC
  kycStatus: () =>
    request<{ status: string }>('/kyc/status'),

  kycSync: () =>
    request<{ status: string; synced: boolean }>('/kyc/sync', { method: 'POST' }),

  mobileKycStart: () =>
    request<{ inquiryId: string; sessionToken: string }>('/mobile/kyc/start', { method: 'POST' }),

  // Passkey registration
  passkeyRegisterStart: () =>
    request<{ challengeOptions: any }>('/mobile/passkey/register/start', { method: 'POST' }),

  passkeyRegisterComplete: (registrationResponse: any) =>
    request<{ ok: boolean }>('/mobile/passkey/register/complete', {
      method: 'POST',
      body: JSON.stringify({ registrationResponse }),
    }),

  // Passkey assertion (legacy mobile verification session)
  passkeyAssertStart: (sessionId: string) =>
    request<{ challengeOptions: any }>('/mobile/passkey/assert/start', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  passkeyAssertComplete: (sessionId: string, assertionResponse: any, faceScore: number) =>
    request<{ ok: boolean }>('/mobile/passkey/assert/complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId, assertionResponse, faceScore }),
    }),

  faceEnroll: (imageBase64: string) =>
    request<{ ok: boolean }>('/mobile/face/enroll', {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    }),

  // DEV BYPASS: compare face against KYC photo and activate account if it matches
  faceActivateBypass: (imageBase64: string) =>
    request<{ passed: boolean; score: number }>('/mobile/face/activate-bypass', {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    }),

  // Face embedding check
  checkFaceEmbedding: (sessionId: string, imageBase64: string) =>
    request<{ passed: boolean; score: number }>('/mobile/face/check', {
      method: 'POST',
      body: JSON.stringify({ sessionId, imageBase64 }),
    }),

  // Verification sessions
  searchUsers: (q: string) =>
    request<Array<{ id: string; legalName: string; photoUrl: string | null }>>(`/mobile/users/search?q=${encodeURIComponent(q)}`),

  requestVerification: (recipientId: string) =>
    request<{ sessionId: string }>('/mobile/verification/request', {
      method: 'POST',
      body: JSON.stringify({ recipientId }),
    }),

  acceptVerification: (sessionId: string) =>
    request<{ ok: boolean }>('/mobile/verification/accept', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  declineVerification: (sessionId: string) =>
    request<{ ok: boolean }>('/mobile/verification/decline', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  sessionStatus: (sessionId: string) =>
    request<{ state: string; verificationCode?: string }>(`/mobile/verification/session/${sessionId}`),

  recentVerifications: () =>
    request<Array<{ id: string; peerName: string; verifiedAt: string; code: string }>>('/mobile/verification/recent'),

  // Face Liveness (legacy endpoints)
  livenessStart: () =>
    request<{ sessionId: string }>('/mobile/liveness/start', { method: 'POST' }),

  livenessComplete: (sessionId: string) =>
    request<{
      livenessConfidence: number;
      livenessPass: boolean;
      faceMatchPassed: boolean;
      faceMatchScore: number;
    }>('/mobile/liveness/complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  // Meet MVP
  meetJoin: (meetingCode: string, displayName?: string) =>
    request<{
      sessionId: string;
      meetingCode: string;
      participantId: string;
      status: string;
      reauthIntervalMinutes: number;
    }>('/meet/join', {
      method: 'POST',
      body: JSON.stringify({ meetingCode, displayName }),
    }),

  meetLivenessStart: (sessionId: string) =>
    request<{ livenessSessionId: string }>(`/meet/session/${sessionId}/liveness/start`, {
      method: 'POST',
    }),

  meetLivenessComplete: (sessionId: string, livenessSessionId: string) =>
    request<{
      livenessConfidence: number;
      livenessPass: boolean;
      faceMatchPassed: boolean;
      faceMatchScore: number;
    }>(`/meet/session/${sessionId}/liveness/complete`, {
      method: 'POST',
      body: JSON.stringify({ livenessSessionId }),
    }),

  meetPasskeyAssertStart: (sessionId: string) =>
    request<{ challengeOptions: any }>(`/meet/session/${sessionId}/passkey/assert/start`, {
      method: 'POST',
    }),

  meetPasskeyAssertComplete: (sessionId: string, assertionResponse: any) =>
    request<{ ok: boolean }>(`/meet/session/${sessionId}/passkey/assert/complete`, {
      method: 'POST',
      body: JSON.stringify({ assertionResponse }),
    }),

  meetCompleteAuth: (sessionId: string, payload?: { status?: 'verified' | 'failed'; failureReason?: string }) =>
    request<{
      ok: boolean;
      status: 'verified' | 'failed';
      verificationExpiresAt?: string;
      reauthIntervalMinutes?: number;
    }>(`/meet/session/${sessionId}/complete-auth`, {
      method: 'POST',
      body: JSON.stringify(payload ?? { status: 'verified' }),
    }),

  meetStartSession: (meetingCode: string, reauthIntervalMinutes?: number) =>
    request<{
      sessionId: string;
      meetingCode: string;
      status: string;
      reauthIntervalMinutes: number;
      startedAt: string;
    }>('/meet/session/start', {
      method: 'POST',
      body: JSON.stringify({ meetingCode, reauthIntervalMinutes }),
    }),

  meetEndSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/meet/session/${sessionId}/end`, { method: 'POST' }),

  // Dev-only bypass for Expo Go (passkey native module not available)
  passkeyRegisterBypass: () =>
    request<{ status: string }>('/mobile/passkey/register/bypass', { method: 'POST' }),

  syncProfilePhoto: () =>
    request<{ ok: boolean; key: string }>('/mobile/test/sync-profile-photo', { method: 'POST' }),

  // Dev-only test helpers (blocked in production)
  testStartSession: () =>
    request<{ sessionId: string; peerName: string; peerPhoto: string | null }>('/mobile/test/start-session', { method: 'POST' }),

  testAssertBypass: (sessionId: string) =>
    request<{ ok: boolean; verificationCode?: string; state?: string }>('/mobile/test/assert-bypass', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};
