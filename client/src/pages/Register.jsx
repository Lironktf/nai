import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Register({ onRegistered }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await api.register(email, password);
      localStorage.setItem('th_token', token);
      onRegistered();
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>TrustHandshake</h1>
      <p style={styles.subtitle}>Create your account to begin identity verification.</p>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
          />
        </label>
        <label style={styles.label}>Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={styles.input}
          />
          <span style={styles.hint}>Minimum 8 characters</span>
        </label>
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' },
  title: { fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' },
  subtitle: { color: '#555', marginBottom: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.9rem', fontWeight: 500 },
  input: { padding: '0.6rem 0.75rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '1rem' },
  hint: { fontSize: '0.75rem', color: '#888' },
  error: { color: '#c00', fontSize: '0.875rem', margin: 0 },
  button: { padding: '0.75rem', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: '1rem', cursor: 'pointer' },
};
