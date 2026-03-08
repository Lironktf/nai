// Placeholder — replaced by the full enrollment flow in Chunk 3.
export default function EnrollPlaceholder() {
  return (
    <div style={styles.container}>
      <h2>Identity Verified</h2>
      <p style={styles.sub}>
        Your identity has been confirmed. Next, you'll register your fingerprint key.
      </p>
      <div style={styles.badge}>KYC Approved</div>
      <p style={styles.hint}>Fingerprint enrollment coming in Chunk 3.</p>
    </div>
  );
}

const styles = {
  container: { maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem', textAlign: 'center' },
  sub: { color: '#555', marginBottom: '1.5rem' },
  badge: { display: 'inline-block', background: '#d4edda', color: '#155724', borderRadius: 20, padding: '0.4rem 1rem', fontWeight: 600, marginBottom: '1.5rem' },
  hint: { color: '#aaa', fontSize: '0.8rem' },
};
