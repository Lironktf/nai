(function () {
  const ATTRIBUTES = [
    "data-nai-extension-ready",
    "data-nai-meeting-code",
    "data-nai-meet-session-id",
    "data-nai-meet-session-status",
    "data-nai-meet-reverify-at",
    "data-nai-meet-updated-at",
  ];

  let lastFingerprint = "";

  function readState() {
    const root = document.documentElement;
    return {
      ready: root.dataset.naiExtensionReady === "true",
      meetingCode: root.dataset.naiMeetingCode || "",
      sessionId: root.dataset.naiMeetSessionId || "",
      sessionStatus: root.dataset.naiMeetSessionStatus || "",
      reverifyAt: root.dataset.naiMeetReverifyAt || "",
      pageUrl: window.location.href,
    };
  }

  function pushState(reason) {
    const payload = readState();
    const fingerprint = JSON.stringify(payload);
    if (fingerprint === lastFingerprint && reason !== "heartbeat") return;
    lastFingerprint = fingerprint;
    try {
      chrome.runtime.sendMessage(
        {
          type: "nai-meet-state",
          payload,
          reason,
        },
        () => {
          const runtimeError = chrome.runtime.lastError;
          if (!runtimeError) return;
          if (
            runtimeError.message?.includes("Receiving end does not exist") ||
            runtimeError.message?.includes("Extension context invalidated")
          ) {
            return;
          }
          console.warn(
            "[nai-extension] meet state relay failed:",
            runtimeError,
          );
        },
      );
    } catch (error) {
      if (
        String(error?.message || error).includes(
          "Extension context invalidated",
        )
      ) {
        return;
      }
      console.warn("[nai-extension] unexpected meet relay failure:", error);
    }
  }

  function requestPopupOpen() {
    try {
      chrome.runtime.sendMessage(
        {
          type: "nai-open-extension-popup",
          payload: readState(),
        },
        () => {
          const runtimeError = chrome.runtime.lastError;
          if (!runtimeError) return;
          if (
            runtimeError.message?.includes("Receiving end does not exist") ||
            runtimeError.message?.includes("Extension context invalidated")
          ) {
            return;
          }
          console.warn(
            "[nai-extension] popup open relay failed:",
            runtimeError,
          );
        },
      );
    } catch (error) {
      if (
        String(error?.message || error).includes(
          "Extension context invalidated",
        )
      ) {
        return;
      }
      console.warn("[nai-extension] unexpected popup relay failure:", error);
    }
  }

  const observer = new MutationObserver(() => pushState("mutation"));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });

  pushState("init");
  window.addEventListener("load", () => {
    window.setTimeout(() => pushState("load"), 250);
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "nai-open-extension-popup") return;
    requestPopupOpen();
  });
  window.setInterval(() => pushState("heartbeat"), 5000);
})();
