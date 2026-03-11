import { useEffect, useMemo, useState } from 'react';
import { getMeetingContext, getMeetingRoster } from './lib/meetSdk.js';
import ParticipantList from './components/ParticipantList.jsx';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchStatus(code) {
  const res = await fetch(`${BASE}/meet/session/status?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  return res.json();
}

export default function App() {
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingCodeSource, setMeetingCodeSource] = useState('fallback');
  const [sessionData, setSessionData] = useState(null); // { sessionId, participants, status, ... }
  const [sdkRoster, setSdkRoster] = useState([]);

  // Merge verified participants with unlinked SDK roster entries
  const mergedParticipants = useMemo(() => {
    const participants = sessionData?.participants ?? [];
    if (!sdkRoster.length) return participants;
    const existingNames = new Set(
      participants.map((p) => (p.displayName || p.identityLabel || '').trim().toLowerCase()).filter(Boolean)
    );
    const unlinked = sdkRoster
      .filter((p) => !existingNames.has((p.displayName || '').trim().toLowerCase()))
      .map((p) => ({
        id: `unlinked:${p.id}`,
        identityLabel: `${p.displayName} | Not verified`,
        status: 'unlinked',
        verificationExpiresAt: null,
      }));
    return [...participants, ...unlinked];
  }, [sessionData, sdkRoster]);

  useEffect(() => {
    getMeetingContext().then((ctx) => {
      setMeetingCode(ctx.meetingCode);
      setMeetingCodeSource(ctx.source);
    });
    getMeetingRoster().then(setSdkRoster);
    const rosterTimer = setInterval(async () => {
      setSdkRoster(await getMeetingRoster());
    }, 5000);
    return () => clearInterval(rosterTimer);
  }, []);

  // Poll for participant status once we have a meeting code
  useEffect(() => {
    if (!meetingCode) return;
    let cancelled = false;

    async function poll() {
      const data = await fetchStatus(meetingCode);
      if (!cancelled) setSessionData(data);
    }

    poll();
    const timer = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [meetingCode]);

  const active = sessionData?.status === 'active';
  const statusLabel = !meetingCode
    ? 'Waiting for meeting code...'
    : !sessionData
    ? `No active session for ${meetingCode} — start one from the NAI app.`
    : null;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.headerTitle}>NAI Secure Meet</span>
        <span style={{ ...s.dot, background: active ? '#000' : '#ccc' }} title={active ? 'Active' : 'No session'} />
      </div>

      <div style={s.metaBlock}>
        <div style={s.metaRow}>
          <span style={s.metaKey}>Code</span>
          <span style={s.metaVal}>{meetingCode || '—'} {meetingCodeSource !== 'meet-sdk' && <span style={s.badge}>{meetingCodeSource}</span>}</span>
        </div>
        <div style={s.metaRow}>
          <span style={s.metaKey}>Status</span>
          <span style={s.metaVal}>{sessionData?.status ?? 'no session'}</span>
        </div>
        {active && (
          <div style={s.metaRow}>
            <span style={s.metaKey}>Reauth</span>
            <span style={s.metaVal}>{sessionData.reauthIntervalMinutes} min</span>
          </div>
        )}
      </div>

      {statusLabel && <div style={s.notice}>{statusLabel}</div>}

      {active && (
        <>
          <div style={s.sectionLabel}>Participants</div>
          <ParticipantList participants={mergedParticipants} onReverify={null} />
        </>
      )}
    </div>
  );
}

const s = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.75rem',
    background: '#fff',
    color: '#000',
    width: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '2px solid #000',
    paddingBottom: '0.5rem',
    marginBottom: '0.25rem',
  },
  headerTitle: { fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  metaBlock: { border: '1px solid #000', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  metaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  metaKey: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
  metaVal: { fontSize: 11, fontFamily: 'monospace' },
  badge: { fontSize: 9, background: '#000', color: '#fff', padding: '1px 4px', marginLeft: 4 },
  notice: { fontSize: 11, color: '#666', border: '1px solid #ccc', padding: '0.5rem' },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', borderBottom: '1px solid #000', paddingBottom: '0.25rem',
  },
};
