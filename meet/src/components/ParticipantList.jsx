import ParticipantRow from './ParticipantRow.jsx';

export default function ParticipantList({ participants, onReverify }) {
  if (!participants.length) {
    return (
      <div style={s.empty}>
        No participants have joined via NAI yet.
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {participants.map((p) => (
        <ParticipantRow key={p.id} participant={p} onReverify={onReverify} />
      ))}
    </div>
  );
}

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty: {
    border: '1px dashed #d1d5db',
    borderRadius: 10,
    padding: '0.75rem',
    color: '#6b7280',
    fontSize: 13,
    background: '#fff',
  },
};
