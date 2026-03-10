const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken() {
  return localStorage.getItem('th_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

async function requestRaw(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

export const api = {
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  kycStart: () =>
    request('/kyc/start', { method: 'POST' }),

  kycStatus: () =>
    request('/kyc/status'),

  enrollStart: () =>
    request('/enroll/start', { method: 'POST' }),

  enrollVideoUpload: (formData) =>
    requestRaw('/enroll/video-upload', { method: 'POST', body: formData }),

  enrollWebauthnComplete: (registrationResponse) =>
    request('/enroll/webauthn-complete', { method: 'POST', body: JSON.stringify(registrationResponse) }),

  enrollmentQueue: () =>
    request('/admin/enrollment-queue'),

  enrollmentReview: (enrollmentVideoId, decision, rejectReason) =>
    request('/admin/enrollment-review', {
      method: 'POST',
      body: JSON.stringify({ enrollmentVideoId, decision, rejectReason }),
    }),

  telegramCompleteLink: (token) =>
    request('/telegram/complete-link', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
};
