export default function SessionControls({
  meetingCode,
  setMeetingCode,
  reauthMinutes,
  setReauthMinutes,
  onStart,
  onVerifyAll,
  onEnd,
  active,
  sdkSource,
}) {
  return (
    <div style={s.card}>
      <div style={s.row}>
        <label style={s.label}>Meeting Code</label>
        <input
          value={meetingCode}
          onChange={(e) => setMeetingCode(e.target.value.toUpperCase())}
          placeholder="NAI-ABC-123"
          style={s.input}
        />
        <div style={s.hint}>Source: {sdkSource}</div>
      </div>

      <div style={s.row}>
        <label style={s.label}>Auth freshness: {reauthMinutes} minutes</label>
        <input
          type="range"
          min={5}
          max={60}
          step={1}
          value={reauthMinutes}
          onChange={(e) => setReauthMinutes(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={s.actions}>
        {!active && (
          <button style={s.primary} onClick={onStart}>Start Secure Session</button>
        )}

        {active && (
          <>
            <button style={s.secondary} onClick={onVerifyAll}>Verify All</button>
            <button style={s.danger} onClick={onEnd}>End Session</button>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    padding: '0.8rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.8rem',
  },
  row: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { fontSize: 13, color: '#374151', fontWeight: 600 },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '0.55rem 0.6rem',
    fontSize: 14,
  },
  hint: { fontSize: 11, color: '#6b7280' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  primary: {
    background: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '0.55rem 0.7rem',
    cursor: 'pointer',
    fontSize: 13,
  },
  secondary: {
    background: '#f8fafc',
    color: '#111827',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '0.55rem 0.7rem',
    cursor: 'pointer',
    fontSize: 13,
  },
  danger: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '0.55rem 0.7rem',
    cursor: 'pointer',
    fontSize: 13,
  },
};
