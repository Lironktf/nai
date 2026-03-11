import { meet } from '@googleworkspace/meet-addons/meet.addons';

// Lazily initialized — only works when running inside a real Google Meet iframe.
// In local dev (localhost:5174) createAddonSession will throw and we fall back gracefully.
let _clientsPromise = null;

async function getClients() {
  if (_clientsPromise) return _clientsPromise;
  _clientsPromise = (async () => {
    const projectNumber = import.meta.env.VITE_CLOUD_PROJECT_NUMBER;
    if (!projectNumber) throw new Error('VITE_CLOUD_PROJECT_NUMBER not set');
    const session = await meet.addon.createAddonSession({ cloudProjectNumber: projectNumber });
    const sidePanelClient = await session.createSidePanelClient();
    return { session, sidePanelClient };
  })();
  return _clientsPromise;
}

export async function getMeetingContext() {
  // 1. Real Meet SDK (only works inside the Meet iframe)
  try {
    const { sidePanelClient } = await getClients();
    const frame = await sidePanelClient.getFrameContext();
    const code = frame?.meetingInfo?.meetingCode ?? frame?.meetingCode;
    if (code) return { meetingCode: sanitize(code), source: 'meet-sdk' };
  } catch {
    // Not in Meet context — fall through
  }

  // 2. URL query param fallback (useful for passing code manually in dev)
  const urlCode = new URLSearchParams(window.location.search).get('meetingCode');
  if (urlCode) return { meetingCode: sanitize(urlCode), source: 'url' };

  // 3. Generated fallback for local dev
  return { meetingCode: generateFallbackCode(), source: 'fallback' };
}

export async function getMeetingRoster() {
  try {
    const { sidePanelClient } = await getClients();
    const frame = await sidePanelClient.getFrameContext();
    const participants = frame?.participants ?? [];
    return participants.map((p) => ({
      id: String(p.participantId ?? p.id ?? Math.random()),
      displayName: p.displayName ?? 'Unknown',
    }));
  } catch {
    return [];
  }
}

function sanitize(code) {
  return String(code).trim().replace(/\s+/g, '-').toUpperCase();
}

function generateFallbackCode() {
  const prefix = (import.meta.env.VITE_MEET_FALLBACK_PREFIX || 'NAI').toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${block()}-${block()}`;
}
