# NAI Meet Extension

Chrome extension for in-meeting Google Meet verification.

## Load locally

1. Start the API, auth web app, and Meet panel locally or point them at production.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `extension/` folder.

## Local dev origins

The extension currently reads:

- Meet panel content script:
  - `https://meet.usenai.ca/*`
  - `http://localhost:5174/*`
- Hosted verification iframe:
  - `https://auth.usenai.ca`

To test the hosted verification route locally, change `resolveAuthOrigin()` in
`extension/lib/config.js` to return `http://localhost:5173`.

## Flow

1. The Meet side panel exposes active session state in the DOM.
2. The content script relays that state to the background worker.
3. The background worker opens an extension-owned popup window for the active Meet session.
4. The popup loads the existing `/#/meet/extension-auth` route in an iframe.
5. The hosted route starts the existing liveness + backend verification flow.
6. If the user leaves the bound Meet tab during an active attempt, the background worker invalidates the attempt.
