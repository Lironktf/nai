import { useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import { createMeetSocket } from './lib/socket.js';
import { getMeetingContext, getMeetingRoster } from './lib/meetSdk.js';
import SessionControls from './components/SessionControls.jsx';
import ParticipantList from './components/ParticipantList.jsx';

export default function App() {
  const [tokenInput, setTokenInput] = useState(api.getToken() || '');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingCodeSource, setMeetingCodeSource] = useState('fallback');
  const [reauthMinutes, setReauthMinutes] = useState(10);
  const [session, setSession] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sdkRoster, setSdkRoster] = useState([]);

  const hasToken = Boolean(api.getToken());

  const mergedParticipants = useMemo(() => {
    if (!sdkRoster.length) return participants;
    const existingNames = new Set(
      participants.map((p) => (p.displayName || '').trim().toLowerCase()).filter(Boolean)
    );
    const unlinked = sdkRoster
      .filter((p) => !existingNames.has((p.displayName || '').trim().toLowerCase()))
      .map((p) => ({
        id: `unlinked:${p.id}`,
        identityLabel: `${p.displayName} | Unlinked`,
        status: 'unlinked',
        verificationExpiresAt: null,
      }));
    return [...participants, ...unlinked];
  }, [participants, sdkRoster]);

  useEffect(() => {
    getMeetingContext().then((ctx) => {
      setMeetingCode(ctx.meetingCode);
      setMeetingCodeSource(ctx.source);
    });
    const rosterTimer = setInterval(async () => {
      const roster = await getMeetingRoster();
      setSdkRoster(roster);
    }, 5000);
    getMeetingRoster().then(setSdkRoster);
    return () => clearInterval(rosterTimer);
  }, []);

  useEffect(() => {
    if (!session || !hasToken) return;
    const socket = createMeetSocket(api.getToken());
    socket.connect();
    socket.on('connect', async () => {
      socket.emit('meeting:join', { sessionId: session.sessionId || session.id }, () => {});
    });
    socket.on('meeting:participants-updated', () => {
      refreshParticipants(session.sessionId || session.id).catch(() => {});
      refreshEvents(session.sessionId || session.id).catch(() => {});
    });
    socket.on('meeting:ended', () => {
      setSession((prev) => prev ? { ...prev, status: 'ended' } : prev);
      refreshEvents(session.sessionId || session.id).catch(() => {});
    });
    return () => socket.disconnect();
  }, [session, hasToken]);

  useEffect(() => {
    if (!session) return;
    const id = session.sessionId || session.id;
    const countdownTimer = setInterval(() => setParticipants((prev) => [...prev]), 1000);
    const pollTimer = setInterval(() => {
      refreshParticipants(id).catch(() => {});
      refreshEvents(id).catch(() => {});
    }, 5000);
    return () => { clearInterval(countdownTimer); clearInterval(pollTimer); };
  }, [session]);

  async function refreshParticipants(sessionId) {
    const data = await api.getParticipants(sessionId);
    setParticipants(data);
  }
  async function refreshEvents(sessionId) {
    const data = await api.getEvents(sessionId, 25);
    setEvents(data);
  }
  async function startSession() {
    setError('');
    if (!hasToken) { setError('Paste your token first.'); return; }
    setBusy(true);
    try {
      const started = await api.startSession(meetingCode, reauthMinutes);
      setSession(started);
      await Promise.all([refreshParticipants(started.sessionId), refreshEvents(started.sessionId)]);
    } catch (err) { setError(err.message || 'Failed to start session'); }
    finally { setBusy(false); }
  }
  async function verifyAll() {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const id = session.sessionId || session.id;
      await api.verifyAll(id);
      await Promise.all([refreshParticipants(id), refreshEvents(id)]);
    } catch (err) { setError(err.message || 'Failed'); }
    finally { setBusy(false); }
  }
  async function reverifyParticipant(participantId) {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const id = session.sessionId || session.id;
      await api.reverifyParticipant(id, participantId, 'Host requested reverification');
      await Promise.all([refreshParticipants(id), refreshEvents(id)]);
    } catch (err) { setError(err.message || 'Failed'); }
    finally { setBusy(false); }
  }
  async function endSession() {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const id = session.sessionId || session.id;
      await api.endSession(id);
      setSession((prev) => prev ? { ...prev, status: 'ended' } : prev);
      await refreshEvents(id);
    } catch (err) { setError(err.message || 'Failed'); }
    finally { setBusy(false); }
  }
  function saveToken() { api.setToken(tokenInput.trim()); setError(''); }
  async function copyMeetingCode() {
    try { await navigator.clipboard.writeText(meetingCode); }
    catch { setError('Clipboard unavailable.'); }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.headerTitle}>NAI Secure Meet</span>
        {busy && <span style={s.busyDot} />}
      </div>

      <div style={s.block}>
        <div style={s.label}>Host token</div>
        <textarea
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          rows={2}
          style={s.textarea}
          placeholder="Paste th_token"
        />
        <button style={s.btn} onClick={saveToken}>Save</button>
      </div>

      <SessionControls
        meetingCode={meetingCode}
        setMeetingCode={setMeetingCode}
        reauthMinutes={reauthMinutes}
        setReauthMinutes={setReauthMinutes}
        onStart={startSession}
        onVerifyAll={verifyAll}
        onEnd={endSession}
        active={Boolean(session && session.status === 'active')}
        sdkSource={meetingCodeSource}
      />

      <div style={s.block}>
        <div style={s.metaRow}><span style={s.metaKey}>Session</span><span style={s.metaVal}>{session ? (session.sessionId || session.id).slice(0, 8) + '…' : '—'}</span></div>
        <div style={s.metaRow}><span style={s.metaKey}>Code</span><span style={s.metaVal}>{meetingCode || '—'}</span></div>
        <div style={s.metaRow}><span style={s.metaKey}>Status</span><span style={s.metaVal}>{session?.status ?? 'idle'}</span></div>
        <div style={s.metaRow}><span style={s.metaKey}>Reauth</span><span style={s.metaVal}>{session?.reauthIntervalMinutes ?? reauthMinutes} min</span></div>
        <button style={s.btn} onClick={copyMeetingCode}>Copy code</button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.sectionLabel}>Participants</div>
      <ParticipantList participants={mergedParticipants} onReverify={reverifyParticipant} />

      <div style={s.sectionLabel}>Event log</div>
      <div style={s.logWrap}>
        {!events.length && <div style={s.empty}>No events yet.</div>}
        {events.map((ev) => (
          <div key={ev.id} style={s.logRow}>
            <span style={s.logType}>{ev.event_type}</span>
            <span style={s.logTime}>{new Date(ev.created_at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
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
  busyDot: {
    width: 8, height: 8,
    background: '#000',
    display: 'inline-block',
    animation: 'pulse 1s infinite',
  },
  block: {
    border: '1px solid #000',
    padding: '0.6rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
  textarea: {
    border: '1px solid #000',
    padding: '0.4rem',
    fontSize: 11,
    resize: 'none',
    fontFamily: 'monospace',
    width: '100%',
    boxSizing: 'border-box',
  },
  btn: {
    border: '1px solid #000',
    background: '#fff',
    color: '#000',
    padding: '0.35rem 0.6rem',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    width: 'fit-content',
  },
  metaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  metaKey: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#000' },
  metaVal: { fontSize: 11, fontFamily: 'monospace', color: '#000' },
  error: {
    border: '1px solid #000',
    padding: '0.5rem',
    fontSize: 11,
    background: '#000',
    color: '#fff',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderBottom: '1px solid #000',
    paddingBottom: '0.25rem',
    marginTop: '0.25rem',
  },
  logWrap: {
    border: '1px solid #000',
    padding: '0.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 160,
    overflowY: 'auto',
  },
  logRow: { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb', paddingBottom: 3 },
  logType: { fontSize: 11, fontWeight: 600 },
  logTime: { fontSize: 10, color: '#666' },
  empty: { fontSize: 11, color: '#666' },
};
