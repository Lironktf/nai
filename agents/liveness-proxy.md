# Liveness Proxy — Implementation Plan (Option A)

## Why this is needed

AWS Rekognition Face Liveness uses `@aws-sdk/client-rekognitionstreaming`, which requires
`fetch()` with a `ReadableStream` request body (HTTP/2 bidirectional streaming). This is
**not supported in WKWebView on iOS** (React Native's WebView engine). Every attempt to run
the `FaceLivenessDetector` web component inside a React Native WebView will fail with
`NetworkError` on iOS for this reason.

There is also no `FaceLivenessDetector` in `@aws-amplify/ui-react-native` v2.7.1 —
the native Amplify component simply does not exist.

The fix: move the Rekognition Streaming connection to the **server**, and have the WebView
communicate with the server over a plain **WebSocket** (which WKWebView supports fully).
The browser never touches AWS directly.

---

## Architecture

```
iPhone (WebView)                  Express server                  AWS Rekognition
─────────────────                 ──────────────                  ───────────────
1. Camera (getUserMedia)
2. WebSocket → /liveness-ws  →→→  ws.on('frame')
                                  SDK: StartFaceLivenessSession  →→→  streaming API
                                  ←←← challenge events           ←←←  challenge events
3. ←←← challenge events
4. Adjusts camera to challenge
5. WebSocket → frame data    →→→  ws.on('frame')                →→→  frame data
                                  ←←← SUCCEEDED / FAILED        ←←←  result
6. ←←← { done: true }
7. postMessage to native app
```

The Cognito Identity Pool is **no longer needed** for this approach. The server uses its
own IAM credentials (already configured via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).
The existing `/mobile/liveness/start` and `/mobile/liveness/complete` REST endpoints are also
no longer needed — the WebSocket handles everything.

---

## Current state of the codebase

| File | Current state | Needs to change? |
|------|--------------|------------------|
| `client/src/pages/LivenessPage.jsx` | Uses `FaceLivenessDetector` (broken on iOS) | Yes — full rewrite |
| `server/src/index.js` | Serves `/liveness` static page; has Socket.io | Yes — add WebSocket server on `/liveness-ws` |
| `server/src/lib/rekognition.js` | Has `createLivenessSession` + `getLivenessResult` | Partially reuse; add streaming proxy fn |
| `server/src/routes/mobile.js` | Has `/liveness/start` and `/liveness/complete` | Keep for backwards compat or remove |
| `mobile/app/verify.tsx` | Passes `sessionId` + params to WebView URL | Minor change — drop Cognito params |
| `mobile/app/test-face.tsx` | Same WebView pattern | Minor change |
| `mobile/.env` | Has `EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID` | No longer needed once proxy works |

---

## Step-by-step implementation

### Step 1 — Install `ws` on the server

```bash
cd server && npm install ws
```

`ws` is a lightweight WebSocket server for Node.js. Socket.io is already running but it's
overkill for a binary frame proxy.

---

### Step 2 — Add the WebSocket proxy to `server/src/index.js`

After the existing Socket.io setup, add a raw `ws` WebSocket server attached to the same
`httpServer` but on a separate path (`/liveness-ws`).

```js
// server/src/index.js  (additions)
import { WebSocketServer } from 'ws';
import { startLivenessProxy } from './lib/livenessProxy.js';

// Mount on the same httpServer, separate path from Socket.io
const livenessWss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/liveness-ws')) {
    livenessWss.handleUpgrade(req, socket, head, (ws) => {
      livenessWss.emit('connection', ws, req);
    });
    // All other upgrade requests go to Socket.io
  }
});

livenessWss.on('connection', (ws, req) => {
  // Extract sessionId from query string: /liveness-ws?sessionId=xxx&token=JWT
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  const authToken = url.searchParams.get('token');

  // Verify JWT (reuse existing jwt lib)
  // Then call startLivenessProxy(ws, sessionId)
  startLivenessProxy(ws, sessionId);
});
```

---

### Step 3 — Create `server/src/lib/livenessProxy.js`

This is the core of the implementation. It opens a Rekognition Streaming session and
proxies frames between the browser WebSocket and AWS.

```js
// server/src/lib/livenessProxy.js
import {
  RekognitionStreamingClient,
  StartFaceLivenessSessionCommand,
} from '@aws-sdk/client-rekognitionstreaming';

export async function startLivenessProxy(browserWs, sessionId) {
  const client = new RekognitionStreamingClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

  // inputStream: async generator that yields video events from browser frames
  // outputStream: async iterable of server events (challenges, results)

  let resolveNextFrame;
  const frameQueue = [];

  browserWs.on('message', (data) => {
    // Browser sends binary video frames
    if (resolveNextFrame) {
      resolveNextFrame(data);
      resolveNextFrame = null;
    } else {
      frameQueue.push(data);
    }
  });

  async function* videoFrameGenerator() {
    while (true) {
      const frame = await new Promise((resolve) => {
        if (frameQueue.length > 0) {
          resolve(frameQueue.shift());
        } else {
          resolveNextFrame = resolve;
        }
      });
      if (frame === null) break; // sentinel — browser disconnected
      yield {
        VideoEvent: {
          VideoChunk: frame,
          TimestampMillis: Date.now(),
        },
      };
    }
  }

  try {
    const command = new StartFaceLivenessSessionCommand({
      SessionId: sessionId,
      VideoWidth: '320',
      VideoHeight: '240',
      ChallengeVersions: 'FaceMovementAndLightChallenge_1.0.0',
      LivenessRequestStream: videoFrameGenerator(),
    });

    const response = await client.send(command);

    for await (const event of response.LivenessResponseStream) {
      if (event.ServerSessionInformationEvent) {
        browserWs.send(JSON.stringify({ type: 'session_info', data: event.ServerSessionInformationEvent }));
      } else if (event.FaceMovementAndLightClientChallenge) {
        browserWs.send(JSON.stringify({ type: 'challenge', data: event.FaceMovementAndLightClientChallenge }));
      } else if (event.DisconnectionEvent) {
        browserWs.send(JSON.stringify({ type: 'done' }));
        break;
      }
    }
  } catch (err) {
    browserWs.send(JSON.stringify({ type: 'error', message: err.message }));
  } finally {
    browserWs.close();
  }
}
```

Install the streaming SDK:
```bash
cd server && npm install @aws-sdk/client-rekognitionstreaming
```

---

### Step 4 — Rewrite `client/src/pages/LivenessPage.jsx`

Replace the Amplify `FaceLivenessDetector` with a custom React component that:
1. Opens `getUserMedia` for camera
2. Connects to `wss://[server]/liveness-ws?sessionId=...&token=...`
3. Streams `VideoFrame` data (via `canvas.captureStream` + `MediaRecorder`)
4. Renders the challenge overlay (oval guide, lighting cues)
5. On `{ type: 'done' }`, calls `postToNative({ done: true })`

```jsx
// client/src/pages/LivenessPage.jsx  (rough structure)
import { useEffect, useRef, useState } from 'react';

export default function LivenessPage() {
  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting | challenge | done | error

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    const token = params.get('token');
    const wsBase = params.get('wsUrl'); // wss://[cloudflare-url]

    // 1. Get camera
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        videoRef.current.srcObject = stream;

        // 2. Open WebSocket to server proxy
        const ws = new WebSocket(`${wsBase}/liveness-ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}`);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        // 3. Start sending frames via MediaRecorder
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        recorder.ondataavailable = (e) => {
          if (ws.readyState === WebSocket.OPEN && e.data.size > 0) {
            ws.send(e.data);
          }
        };

        ws.onopen = () => {
          recorder.start(100); // 100ms chunks
          setStatus('challenge');
        };

        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'done') {
            recorder.stop();
            stream.getTracks().forEach(t => t.stop());
            postToNative({ done: true });
          } else if (msg.type === 'error') {
            postToNative({ error: msg.message });
          } else if (msg.type === 'challenge') {
            // TODO: render challenge overlay (oval position, lighting)
          }
        };

        ws.onerror = () => postToNative({ error: 'WebSocket connection failed' });
      })
      .catch(err => postToNative({ error: `Camera error: ${err.message}` }));

    return () => { wsRef.current?.close(); };
  }, []);

  return (
    <div style={{ height: '100vh', background: '#000', position: 'relative' }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* TODO: challenge overlay — oval face guide, lighting indicators */}
    </div>
  );
}
```

---

### Step 5 — Update the mobile WebView URL

The WebView URL needs to pass a `wsUrl` and a JWT `token` (for WebSocket auth) instead of Cognito params.

In `mobile/app/verify.tsx` and `mobile/app/test-face.tsx`, change:
```ts
// OLD
const livenessUrl =
  `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
  `?sessionId=${livenessSessionId}` +
  `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? '')}` +
  `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1'}`;

// NEW
const token = await getToken(); // from mobile/lib/storage.ts
const wsUrl = process.env.EXPO_PUBLIC_API_URL?.replace('https://', 'wss://').replace('http://', 'ws://');
const livenessUrl =
  `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
  `?sessionId=${livenessSessionId}` +
  `&token=${encodeURIComponent(token ?? '')}` +
  `&wsUrl=${encodeURIComponent(wsUrl ?? '')}`;
```

---

### Step 6 — Update `server/src/index.js` upgrade handler

Socket.io already handles WebSocket upgrades on `/socket.io/`. The `upgrade` event needs
to be split so Socket.io handles its path and `ws` handles `/liveness-ws`:

```js
// Make sure Socket.io does NOT handle /liveness-ws upgrades
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/liveness-ws')) {
    livenessWss.handleUpgrade(req, socket, head, (ws) => {
      livenessWss.emit('connection', ws, req);
    });
  }
  // Socket.io handles everything else automatically
});
```

---

### Step 7 — Remove Cognito dependency

Once working:
- Remove `EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID` from `mobile/.env` and `.env.example`
- Delete the `live-rekognition` Cognito Identity Pool (optional)
- Remove `Amplify.configure` from `client/src/pages/LivenessPage.jsx`
- Remove `@aws-amplify/ui-react-liveness` from `client/package.json`
- The `_layout.tsx` `Amplify.configure` block can also be removed

---

## Key challenges to expect

### Challenge frames format
The `@aws-sdk/client-rekognitionstreaming` expects video events with specific structure.
`MediaRecorder` outputs WebM chunks which may need to be converted. Check the Rekognition
Streaming API docs for the exact `VideoEvent` byte format expected.

### Challenge UI
The `FaceLivenessDetector` web component renders an oval guide and lighting flash overlays.
The custom implementation needs to replicate this. The challenge data from Rekognition
includes oval position (`OvalParameters`) and lighting (`ColorDisplayed`). This is documented
in the `FaceMovementAndLightClientChallenge` event type in the Rekognition API docs.

### WebSocket auth
The `token` query param approach is acceptable for dev. For production, use a short-lived
signed URL or pass the token in the first WebSocket message instead of the URL.

### Cloudflare tunnel WebSocket support
Cloudflare tunnels support WebSocket (`wss://`). The existing Socket.io connections already
prove this. The liveness WebSocket will work the same way.

---

## Files to create/modify summary

| Action | File |
|--------|------|
| Modify | `server/src/index.js` — add WebSocket upgrade handler + livenessWss |
| Create | `server/src/lib/livenessProxy.js` — the streaming proxy |
| Modify | `client/src/pages/LivenessPage.jsx` — full rewrite, custom camera UI |
| Modify | `mobile/app/verify.tsx` — update livenessUrl construction |
| Modify | `mobile/app/test-face.tsx` — update livenessUrl construction |
| Install | `server`: `ws`, `@aws-sdk/client-rekognitionstreaming` |
| Remove | `client`: `@aws-amplify/ui-react-liveness`, `@aws-amplify/ui-react` |

---

## Testing checklist

- [ ] WebSocket connection opens from WebView (`ws.onopen` fires)
- [ ] Camera stream starts and frames are sent to server
- [ ] Server receives frames and forwards to Rekognition
- [ ] Challenge events arrive back in the browser
- [ ] `postToNative({ done: true })` fires on success
- [ ] `livenessComplete` server route still works (fetches Rekognition result + face match)
- [ ] End-to-end: verify flow completes in `verify.tsx`
