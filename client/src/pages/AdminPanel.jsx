import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

export default function AdminPanel() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(null); // enrollmentVideoId being acted on

  async function loadQueue() {
    setLoading(true);
    setError('');
    try {
      const data = await api.enrollmentQueue();
      setQueue(data);
    } catch (err) {
      setError(err.message || 'Failed to load enrollment queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadQueue(); }, []);

  async function handleReview(enrollmentVideoId, decision, rejectReason) {
    setReviewing(enrollmentVideoId);
    try {
      await api.enrollmentReview(enrollmentVideoId, decision, rejectReason);
      setQueue((q) => q.filter((v) => v.id !== enrollmentVideoId));
    } catch (err) {
      alert(err.message || 'Review failed');
    } finally {
      setReviewing(null);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={{ margin: 0 }}>Admin — Enrollment Queue</h1>
        <button style={s.refreshBtn} onClick={loadQueue}>Refresh</button>
      </div>

      {error && <p style={s.error}>{error}</p>}
      {loading && <p style={{ color: '#555' }}>Loading...</p>}

      {!loading && queue.length === 0 && (
        <p style={{ color: '#555' }}>No pending enrollments.</p>
      )}

      {queue.map((item) => (
        <EnrollmentCard
          key={item.id}
          item={item}
          isReviewing={reviewing === item.id}
          onApprove={() => handleReview(item.id, 'approved')}
          onReject={(reason) => handleReview(item.id, 'rejected', reason)}
        />
      ))}
    </div>
  );
}

function EnrollmentCard({ item, isReviewing, onApprove, onReject }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const iv = Array.isArray(item.identity_verifications)
    ? item.identity_verifications[0]
    : item.identity_verifications;

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <div>
          <strong>{item.users?.legal_name ?? item.users?.email}</strong>
          <span style={s.email}> {item.users?.email}</span>
        </div>
        <span style={s.date}>{new Date(item.created_at).toLocaleString()}</span>
      </div>

      <div style={s.mediaRow}>
        {/* Enrollment video */}
        <div style={s.mediaBox}>
          <p style={s.label}>Enrollment Video</p>
          {item.videoUrl ? (
            <video src={item.videoUrl} controls style={s.video} />
          ) : (
            <div style={s.noMedia}>No video URL (check S3 config)</div>
          )}
        </div>

        {/* Profile photo from enrollment frame */}
        <div style={s.mediaBox}>
          <p style={s.label}>Captured Photo</p>
          {item.profilePhotoUrl ? (
            <img src={item.profilePhotoUrl} alt="Profile" style={s.photo} />
          ) : (
            <div style={s.noMedia}>No photo captured</div>
          )}
        </div>

        {/* Fingerprint scan clip */}
        <div style={s.mediaBox}>
          <p style={s.label}>Fingerprint Scan</p>
          {item.fpScanUrl ? (
            <video src={item.fpScanUrl} controls style={s.video} />
          ) : (
            <div style={s.noMedia}>No scan video</div>
          )}
        </div>
      </div>

      {/* Scores */}
      {iv && (
        <div style={s.scores}>
          <Score label="Face Match" value={iv.face_match_score} />
          <Score label="Liveness" value={iv.liveness_score} />
          <Score label="Document" value={iv.document_type} isText />
          <Score label="Country" value={iv.document_country} isText />
        </div>
      )}

      {/* Actions */}
      {!showRejectForm ? (
        <div style={s.actions}>
          <button
            style={{ ...s.btn, background: '#155724', color: '#fff' }}
            disabled={isReviewing}
            onClick={onApprove}
          >
            {isReviewing ? 'Processing...' : 'Approve'}
          </button>
          <button
            style={{ ...s.btn, background: '#721c24', color: '#fff' }}
            disabled={isReviewing}
            onClick={() => setShowRejectForm(true)}
          >
            Reject
          </button>
        </div>
      ) : (
        <div style={s.rejectForm}>
          <input
            style={s.input}
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div style={s.actions}>
            <button style={{ ...s.btn, background: '#721c24', color: '#fff' }}
              disabled={isReviewing}
              onClick={() => onReject(rejectReason)}>
              {isReviewing ? 'Processing...' : 'Confirm Reject'}
            </button>
            <button style={{ ...s.btn, background: '#555', color: '#fff' }}
              onClick={() => setShowRejectForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Score({ label, value, isText }) {
  if (value == null) return null;
  return (
    <div style={s.scoreItem}>
      <span style={{ fontSize: '0.75rem', color: '#888' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{isText ? value : `${Number(value).toFixed(1)}%`}</span>
    </div>
  );
}

const s = {
  page: { maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  refreshBtn: { padding: '0.5rem 1rem', background: '#eee', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#c00', marginBottom: '1rem' },
  card: { border: '1px solid #ddd', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem', background: '#fff' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  email: { color: '#888', fontWeight: 400, fontSize: '0.9rem' },
  date: { fontSize: '0.8rem', color: '#aaa' },
  mediaRow: { display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  mediaBox: { flex: 1, minWidth: 280 },
  label: { fontSize: '0.8rem', color: '#888', margin: '0 0 0.4rem' },
  video: { width: '100%', borderRadius: 6, maxHeight: 280 },
  photo: { width: '100%', borderRadius: 6, maxHeight: 280, objectFit: 'cover' },
  noMedia: { background: '#f5f5f5', borderRadius: 6, padding: '2rem', color: '#aaa', textAlign: 'center', fontSize: '0.85rem' },
  scores: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: 6 },
  scoreItem: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  actions: { display: 'flex', gap: '0.75rem' },
  btn: { padding: '0.6rem 1.25rem', border: 'none', borderRadius: 6, fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600 },
  rejectForm: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.6rem 0.75rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.9rem' },
};
