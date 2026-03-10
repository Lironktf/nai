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
      participants
        .map((p) => (p.displayName || '').trim().toLowerCase())
        .filter(Boolean)
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

    return () => {
      socket.disconnect();
    };
  }, [session, hasToken]);

  useEffect(() => {
    if (!session) return;

    const id = session.sessionId || session.id;
    const countdownTimer = setInterval(() => {
      setParticipants((prev) => [...prev]);
    }, 1000);

    const pollTimer = setInterval(() => {
      refreshParticipants(id).catch(() => {});
      refreshEvents(id).catch(() => {});
    }, 5000);

    return () => {
      clearInterval(countdownTimer);
      clearInterval(pollTimer);
    };
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
    if (!hasToken) {
      setError('Paste your th_token first.');
      return;
    }

    setBusy(true);
    try {
      const started = await api.startSession(meetingCode, reauthMinutes);
      setSession(started);
      await Promise.all([
        refreshParticipants(started.sessionId),
        refreshEvents(started.sessionId),
      ]);
    } catch (err) {
      setError(err.message || 'Failed to start session');
    } finally {
      setBusy(false);
    }
  }

  async function verifyAll() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const id = session.sessionId || session.id;
      await api.verifyAll(id);
      await Promise.all([refreshParticipants(id), refreshEvents(id)]);
    } catch (err) {
      setError(err.message || 'Failed to mark all pending');
    } finally {
      setBusy(false);
    }
  }

  async function reverifyParticipant(participantId) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const id = session.sessionId || session.id;
      await api.reverifyParticipant(id, participantId, 'Host requested reverification');
      await Promise.all([refreshParticipants(id), refreshEvents(id)]);
    } catch (err) {
      setError(err.message || 'Failed to reverify participant');
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const id = session.sessionId || session.id;
      await api.endSession(id);
      setSession((prev) => prev ? { ...prev, status: 'ended' } : prev);
      await refreshEvents(id);
    } catch (err) {
      setError(err.message || 'Failed to end session');
    } finally {
      setBusy(false);
    }
  }

  function saveToken() {
    api.setToken(tokenInput.trim());
    setError('');
  }

  async function copyMeetingCode() {
    try {
      await navigator.clipboard.writeText(meetingCode);
    } catch {
      setError('Clipboard unavailable in this browser context.');
    }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={{ margin: 0, fontSize: 16 }}>NAI Secure Meet</h1>
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          Side-panel MVP
        </span>
      </div>

      <div style={s.card}>
        <label style={s.label}>Host JWT (`th_token`)</label>
        <textarea
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          rows={3}
          style={s.textarea}
          placeholder="Paste token from your authenticated NAI session"
        />
        <button style={s.smallBtn} onClick={saveToken}>Save Token</button>
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

      <div style={s.sessionInfo}>
        <div><strong>Session:</strong> {session ? (session.sessionId || session.id) : 'Not started'}</div>
        <div><strong>Meeting code:</strong> {meetingCode}</div>
        <div><strong>Status:</strong> {session?.status ?? 'idle'}</div>
        <div><strong>Reauth:</strong> {session?.reauthIntervalMinutes ?? reauthMinutes} min</div>
        <button onClick={copyMeetingCode} style={s.smallBtn}>Copy Meeting Code</button>
      </div>

      {error && <div style={s.error}>{error}</div>}
      {busy && <div style={s.busy}>Working...</div>}

      <h2 style={s.sectionTitle}>Participants</h2>
      <ParticipantList participants={mergedParticipants} onReverify={reverifyParticipant} />

      <h2 style={s.sectionTitle}>Event Log</h2>
      <div style={s.logWrap}>
        {!events.length && <div style={{ color: '#6b7280', fontSize: 12 }}>No events yet.</div>}
        {events.map((ev) => (
          <div key={ev.id} style={s.logRow}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{ev.event_type}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(ev.created_at).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '0.75rem',
    minHeight: '100vh',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '0.75rem',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
  },
  label: { fontSize: 12, fontWeight: 700, color: '#374151' },
  textarea: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '0.45rem',
    fontSize: 12,
    resize: 'vertical',
  },
  smallBtn: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '0.45rem 0.55rem',
    background: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    width: 'fit-content',
  },
  sessionInfo: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    padding: '0.75rem',
    fontSize: 12,
    color: '#1f2937',
    display: 'grid',
    gap: 4,
  },
  error: {
    border: '1px solid #fecaca',
    borderRadius: 10,
    background: '#fef2f2',
    color: '#b91c1c',
    padding: '0.65rem',
    fontSize: 12,
  },
  busy: {
    fontSize: 12,
    color: '#374151',
  },
  sectionTitle: {
    margin: '0.25rem 0',
    fontSize: 14,
    color: '#111827',
  },
  logWrap: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    background: '#fff',
    padding: '0.55rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 180,
    overflow: 'auto',
  },
  logRow: {
    borderBottom: '1px solid #f3f4f6',
    paddingBottom: 4,
  },
};
