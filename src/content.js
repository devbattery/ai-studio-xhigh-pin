(() => {
  "use strict";

  const api = globalThis.AiStudioXHighPin;
  if (!api) return;

  // Prevent duplicate initialization if injected more than once.
  if (globalThis.__aiStudioXHighPinInitialized) return;
  globalThis.__aiStudioXHighPinInitialized = true;

  const storageArea =
    typeof chrome !== "undefined" && chrome.storage
      ? chrome.storage.sync || chrome.storage.local
      : null;

  const controller = api.createPinController({
    document,
    getLocation: () => window.location,
    KeyboardEvent: window.KeyboardEvent,
    Event: window.Event,
  });

  let syncScheduled = false;
  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    const run = () => {
      syncScheduled = false;
      controller.syncContext();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  // Observe DOM mutations for SPA navigation, model switching, panel open/close,
  // and Angular asynchronous resets of the Thinking Level dropdown.
  const observer = new MutationObserver(() => {
    scheduleSync();
  });

  function startObserving() {
    const target = document.body || document.documentElement;
    if (!target) return;
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "aria-disabled", "class"],
    });
  }

  // Capture-phase listeners distinguish real user interaction (isTrusted === true)
  // from our own synthetic End key events (isTrusted === false).
  document.addEventListener(
    "pointerdown",
    (event) => controller.noteTrustedInteraction(event),
    true
  );
  document.addEventListener(
    "click",
    (event) => {
      if (event.isTrusted && api.isResetTriggerTarget(event.target)) {
        controller.noteTrustedInteraction(event);
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => controller.noteTrustedInteraction(event),
    true
  );

  window.addEventListener("popstate", scheduleSync);
  window.addEventListener("hashchange", scheduleSync);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleSync();
    }
  });

  let started = false;
  function start() {
    if (started) return;
    started = true;
    startObserving();
    scheduleSync();
  }

  // Load saved preferences before first pin so a disabled state is respected
  // immediately on page load, and react to live changes from the popup.
  if (storageArea) {
    storageArea.get(api.DEFAULT_SETTINGS, (items) => {
      if (!(chrome.runtime && chrome.runtime.lastError) && items) {
        controller.updateSettings(items);
      }
      start();
    });

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        const patch = {};
        if (changes.enabled && typeof changes.enabled.newValue === "boolean") {
          patch.enabled = changes.enabled.newValue;
        }
        if (
          changes.allowManualOverride &&
          typeof changes.allowManualOverride.newValue === "boolean"
        ) {
          patch.allowManualOverride = changes.allowManualOverride.newValue;
        }
        if (Object.keys(patch).length > 0) {
          controller.updateSettings(patch);
        }
      });
    }
  } else {
    start();
  }

  // Respond to status queries and manual pin requests from the extension popup.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return false;

      if (message.type === "GET_STATUS") {
        sendResponse({ ok: true, status: controller.getStatus() });
        return false;
      }

      if (message.type === "PIN_MAX_NOW") {
        const result = controller.forcePinNow();
        sendResponse({ ok: true, result, status: controller.getStatus() });
        return false;
      }

      return false;
    });
  }
})();
