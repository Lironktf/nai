import ParticipantRow from './ParticipantRow.jsx';

export default function ParticipantList({ participants, onReverify }) {
  if (!participants.length) {
    return (
      <div style={s.empty}>No participants yet.</div>
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
  wrap: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  empty: {
    border: '1px dashed #000',
    padding: '0.6rem',
    color: '#666',
    fontSize: 11,
  },
};
