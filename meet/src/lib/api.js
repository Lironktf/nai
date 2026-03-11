const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken() {
  return localStorage.getItem('th_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('th_token', token);
  else localStorage.removeItem('th_token');
}

async function request(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error('Missing auth token. Paste a valid th_token first.');

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

export const api = {
  getToken,
  setToken,

  startSession: (meetingCode, reauthIntervalMinutes) =>
    request('/meet/session/start', {
      method: 'POST',
      body: JSON.stringify({ meetingCode, reauthIntervalMinutes }),
    }),

  getSession: (sessionId) => request(`/meet/session/${sessionId}`),
  findSessionByCode: (code) => request(`/meet/session/by-code?code=${encodeURIComponent(code)}`),
  getParticipants: (sessionId) => request(`/meet/session/${sessionId}/participants`),
  getEvents: (sessionId, limit = 40) => request(`/meet/session/${sessionId}/events?limit=${limit}`),

  subscribeSession: (sessionId) =>
    request(`/meet/session/${sessionId}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  verifyAll: (sessionId) =>
    request(`/meet/session/${sessionId}/verify-all`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  reverifyParticipant: (sessionId, participantId, reason) =>
    request(`/meet/session/${sessionId}/participant/${participantId}/reverify`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  endSession: (sessionId) =>
    request(`/meet/session/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
