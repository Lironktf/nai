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
    <div style={s.block}>
      <div style={s.row}>
        <div style={s.label}>Meeting code <span style={s.source}>({sdkSource})</span></div>
        <input
          value={meetingCode}
          onChange={(e) => setMeetingCode(e.target.value.toUpperCase())}
          placeholder="NAI-ABC-123"
          style={s.input}
        />
      </div>

      <div style={s.row}>
        <div style={s.label}>Auth freshness — {reauthMinutes} min</div>
        <input
          type="range"
          min={5}
          max={60}
          step={1}
          value={reauthMinutes}
          onChange={(e) => setReauthMinutes(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#000' }}
        />
      </div>

      <div style={s.actions}>
        {!active && (
          <button style={s.primary} onClick={onStart}>Start session</button>
        )}
        {active && (
          <>
            <button style={s.secondary} onClick={onVerifyAll}>Verify all</button>
            <button style={s.destructive} onClick={onEnd}>End session</button>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  block: {
    border: '1px solid #000',
    padding: '0.6rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  },
  row: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
  source: { fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  input: {
    border: '1px solid #000',
    padding: '0.4rem 0.5rem',
    fontSize: 13,
    fontFamily: 'monospace',
    width: '100%',
    boxSizing: 'border-box',
  },
  actions: { display: 'flex', gap: '0.4rem' },
  primary: {
    background: '#000',
    color: '#fff',
    border: '1px solid #000',
    padding: '0.4rem 0.7rem',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  secondary: {
    background: '#fff',
    color: '#000',
    border: '1px solid #000',
    padding: '0.4rem 0.7rem',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  destructive: {
    background: '#fff',
    color: '#000',
    border: '1px dashed #000',
    padding: '0.4rem 0.7rem',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};
