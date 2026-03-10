import { Amplify } from 'aws-amplify';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sessionId');
const identityPoolId = params.get('identityPoolId');
const region = params.get('region') || 'us-east-1';

if (identityPoolId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        identityPoolId,
        allowGuestAccess: true,
      },
    },
  });
}

function postToNative(data) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
}

export default function LivenessPage() {
  if (!sessionId || !identityPoolId) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui', color: '#c00' }}>
        Missing required params: sessionId and identityPoolId must be provided.
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', margin: 0 }}>
      <FaceLivenessDetector
        sessionId={sessionId}
        region={region}
        onAnalysisComplete={() => postToNative({ done: true })}
        onError={(err) => postToNative({ error: err.state ?? 'Liveness check failed' })}
      />
    </div>
  );
}
