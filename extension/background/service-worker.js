import { resolveAuthOrigin } from "../lib/config.js";

const stateByMeetTab = new Map();
const bindingsByKey = new Map();
const bindingsByPopupTab = new Map();
const AUTH_TOKEN_STORAGE_KEY = "naiAuthToken";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const state = stateByMeetTab.get(tab.id);
  if (!state?.sessionId || state.sessionStatus !== "active") return;
  await ensurePopupForState(tab.id, state, { force: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "nai-meet-state") {
    void handleMeetState(message.payload, sender);
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "nai-open-extension-popup") {
    void handlePopupOpenRequest(message.payload, sender);
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "nai-extension-token-request") {
    void lookupAuthToken(message.authOrigin)
      .then((token) => sendResponse?.({ token: token || null }))
      .catch(() => sendResponse?.({ token: null }));
    return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "nai-meet-popup") return;

  port.onMessage.addListener((message) => {
    void handlePopupMessage(port, message);
  });

  port.onDisconnect.addListener(() => {
    for (const binding of bindingsByKey.values()) {
      if (binding.port === port) {
        binding.port = null;
      }
    }
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  for (const binding of bindingsByKey.values()) {
    if (!binding.attemptId || binding.invalidated || binding.completed)
      continue;
    if (tabId === binding.meetTabId || tabId === binding.popupTabId) continue;
    await invalidateBinding(
      binding,
      "Verification invalidated because you left the Meet tab.",
    );
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  for (const binding of bindingsByKey.values()) {
    if (!binding.attemptId || binding.invalidated || binding.completed)
      continue;
    if (
      windowId === binding.meetWindowId ||
      windowId === binding.popupWindowId
    ) {
      continue;
    }
    await invalidateBinding(
      binding,
      "Verification invalidated because you left the Meet window.",
    );
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const bindingKey = bindingsByPopupTab.get(tabId);
  if (bindingKey) {
    const binding = bindingsByKey.get(bindingKey);
    if (binding?.attemptId && !binding.completed && !binding.invalidated) {
      await invalidateBinding(
        binding,
        "Verification cancelled before completion.",
      );
    }
    if (binding) {
      binding.popupTabId = null;
      binding.popupWindowId = null;
      binding.port = null;
    }
    bindingsByPopupTab.delete(tabId);
  }

  for (const [key, binding] of bindingsByKey.entries()) {
    if (binding.meetTabId === tabId) {
      bindingsByKey.delete(key);
      if (binding.popupTabId) bindingsByPopupTab.delete(binding.popupTabId);
      stateByMeetTab.delete(tabId);
    }
  }
});

function getBindingKey(meetTabId, sessionId) {
  return `${meetTabId}:${sessionId}`;
}

async function handleMeetState(payload, sender) {
  const meetTabId = sender.tab?.id;
  if (!meetTabId || !payload) return;

  const nextState = {
    ...payload,
    meetTabId,
    meetWindowId: sender.tab?.windowId ?? null,
    updatedAt: Date.now(),
  };
  stateByMeetTab.set(meetTabId, nextState);

  if (!payload.sessionId || payload.sessionStatus !== "active") {
    clearBindingsForTab(meetTabId);
    return;
  }

  await ensurePopupForState(meetTabId, nextState);
}

async function handlePopupOpenRequest(payload, sender) {
  const meetTabId = sender.tab?.id;
  if (!meetTabId) return;

  const existing = stateByMeetTab.get(meetTabId);
  const nextState = {
    ...(existing ?? {}),
    ...(payload ?? {}),
    meetTabId,
    meetWindowId: sender.tab?.windowId ?? null,
    updatedAt: Date.now(),
  };

  stateByMeetTab.set(meetTabId, nextState);

  if (!nextState.sessionId || nextState.sessionStatus !== "active") return;
  await ensurePopupForState(meetTabId, nextState, { force: true });
}

async function ensurePopupForState(meetTabId, state, options = {}) {
  const key = getBindingKey(meetTabId, state.sessionId);
  let binding = bindingsByKey.get(key);

  if (!binding) {
    binding = {
      key,
      meetTabId,
      meetWindowId: state.meetWindowId,
      sessionId: state.sessionId,
      meetingCode: state.meetingCode,
      popupTabId: null,
      popupWindowId: null,
      port: null,
      attemptId: null,
      opened: false,
      completed: false,
      invalidated: false,
      lastTriggeredReverifyAt: null,
    };
    bindingsByKey.set(key, binding);
  } else {
    binding.meetWindowId = state.meetWindowId;
    binding.meetingCode = state.meetingCode;
  }

  if (
    binding.completed &&
    state.reverifyAt &&
    Number.isFinite(Date.parse(state.reverifyAt)) &&
    Date.parse(state.reverifyAt) <= Date.now() &&
    binding.lastTriggeredReverifyAt !== state.reverifyAt
  ) {
    binding.completed = false;
    binding.opened = false;
    binding.lastTriggeredReverifyAt = state.reverifyAt;
  }

  if (binding.completed && !options.force) return;

  const popupStillOpen = await isPopupTabOpen(binding.popupTabId);
  if (popupStillOpen) return;

  if (binding.opened && !options.force) return;

  const popupUrl = new URL(chrome.runtime.getURL("popup/index.html"));
  popupUrl.searchParams.set("sessionId", state.sessionId);
  popupUrl.searchParams.set("meetingCode", state.meetingCode ?? "");
  popupUrl.searchParams.set("meetTabId", String(meetTabId));
  const authOrigin = resolveAuthOrigin();
  popupUrl.searchParams.set("authOrigin", authOrigin);
  const bootstrapToken = await lookupAuthToken(authOrigin);
  if (bootstrapToken) {
    popupUrl.searchParams.set("bootstrapToken", bootstrapToken);
  }

  // Chrome does not let extensions programmatically open the action popup itself,
  // so we open a dedicated extension-owned popup window as the closest in-flow behavior.
  const popupWindow = await chrome.windows.create({
    url: popupUrl.toString(),
    type: "popup",
    width: 420,
    height: 760,
    focused: true,
  });

  const tabs = await chrome.tabs.query({ windowId: popupWindow.id });
  const popupTabId = tabs[0]?.id ?? null;

  binding.popupWindowId = popupWindow.id ?? null;
  binding.popupTabId = popupTabId;
  binding.opened = true;
  binding.invalidated = false;

  if (popupTabId) {
    bindingsByPopupTab.set(popupTabId, key);
  }
}

async function handlePopupMessage(port, message) {
  if (message?.type === "nai-extension-popup-ready") {
    const key = getBindingKey(message.meetTabId, message.sessionId);
    const binding = bindingsByKey.get(key);
    if (!binding) return;
    binding.port = port;
    port.postMessage({
      type: "nai-extension-popup-state",
      invalidated: Boolean(binding.invalidated),
      completed: Boolean(binding.completed),
    });
    return;
  }

  if (message?.type === "nai-extension-attempt-started") {
    const key = getBindingKey(message.meetTabId, message.sessionId);
    const binding = bindingsByKey.get(key);
    if (!binding) return;
    binding.attemptId = message.attemptId;
    binding.invalidated = false;
    return;
  }

  if (message?.type === "nai-extension-auth-succeeded") {
    const key = getBindingKey(message.meetTabId, message.sessionId);
    const binding = bindingsByKey.get(key);
    if (!binding) return;
    binding.completed = true;
    binding.invalidated = false;
    binding.attemptId = null;
    return;
  }

  if (message?.type === "nai-extension-auth-failed") {
    const key = getBindingKey(message.meetTabId, message.sessionId);
    const binding = bindingsByKey.get(key);
    if (!binding) return;
    binding.attemptId = null;
    binding.opened = false;
    return;
  }
}

async function invalidateBinding(binding, reason) {
  if (binding.invalidated) return;
  binding.invalidated = true;
  binding.attemptId = null;
  if (binding.port) {
    binding.port.postMessage({
      type: "nai-extension-invalidated",
      reason,
    });
  }
}

async function isPopupTabOpen(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return Boolean(tab);
  } catch {
    return false;
  }
}

function clearBindingsForTab(meetTabId) {
  for (const [key, binding] of bindingsByKey.entries()) {
    if (binding.meetTabId !== meetTabId) continue;
    if (binding.popupTabId) bindingsByPopupTab.delete(binding.popupTabId);
    bindingsByKey.delete(key);
  }
}

async function lookupAuthToken(authOrigin) {
  const tabs = await chrome.tabs.query({ url: `${authOrigin}/*` });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "nai-auth-token-request",
      });
      if (response?.token) return response.token;
    } catch {
      // Ignore tabs where the auth bridge is not ready yet.
    }
  }

  const stored = await chrome.storage.local.get(AUTH_TOKEN_STORAGE_KEY);
  return stored?.[AUTH_TOKEN_STORAGE_KEY] || null;
}
