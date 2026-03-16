import { resolveAuthOrigin } from "../lib/config.js";

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sessionId");
const meetingCode = params.get("meetingCode");
const meetTabId = Number(params.get("meetTabId"));
const authOrigin = params.get("authOrigin") || resolveAuthOrigin();
const bootstrapToken = params.get("bootstrapToken");

const iframe = document.getElementById("auth-frame");
const statusNode = document.getElementById("status");
const bannerNode = document.getElementById("banner");

const port = chrome.runtime.connect({ name: "nai-meet-popup" });

function setStatus(text) {
  statusNode.textContent = text;
}

function showBanner(text) {
  bannerNode.textContent = text;
  bannerNode.hidden = !text;
}

function buildFrameUrl() {
  const query = new URLSearchParams({
    sessionId,
    meetingCode: meetingCode ?? "",
  });
  if (bootstrapToken) {
    query.set("bootstrapToken", bootstrapToken);
  }
  return `${authOrigin}/#/meet/extension-auth${query.toString() ? `?${query.toString()}` : ""}`;
}

port.postMessage({
  type: "nai-extension-popup-ready",
  sessionId,
  meetTabId,
});

port.onMessage.addListener((message) => {
  if (message?.type === "nai-extension-invalidated") {
    showBanner(
      message.reason ||
        "Verification invalidated because you left the Meet tab.",
    );
    setStatus("Invalidated");
    iframe.contentWindow?.postMessage(
      {
        type: "nai-extension-invalidated",
        reason: message.reason,
      },
      authOrigin,
    );
    return;
  }

  if (message?.type === "nai-extension-popup-state" && message.completed) {
    setStatus("Verified");
  }
});

window.addEventListener("message", (event) => {
  if (event.origin !== authOrigin) return;
  const { data } = event;
  if (!data?.type) return;

  if (data.type === "nai-extension-token-request") {
    void chrome.runtime
      .sendMessage({
        type: "nai-extension-token-request",
        authOrigin,
      })
      .then((response) => {
        iframe.contentWindow?.postMessage(
          {
            type: "nai-extension-token-response",
            token: response?.token || null,
          },
          authOrigin,
        );
      })
      .catch(() => {
        iframe.contentWindow?.postMessage(
          {
            type: "nai-extension-token-response",
            token: null,
          },
          authOrigin,
        );
      });
    return;
  }

  if (data.type === "nai-extension-attempt-started") {
    setStatus("Verifying");
    showBanner("");
    port.postMessage({
      type: "nai-extension-attempt-started",
      sessionId,
      meetTabId,
      attemptId: data.attemptId,
    });
    return;
  }

  if (data.type === "nai-extension-auth-succeeded") {
    setStatus("Verified");
    port.postMessage({
      type: "nai-extension-auth-succeeded",
      sessionId,
      meetTabId,
      verificationSource: data.verificationSource,
    });
    window.setTimeout(() => window.close(), 1500);
    return;
  }

  if (data.type === "nai-extension-auth-failed") {
    setStatus("Retry");
    showBanner(data.reason || "Verification failed. Restart from Meet.");
    port.postMessage({
      type: "nai-extension-auth-failed",
      sessionId,
      meetTabId,
      reason: data.reason,
    });
  }
});

iframe.src = buildFrameUrl();
setStatus("Ready");
