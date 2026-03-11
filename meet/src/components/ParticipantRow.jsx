function formatCountdown(expiresAt) {
  if (!expiresAt) return '--';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

// Status expressed as text label with inverted badge for verified, outlined otherwise
function StatusBadge({ status }) {
  const filled = status === 'verified';
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      padding: '2px 5px',
      border: '1px solid #000',
      background: filled ? '#000' : '#fff',
      color: filled ? '#fff' : '#000',
    }}>
      {status}
    </span>
  );
}

export default function ParticipantRow({ participant, onReverify }) {
  const canReverify = participant.status !== 'pending' && !String(participant.id).startsWith('unlinked:');
  return (
    <div style={s.row}>
      <div style={s.info}>
        <div style={s.name}>{participant.identityLabel || 'Unknown'}</div>
        <div style={s.meta}>
          <StatusBadge status={participant.status} />
          {participant.verificationExpiresAt && (
            <span style={s.countdown}>{formatCountdown(participant.verificationExpiresAt)}</span>
          )}
          {participant.failureReason && (
            <span style={s.failure}>{participant.failureReason}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onReverify(participant.id)}
        disabled={!canReverify}
        style={{ ...s.btn, opacity: canReverify ? 1 : 0.3 }}
      >
        Re-verify
      </button>
    </div>
  );
}

const s = {
  row: {
    display: 'flex',
    gap: '0.5rem',
    border: '1px solid #000',
    padding: '0.5rem',
    alignItems: 'center',
    background: '#fff',
  },
  info: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 12, fontWeight: 700, color: '#000' },
  meta: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  countdown: { fontSize: 10, fontFamily: 'monospace', color: '#000' },
  failure: { fontSize: 10, color: '#000', fontStyle: 'italic' },
  btn: {
    border: '1px solid #000',
    background: '#fff',
    color: '#000',
    padding: '0.3rem 0.5rem',
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
};
