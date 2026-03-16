(function () {
  const STORAGE_KEY = "naiAuthToken";

  function readToken() {
    try {
      return window.localStorage.getItem("th_token");
    } catch {
      return null;
    }
  }

  function syncToken() {
    try {
      const token = readToken();
      chrome.storage.local.set({ [STORAGE_KEY]: token || null });
    } catch {
      // Ignore storage sync issues in the content script.
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "nai-auth-token-request") return false;
    sendResponse({ token: readToken() });
    return true;
  });

  syncToken();
  window.addEventListener("storage", (event) => {
    if (event.key !== "th_token") return;
    syncToken();
  });
})();
