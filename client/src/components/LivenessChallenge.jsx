import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';
import { api } from '../lib/api.js';

let configuredIdentityPoolId = null;

export default function LivenessChallenge({ sessionId, onComplete, onError }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    api.publicConfig()
      .then((next) => {
        if (cancelled) return;
        if (!next.identityPoolId) {
          setError('Missing public Cognito identity pool configuration.');
          return;
        }
        if (configuredIdentityPoolId !== next.identityPoolId) {
          Amplify.configure({
            Auth: {
              Cognito: {
                identityPoolId: next.identityPoolId,
                allowGuestAccess: true,
              },
            },
          });
          configuredIdentityPoolId = next.identityPoolId;
        }
        setConfig(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load liveness configuration');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="surface-block surface-block--danger centered-state">
        <p>{error}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="surface-block centered-state">
        <div className="spinner" />
        <p className="page-copy">Preparing liveness challenge...</p>
      </div>
    );
  }

  return (
    <div className="liveness-stage surface-block">
      <FaceLivenessDetector
        sessionId={sessionId}
        region={config.awsRegion}
        onAnalysisComplete={onComplete}
        onError={(err) => onError(err?.state || 'Liveness check failed')}
      />
    </div>
  );
}
