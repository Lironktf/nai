function formatCountdown(expiresAt) {
  if (!expiresAt) return '--';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function statusColor(status) {
  switch (status) {
    case 'verified': return '#166534';
    case 'pending': return '#92400e';
    case 'expired': return '#334155';
    case 'failed': return '#991b1b';
    case 'unlinked': return '#374151';
    default: return '#374151';
  }
}

export default function ParticipantRow({ participant, onReverify }) {
  const canReverify = participant.status !== 'pending' && !String(participant.id).startsWith('unlinked:');
  return (
    <div style={s.row}>
      <div style={{ flex: 1 }}>
        <div style={s.name}>{participant.identityLabel || 'Unknown'}</div>
        <div style={s.sub}>Status: <span style={{ color: statusColor(participant.status), fontWeight: 700 }}>{participant.status}</span></div>
        {participant.verificationExpiresAt && (
          <div style={s.sub}>Expires in: {formatCountdown(participant.verificationExpiresAt)}</div>
        )}
        {participant.failureReason && <div style={{ ...s.sub, color: '#991b1b' }}>{participant.failureReason}</div>}
      </div>

      <button
        onClick={() => onReverify(participant.id)}
        disabled={!canReverify}
        style={{ ...s.btn, opacity: canReverify ? 1 : 0.55 }}
      >
        Reverify
      </button>
    </div>
  );
}

const s = {
  row: {
    display: 'flex',
    gap: '0.75rem',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '0.75rem',
    background: '#fff',
    alignItems: 'center',
  },
  name: { fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 },
  sub: { fontSize: 12, color: '#4b5563' },
  btn: {
    border: '1px solid #d1d5db',
    background: '#f8fafc',
    color: '#111827',
    padding: '0.4rem 0.55rem',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
  },
};
