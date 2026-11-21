(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AiStudioXHighPin = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    allowManualOverride: true,
  });

  const STABILIZATION_DELAYS_MS = Object.freeze([50, 200, 500, 1000, 2000]);
  const MAX_PINS_PER_CONTEXT = 12;
  const USER_INTERACTION_GRACE_MS = 2500;

  const THINKING_CONTROL_SELECTORS = Object.freeze([
    'ms-thinking-level-setting mat-select[role="combobox"]',
    "ms-thinking-level-setting mat-select",
    "ms-thinking-level-setting select",
    'mat-select[aria-label="Thinking Level" i]',
    'mat-select[aria-label*="thinking" i]',
    '[role="combobox"][aria-label*="thinking" i]',
  ]);

  const SELECTION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Enter",
    " ",
  ]);

  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function findThinkingLevelControl(doc) {
    if (!doc || typeof doc.querySelector !== "function") {
      return null;
    }
    for (const selector of THINKING_CONTROL_SELECTORS) {
      try {
        const el = doc.querySelector(selector);
        if (el) {
          return el;
        }
      } catch (_err) {
        // Ignore unsupported selector flags in non-browser DOM shims.
      }
    }
    return null;
  }

  function isControlDisabled(control) {
    if (!control) return true;
    if (control.disabled === true) return true;
    if (
      typeof control.getAttribute === "function" &&
      control.getAttribute("aria-disabled") === "true"
    ) {
      return true;
    }
    if (
      typeof control.hasAttribute === "function" &&
      control.hasAttribute("disabled")
    ) {
      return true;
    }
    if (
      control.classList &&
      typeof control.classList.contains === "function" &&
      control.classList.contains("mat-mdc-select-disabled")
    ) {
      return true;
    }
    return false;
  }

  function isControlExpanded(control) {
    if (!control) return false;
    if (
      typeof control.getAttribute === "function" &&
      control.getAttribute("aria-expanded") === "true"
    ) {
      return true;
    }
    if (
      control.classList &&
      typeof control.classList.contains === "function" &&
      control.classList.contains("mat-select-open")
    ) {
      return true;
    }
    return false;
  }

  function getCurrentThinkingLevel(control) {
    if (!control) return "";
    if (String(control.tagName || "").toUpperCase() === "SELECT") {
      const idx = control.selectedIndex;
      const opt = control.options && idx >= 0 ? control.options[idx] : null;
      return normalizeText(opt ? opt.textContent || opt.label || opt.value : control.value);
    }
    if (typeof control.querySelector === "function") {
      const valueEl =
        control.querySelector(".mat-mdc-select-min-line") ||
        control.querySelector(".mat-mdc-select-value-text");
      if (valueEl) {
        return normalizeText(valueEl.textContent);
      }
    }
    return normalizeText(control.textContent);
  }

  function getCurrentModelName(doc, loc) {
    if (doc && typeof doc.querySelector === "function") {
      const el = doc.querySelector('[data-test-id="model-name"]');
      const fromDom = normalizeText(el && el.textContent);
      if (fromDom) return fromDom;
    }
    if (loc && typeof loc.search === "string" && loc.search) {
      try {
        const params = new URLSearchParams(loc.search);
        const fromUrl = normalizeText(params.get("model"));
        if (fromUrl) return fromUrl;
      } catch (_err) {
        // Ignore malformed search query.
      }
    }
    return "";
  }

  function buildContextKey({ pathname = "", search = "", modelName = "", resetEpoch = 0 }) {
    return `${pathname}${search}|${modelName}|${resetEpoch}`;
  }

  function asElement(node) {
    if (!node) return null;
    if (node.nodeType === 1 || typeof node.closest === "function") {
      return node;
    }
    return node.parentElement || null;
  }

  function isResetTriggerTarget(target) {
    const el = asElement(target);
    if (!el || typeof el.closest !== "function") return false;
    try {
      return Boolean(
        el.closest('button[aria-label="Reset default settings" i]') ||
          el.closest('button[aria-label="New chat" i]')
      );
    } catch (_err) {
      // Fallback for case-sensitive selector environments (e.g. unit test mocks)
      const btn = el.closest("button");
      if (!btn || typeof btn.getAttribute !== "function") return false;
      const aria = normalizeText(btn.getAttribute("aria-label")).toLowerCase();
      return aria === "reset default settings" || aria === "new chat";
    }
  }

  function isThinkingOptionTarget(target, control) {
    const el = asElement(target);
    if (!el || typeof el.closest !== "function") return false;
    const option = el.closest('mat-option, [role="option"]');
    if (!option) return false;
    if (control && typeof control.contains === "function" && control.contains(option)) {
      return true;
    }
    const listbox = option.closest('[role="listbox"]');
    if (!listbox) return false;
    if (control && control.id && listbox.id === `${control.id}-panel`) {
      return true;
    }
    const aria = normalizeText(
      typeof listbox.getAttribute === "function" ? listbox.getAttribute("aria-label") : ""
    ).toLowerCase();
    return aria.includes("thinking");
  }

  function isThinkingInteractionTarget(target, control) {
    const el = asElement(target);
    if (!el) return false;
    if (control && typeof control.contains === "function" && control.contains(el)) {
      return true;
    }
    if (typeof el.closest === "function") {
      if (el.closest("ms-thinking-level-setting")) {
        return true;
      }
      const listbox = el.closest('[role="listbox"]');
      if (listbox) {
        if (control && control.id && listbox.id === `${control.id}-panel`) {
          return true;
        }
        const aria = normalizeText(
          typeof listbox.getAttribute === "function" ? listbox.getAttribute("aria-label") : ""
        ).toLowerCase();
        if (aria.includes("thinking")) {
          return true;
        }
      }
    }
    return false;
  }

  function isSelectionChangingKey(key) {
    if (typeof key !== "string" || !key) return false;
    if (SELECTION_KEYS.has(key)) return true;
    return key.length === 1;
  }

  function selectHighestOption(control, env) {
    if (!control) {
      return { dispatched: false, method: "none", before: "", after: "", changed: false };
    }

    const before = getCurrentThinkingLevel(control);

    if (String(control.tagName || "").toUpperCase() === "SELECT") {
      const options = Array.from(control.options || []);
      let lastEnabledIdx = -1;
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) {
          lastEnabledIdx = i;
          break;
        }
      }
      if (lastEnabledIdx < 0) {
        return { dispatched: false, method: "native-select", before, after: before, changed: false };
      }
      if (control.selectedIndex !== lastEnabledIdx) {
        control.selectedIndex = lastEnabledIdx;
        const EventCtor = (env && env.Event) || (typeof Event !== "undefined" ? Event : null);
        if (EventCtor && typeof control.dispatchEvent === "function") {
          control.dispatchEvent(new EventCtor("input", { bubbles: true }));
          control.dispatchEvent(new EventCtor("change", { bubbles: true }));
        }
      }
      const after = getCurrentThinkingLevel(control);
      return {
        dispatched: true,
        method: "native-select",
        before,
        after,
        changed: before !== after,
      };
    }

    const KeyboardEventCtor =
      (env && env.KeyboardEvent) ||
      (typeof KeyboardEvent !== "undefined" ? KeyboardEvent : null);

    if (!KeyboardEventCtor || typeof control.dispatchEvent !== "function") {
      return { dispatched: false, method: "end-key", before, after: before, changed: false };
    }

    // Angular Material MatSelect handles End keydown while closed by jumping
    // directly to the last enabled MatOption without opening the overlay or
    // stealing keyboard focus from the prompt textarea.
    const endEvent = new KeyboardEventCtor("keydown", {
      key: "End",
      code: "End",
      keyCode: 35,
      which: 35,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    control.dispatchEvent(endEvent);
    const after = getCurrentThinkingLevel(control);
    return {
      dispatched: true,
      method: "end-key",
      before,
      after,
      changed: before !== after,
    };
  }

  function createPinController(deps) {
    const doc = deps.document;
    const getLocation = deps.getLocation || (() => ({ pathname: "", search: "" }));
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimeout || ((id) => clearTimeout(id));
    const eventEnv = {
      KeyboardEvent: deps.KeyboardEvent,
      Event: deps.Event,
    };
    const stabilizationDelays = deps.stabilizationDelays || STABILIZATION_DELAYS_MS;
    const maxPinsPerContext = deps.maxPinsPerContext || MAX_PINS_PER_CONTEXT;
    const onStateChange = typeof deps.onStateChange === "function" ? deps.onStateChange : null;

    const state = {
      settings: {
        enabled: DEFAULT_SETTINGS.enabled,
        allowManualOverride: DEFAULT_SETTINGS.allowManualOverride,
      },
      resetEpoch: 0,
      contextKey: "",
      lastControl: null,
      manualOverride: false,
      lastPinnedLevel: "",
      lastUserInteractionAt: null,
      pinsInCurrentContext: 0,
      timers: [],
    };

    function notify() {
      if (onStateChange) {
        onStateChange(getStatus());
      }
    }

    function clearTimers() {
      while (state.timers.length > 0) {
        clearTimer(state.timers.pop());
      }
    }

    function attemptPin(reason, options = {}) {
      const ignoreEnabled = Boolean(options.ignoreEnabled);
      if (!ignoreEnabled && !state.settings.enabled) {
        return { ok: false, reason: "disabled" };
      }

      const control = findThinkingLevelControl(doc);
      if (!control) {
        return { ok: false, reason: "no-control" };
      }
      if (isControlDisabled(control)) {
        return { ok: false, reason: "control-disabled" };
      }
      if (isControlExpanded(control)) {
        return { ok: false, reason: "control-expanded" };
      }
      if (!options.ignoreOverride && state.manualOverride && state.settings.allowManualOverride) {
        return { ok: false, reason: "manual-override" };
      }
      if (!options.ignoreLimit && state.pinsInCurrentContext >= maxPinsPerContext) {
        return { ok: false, reason: "max-attempts" };
      }

      const result = selectHighestOption(control, eventEnv);
      if (!result.dispatched) {
        return { ok: false, reason: "dispatch-failed" };
      }

      state.pinsInCurrentContext += 1;
      if (result.after) {
        state.lastPinnedLevel = result.after;
      }
      notify();
      return {
        ok: true,
        reason,
        method: result.method,
        before: result.before,
        after: result.after,
        changed: result.changed,
      };
    }

    function startStabilizationBurst(expectedContextKey) {
      clearTimers();
      if (!state.settings.enabled) return;

      for (const delay of stabilizationDelays) {
        const id = setTimer(() => {
          state.timers = state.timers.filter((t) => t !== id);
          if (!state.settings.enabled) return;
          if (state.contextKey !== expectedContextKey) return;
          if (state.manualOverride && state.settings.allowManualOverride) return;
          attemptPin(`stabilize-${delay}ms`);
        }, delay);
        state.timers.push(id);
      }
    }

    function syncContext() {
      const control = findThinkingLevelControl(doc);
      const loc = getLocation() || { pathname: "", search: "" };
      const modelName = getCurrentModelName(doc, loc);
      const nextKey = buildContextKey({
        pathname: loc.pathname || "",
        search: loc.search || "",
        modelName,
        resetEpoch: state.resetEpoch,
      });

      const contextChanged = nextKey !== state.contextKey;
      const controlRemounted = Boolean(control && control !== state.lastControl);

      if (contextChanged || controlRemounted) {
        state.contextKey = nextKey;
        state.lastControl = control;
        state.manualOverride = false;
        state.lastPinnedLevel = "";
        state.lastUserInteractionAt = null;
        state.pinsInCurrentContext = 0;
        clearTimers();

        if (control && state.settings.enabled) {
          const immediate = attemptPin("context-change");
          startStabilizationBurst(nextKey);
          return immediate;
        }
        notify();
        return { ok: false, reason: control ? "disabled" : "no-control" };
      }

      if (!control) {
        if (state.lastControl !== null) {
          state.lastControl = null;
          clearTimers();
          notify();
        }
        return { ok: false, reason: "no-control" };
      }

      if (!state.settings.enabled) {
        return { ok: false, reason: "disabled" };
      }

      if (isControlExpanded(control) || isControlDisabled(control)) {
        return { ok: false, reason: isControlExpanded(control) ? "control-expanded" : "control-disabled" };
      }

      const currentLevel = getCurrentThinkingLevel(control);
      if (state.manualOverride && state.settings.allowManualOverride) {
        return { ok: false, reason: "manual-override" };
      }

      if (currentLevel && state.lastPinnedLevel && currentLevel !== state.lastPinnedLevel) {
        if (
          state.settings.allowManualOverride &&
          state.lastUserInteractionAt !== null &&
          now() - state.lastUserInteractionAt <= USER_INTERACTION_GRACE_MS
        ) {
          state.manualOverride = true;
          clearTimers();
          notify();
          return { ok: false, reason: "manual-override" };
        }
        return attemptPin("re-pin-after-mutation");
      }

      if (currentLevel && !state.lastPinnedLevel && state.pinsInCurrentContext === 0) {
        return attemptPin("initial-populated");
      }

      return { ok: true, reason: "already-settled", after: currentLevel, changed: false };
    }

    function triggerReset() {
      state.resetEpoch += 1;
      state.manualOverride = false;
      state.lastPinnedLevel = "";
      state.lastUserInteractionAt = null;
      state.pinsInCurrentContext = 0;
      clearTimers();
      return syncContext();
    }

    function noteTrustedInteraction(event) {
      if (!event || !event.isTrusted) return;

      if (event.type === "click" && isResetTriggerTarget(event.target)) {
        triggerReset();
        return;
      }

      if (event.type === "click") {
        return;
      }

      const control = findThinkingLevelControl(doc);
      if (!control) return;

      const targetsControl = isThinkingInteractionTarget(event.target, control);
      const keyboardWhileOpen =
        event.type === "keydown" &&
        isControlExpanded(control) &&
        isSelectionChangingKey(event.key);

      if (!targetsControl && !keyboardWhileOpen) {
        return;
      }

      if (event.type === "keydown" && !isSelectionChangingKey(event.key)) {
        return;
      }

      state.lastUserInteractionAt = now();
      clearTimers();

      if (
        state.settings.allowManualOverride &&
        (event.type === "keydown" || isThinkingOptionTarget(event.target, control))
      ) {
        state.manualOverride = true;
        notify();
      }
    }

    function forcePinNow() {
      state.manualOverride = false;
      state.lastUserInteractionAt = null;
      state.pinsInCurrentContext = 0;
      const result = attemptPin("manual-pin-now", {
        ignoreEnabled: true,
        ignoreOverride: true,
        ignoreLimit: true,
      });
      if (state.settings.enabled && state.contextKey) {
        startStabilizationBurst(state.contextKey);
      }
      return result;
    }

    function updateSettings(partial) {
      const prevEnabled = state.settings.enabled;
      const prevAllowOverride = state.settings.allowManualOverride;

      if (partial && typeof partial.enabled === "boolean") {
        state.settings.enabled = partial.enabled;
      }
      if (partial && typeof partial.allowManualOverride === "boolean") {
        state.settings.allowManualOverride = partial.allowManualOverride;
      }

      if (!state.settings.enabled) {
        clearTimers();
        notify();
        return;
      }

      if (
        (!prevEnabled && state.settings.enabled) ||
        (prevAllowOverride && !state.settings.allowManualOverride)
      ) {
        state.manualOverride = false;
        state.pinsInCurrentContext = 0;
        if (state.contextKey) {
          const control = findThinkingLevelControl(doc);
          if (control) {
            attemptPin("settings-updated");
            startStabilizationBurst(state.contextKey);
          } else {
            syncContext();
          }
        } else {
          notify();
        }
      } else {
        notify();
      }
    }

    function getStatus() {
      const control = findThinkingLevelControl(doc);
      const loc = getLocation() || { pathname: "", search: "" };
      return {
        enabled: state.settings.enabled,
        allowManualOverride: state.settings.allowManualOverride,
        hasControl: Boolean(control),
        modelName: getCurrentModelName(doc, loc),
        currentLevel: control ? getCurrentThinkingLevel(control) : "",
        manualOverride: state.manualOverride && state.settings.allowManualOverride,
        isExpanded: control ? isControlExpanded(control) : false,
        isDisabled: control ? isControlDisabled(control) : false,
      };
    }

    function destroy() {
      clearTimers();
    }

    return {
      syncContext,
      attemptPin,
      triggerReset,
      noteTrustedInteraction,
      forcePinNow,
      updateSettings,
      getStatus,
      destroy,
    };
  }

  return {
    DEFAULT_SETTINGS,
    STABILIZATION_DELAYS_MS,
    THINKING_CONTROL_SELECTORS,
    findThinkingLevelControl,
    isControlDisabled,
    isControlExpanded,
    getCurrentThinkingLevel,
    getCurrentModelName,
    buildContextKey,
    isResetTriggerTarget,
    isThinkingOptionTarget,
    isThinkingInteractionTarget,
    isSelectionChangingKey,
    selectHighestOption,
    createPinController,
  };
});
