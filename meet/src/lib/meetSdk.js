// TODO(Meet SDK): replace this with real Google Meet add-on context wiring once
// Cloud project + add-on manifest credentials are configured.

export async function getMeetingContext() {
  const urlCode = new URLSearchParams(window.location.search).get('meetingCode');
  if (urlCode) return { meetingCode: sanitize(urlCode), source: 'url' };

  // Best-effort SDK probing. Keep this defensive so local dev still works.
  try {
    const sdk =
      window?.google?.meet?.addon ??
      window?.gapi?.meet?.addon ??
      window?.meetAddonSdk;

    if (sdk?.getMeetingInfo) {
      const info = await sdk.getMeetingInfo();
      if (info?.meetingCode) {
        return { meetingCode: sanitize(info.meetingCode), source: 'meet-sdk' };
      }
    }
  } catch {
    // Ignore and fallback.
  }

  return { meetingCode: generateFallbackCode(), source: 'fallback' };
}

export async function getMeetingRoster() {
  try {
    const sdk =
      window?.google?.meet?.addon ??
      window?.gapi?.meet?.addon ??
      window?.meetAddonSdk;

    if (sdk?.getParticipants) {
      const participants = await sdk.getParticipants();
      if (Array.isArray(participants)) {
        return participants.map((p) => ({
          id: String(p.id ?? p.participantId ?? p.displayName ?? Math.random()),
          displayName: p.displayName ?? p.name ?? 'Unknown participant',
        }));
      }
    }
  } catch {
    // Ignore and use empty roster.
  }

  return [];
}

function sanitize(code) {
  return String(code).trim().replace(/\s+/g, '-').toUpperCase();
}

function generateFallbackCode() {
  const prefix = (import.meta.env.VITE_MEET_FALLBACK_PREFIX || 'NAI').toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${block()}-${block()}`;
}
