import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function TelegramAuth() {
  const [status, setStatus] = useState('processing'); // processing | success | error | login_required
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setError('Missing authentication token.');
      return;
    }

    const thToken = localStorage.getItem('th_token');
    if (!thToken) {
      setStatus('login_required');
      // Store the telegram token so we can resume after login
      sessionStorage.setItem('pending_tg_token', token);
      return;
    }

    completeLinking(token);
  }, []);

  async function completeLinking(token) {
    try {
      await api.telegramCompleteLink(token);
      setStatus('success');
      sessionStorage.removeItem('pending_tg_token');
      // After a short delay, go to home
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Failed to link your Telegram account.');
    }
  }

  if (status === 'processing') {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p>Linking your Telegram account...</p>
      </div>
    );
  }

  if (status === 'login_required') {
    return (
      <div style={styles.center}>
        <h2>Authentication Required</h2>
        <p>Please sign in to your TrustHandshake account to complete the linking process.</p>
        <button 
          style={styles.button}
          onClick={() => window.location.href = '/'}
        >
          Sign In
        </button>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={styles.center}>
        <h2 style={{ color: '#2ecc71' }}>✅ Account Linked</h2>
        <p>Your Telegram account has been successfully verified. You can now return to Telegram.</p>
        <p style={{ color: '#666', fontSize: '0.9rem' }}>Redirecting you home...</p>
      </div>
    );
  }

  return (
    <div style={styles.center}>
      <h2 style={{ color: '#e74c3c' }}>❌ Linking Failed</h2>
      <p>{error}</p>
      <button 
        style={styles.button}
        onClick={() => window.location.href = '/'}
      >
        Go Home
      </button>
    </div>
  );
}

const styles = {
  center: { maxWidth: 400, margin: '100px auto', fontFamily: 'system-ui, sans-serif', padding: '0 2rem', textAlign: 'center' },
  spinner: { width: 32, height: 32, border: '3px solid #eee', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' },
  button: { backgroundColor: '#111', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', marginTop: '20px' }
};
