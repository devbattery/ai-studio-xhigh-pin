(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    allowManualOverride: true,
  };

  const storageArea = chrome.storage.sync || chrome.storage.local;

  const badgeEl = document.getElementById("status-badge");
  const modelEl = document.getElementById("model-value");
  const levelEl = document.getElementById("level-value");
  const hintEl = document.getElementById("status-hint");
  const enabledInput = document.getElementById("toggle-enabled");
  const overrideInput = document.getElementById("toggle-override");
  const pinNowBtn = document.getElementById("pin-now-btn");

  let activeTabId = null;
  let currentSettings = { ...DEFAULT_SETTINGS };

  function renderBadge(status) {
    badgeEl.className = "badge";
    if (!currentSettings.enabled) {
      badgeEl.classList.add("badge-paused");
      badgeEl.textContent = "Paused";
      return;
    }
    if (status && status.manualOverride) {
      badgeEl.classList.add("badge-override");
      badgeEl.textContent = "Manual";
      return;
    }
    badgeEl.classList.add("badge-active");
    badgeEl.textContent = "Active";
  }

  function renderStatus(status, fallbackMessage) {
    renderBadge(status);

    if (!status) {
      modelEl.textContent = "—";
      modelEl.className = "status-value muted";
      levelEl.textContent = "—";
      levelEl.className = "status-value muted";
      hintEl.textContent = fallbackMessage || "Open Google AI Studio to see live status.";
      pinNowBtn.disabled = true;
      return;
    }

    if (status.modelName) {
      modelEl.textContent = status.modelName;
      modelEl.className = "status-value";
    } else {
      modelEl.textContent = "—";
      modelEl.className = "status-value muted";
    }

    if (status.hasControl && status.currentLevel) {
      levelEl.textContent = status.currentLevel;
      levelEl.className = "status-value highlight";
      pinNowBtn.disabled = status.isDisabled;

      if (!currentSettings.enabled) {
        hintEl.textContent = "Auto-pin is paused. Click below to pin once.";
      } else if (status.manualOverride) {
        hintEl.textContent = "Respecting your manual choice for this chat.";
      } else {
        hintEl.textContent = "Automatically pinned to the highest available level.";
      }
    } else {
      levelEl.textContent = "Unavailable";
      levelEl.className = "status-value muted";
      pinNowBtn.disabled = true;
      hintEl.textContent =
        "No Thinking Level control detected (unsupported model or Run settings panel is closed).";
    }
  }

  function queryActiveTabStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        activeTabId = null;
        renderStatus(null, "Open Google AI Studio to see live status.");
        return;
      }

      const url = tab.url || "";
      if (url && !url.startsWith("https://aistudio.google.com/")) {
        activeTabId = null;
        renderStatus(null, "Open Google AI Studio to see live status.");
        return;
      }

      activeTabId = tab.id;
      chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          renderStatus(
            null,
            "Reload this AI Studio tab once after installing the extension."
          );
          return;
        }
        renderStatus(response.status);
      });
    });
  }

  storageArea.get(DEFAULT_SETTINGS, (items) => {
    currentSettings = {
      enabled: items.enabled !== false,
      allowManualOverride: items.allowManualOverride !== false,
    };
    enabledInput.checked = currentSettings.enabled;
    overrideInput.checked = currentSettings.allowManualOverride;
    renderBadge(null);
    queryActiveTabStatus();
  });

  enabledInput.addEventListener("change", () => {
    currentSettings.enabled = enabledInput.checked;
    storageArea.set({ enabled: currentSettings.enabled }, () => {
      setTimeout(queryActiveTabStatus, 80);
    });
  });

  overrideInput.addEventListener("change", () => {
    currentSettings.allowManualOverride = overrideInput.checked;
    storageArea.set({ allowManualOverride: currentSettings.allowManualOverride }, () => {
      setTimeout(queryActiveTabStatus, 80);
    });
  });

  pinNowBtn.addEventListener("click", () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { type: "PIN_MAX_NOW" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        queryActiveTabStatus();
        return;
      }
      renderStatus(response.status);
    });
  });
})();
