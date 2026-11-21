import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pin = require("../src/pin-logic.js");

class FakeKeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || "";
    this.code = init.code || "";
    this.keyCode = init.keyCode || 0;
    this.which = init.which || 0;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.isTrusted = Boolean(init.isTrusted);
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
  }
}

function createMockMatSelect({
  id = "mat-select-0",
  options = ["Low", "Medium", "High", "Extra High"],
  disabledOptions = [],
  selectedIndex = 2,
  ariaExpanded = "false",
  ariaDisabled = "false",
} = {}) {
  let currentIdx = selectedIndex;
  const dispatchedEvents = [];

  const minLine = {
    get textContent() {
      return currentIdx >= 0 && currentIdx < options.length ? options[currentIdx] : "";
    },
  };

  const optionEls = options.map((label, idx) => ({
    nodeType: 1,
    tagName: "MAT-OPTION",
    textContent: label,
    closest(sel) {
      if (sel.includes("mat-option") || sel.includes('[role="option"]')) return this;
      if (sel.includes('[role="listbox"]')) return listbox;
      if (sel.includes("ms-thinking-level-setting")) return wrapper;
      return null;
    },
    getAttribute(name) {
      if (name === "role") return "option";
      if (name === "aria-disabled") return disabledOptions.includes(idx) ? "true" : "false";
      return null;
    },
  }));

  const listbox = {
    nodeType: 1,
    id: `${id}-panel`,
    getAttribute(name) {
      if (name === "role") return "listbox";
      if (name === "aria-label") return "Thinking Level";
      return null;
    },
    closest(sel) {
      if (sel.includes('[role="listbox"]')) return this;
      if (sel.includes("ms-thinking-level-setting")) return wrapper;
      return null;
    },
  };

  const selectEl = {
    nodeType: 1,
    id,
    tagName: "MAT-SELECT",
    ariaExpanded,
    ariaDisabled,
    classList: {
      contains(cls) {
        if (cls === "mat-select-open") return selectEl.ariaExpanded === "true";
        if (cls === "mat-mdc-select-disabled") return selectEl.ariaDisabled === "true";
        return false;
      },
    },
    get textContent() {
      return minLine.textContent;
    },
    getAttribute(name) {
      if (name === "aria-expanded") return selectEl.ariaExpanded;
      if (name === "aria-disabled") return selectEl.ariaDisabled;
      if (name === "aria-label") return "Thinking Level";
      if (name === "role") return "combobox";
      return null;
    },
    hasAttribute(name) {
      return name === "disabled" ? selectEl.ariaDisabled === "true" : false;
    },
    querySelector(sel) {
      if (sel === ".mat-mdc-select-min-line") return minLine;
      return null;
    },
    contains(node) {
      return node === selectEl || node === minLine || node === listbox || optionEls.includes(node);
    },
    closest(sel) {
      if (sel.includes("ms-thinking-level-setting")) return wrapper;
      return null;
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event);
      if (event.type === "keydown" && event.key === "End" && selectEl.ariaExpanded !== "true") {
        for (let i = options.length - 1; i >= 0; i--) {
          if (!disabledOptions.includes(i)) {
            currentIdx = i;
            break;
          }
        }
      }
      return true;
    },
    // Test helpers
    setOptions(nextOptions, nextSelectedIndex, nextDisabled = []) {
      options = nextOptions;
      currentIdx = nextSelectedIndex;
      disabledOptions = nextDisabled;
    },
    setIndex(idx) {
      currentIdx = idx;
    },
    getIndex() {
      return currentIdx;
    },
    getDispatchedEvents() {
      return dispatchedEvents;
    },
    optionEls,
    listbox,
  };

  const wrapper = {
    nodeType: 1,
    tagName: "MS-THINKING-LEVEL-SETTING",
    closest(sel) {
      return sel.includes("ms-thinking-level-setting") ? wrapper : null;
    },
  };

  return selectEl;
}

function createFakeEnv({
  pathname = "/prompts/new_chat",
  search = "?model=gemini-4-neon",
  modelName = "gemini-4-neon",
  control = createMockMatSelect(),
} = {}) {
  let currentTime = 1000;
  let nextTimerId = 1;
  const timers = new Map();

  const loc = { pathname, search };
  const state = { modelName, control };

  const doc = {
    querySelector(selector) {
      if (selector === '[data-test-id="model-name"]') {
        return state.modelName ? { textContent: state.modelName } : null;
      }
      if (selector.includes("thinking") && state.control) {
        return state.control;
      }
      return null;
    },
  };

  const controller = pin.createPinController({
    document: doc,
    getLocation: () => loc,
    now: () => currentTime,
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, runAt: currentTime + ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    KeyboardEvent: FakeKeyboardEvent,
    Event: FakeEvent,
  });

  function advanceTimers(ms) {
    currentTime += ms;
    for (const [id, entry] of Array.from(timers.entries())) {
      if (entry.runAt <= currentTime) {
        timers.delete(id);
        entry.fn();
      }
    }
  }

  return { loc, state, doc, controller, advanceTimers, getPendingTimerCount: () => timers.size };
}

test("pins High to Extra High on gemini-4-neon without opening dropdown", () => {
  const env = createFakeEnv();
  const res = env.controller.syncContext();
  assert.equal(res.ok, true);
  assert.equal(res.before, "High");
  assert.equal(res.after, "Extra High");
  assert.equal(res.changed, true);
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});

test("works across arbitrary future models with different max levels", () => {
  const control = createMockMatSelect({
    options: ["Low", "Medium", "High", "Extra High", "Ultra High"],
    selectedIndex: 2,
  });
  const env = createFakeEnv({
    search: "?model=gemini-5-titanium",
    modelName: "gemini-5-titanium",
    control,
  });

  const res = env.controller.syncContext();
  assert.equal(res.ok, true);
  assert.equal(res.after, "Ultra High");
});

test("re-pins when switching models in-app even when Angular reuses the exact same mat-select node", () => {
  const env = createFakeEnv();
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");

  // Simulate in-app switch to gemini-4-carbon (same mat-select DOM node reused)
  env.loc.search = "?model=gemini-4-carbon";
  env.state.modelName = "gemini-4-carbon";
  env.state.control.setOptions(["Low", "Medium", "High"], 1);

  const carbonRes = env.controller.syncContext();
  assert.equal(carbonRes.ok, true);
  assert.equal(carbonRes.before, "Medium");
  assert.equal(carbonRes.after, "High");

  // Switch again to gemini-4-hydrogen
  env.loc.search = "?model=gemini-4-hydrogen";
  env.state.modelName = "gemini-4-hydrogen";
  env.state.control.setOptions(["Low", "Medium", "High", "Extra High"], 2);

  const hydrogenRes = env.controller.syncContext();
  assert.equal(hydrogenRes.ok, true);
  assert.equal(hydrogenRes.before, "High");
  assert.equal(hydrogenRes.after, "Extra High");
});

test("re-pins if Angular asynchronously overwrites level back to High during or after load", () => {
  const env = createFakeEnv();
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");

  // Angular finishes async hydration and resets value back to High
  env.state.control.setIndex(2);
  assert.equal(env.controller.getStatus().currentLevel, "High");

  const rePin = env.controller.syncContext();
  assert.equal(rePin.ok, true);
  assert.equal(rePin.reason, "re-pin-after-mutation");
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});

test("respects trusted manual override when allowManualOverride is true, and resets on model switch or reset click", () => {
  const env = createFakeEnv();
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");

  // Human clicks option "Low" in dropdown
  env.controller.noteTrustedInteraction({
    type: "pointerdown",
    isTrusted: true,
    target: env.state.control.optionEls[0],
  });
  env.state.control.setIndex(0);

  const afterManual = env.controller.syncContext();
  assert.equal(afterManual.reason, "manual-override");
  assert.equal(env.controller.getStatus().currentLevel, "Low");
  assert.equal(env.controller.getStatus().manualOverride, true);

  // Human clicks "Reset default settings"
  const resetBtn = {
    nodeType: 1,
    tagName: "BUTTON",
    getAttribute(name) {
      return name === "aria-label" ? "Reset default settings" : null;
    },
    closest(sel) {
      return sel.includes("button") ? resetBtn : null;
    },
  };
  env.state.control.setIndex(2); // Angular resets to High
  env.controller.noteTrustedInteraction({
    type: "click",
    isTrusted: true,
    target: resetBtn,
  });

  assert.equal(env.controller.getStatus().manualOverride, false);
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});

test("does not interfere while dropdown is expanded or control is disabled", () => {
  const control = createMockMatSelect({ ariaExpanded: "true", selectedIndex: 1 });
  const env = createFakeEnv({ control });

  const expandedRes = env.controller.syncContext();
  assert.equal(expandedRes.ok, false);
  assert.equal(expandedRes.reason, "control-expanded");
  assert.equal(control.getDispatchedEvents().length, 0);

  control.ariaExpanded = "false";
  control.ariaDisabled = "true";
  const disabledRes = env.controller.attemptPin("test");
  assert.equal(disabledRes.ok, false);
  assert.equal(disabledRes.reason, "control-disabled");
});

test("strict mode (allowManualOverride: false) re-pins immediately when turned on", () => {
  const env = createFakeEnv();
  env.controller.syncContext();

  env.controller.noteTrustedInteraction({
    type: "keydown",
    key: "ArrowUp",
    isTrusted: true,
    target: env.state.control,
  });
  env.state.control.setIndex(1);
  assert.equal(env.controller.getStatus().currentLevel, "Medium");

  env.controller.updateSettings({ allowManualOverride: false });
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
  assert.equal(env.controller.getStatus().manualOverride, false);
});

test("disabled extension never dispatches End key", () => {
  const env = createFakeEnv();
  env.controller.updateSettings({ enabled: false });
  const res = env.controller.syncContext();
  assert.equal(res.ok, false);
  assert.equal(res.reason, "disabled");
  assert.equal(env.state.control.getDispatchedEvents().length, 0);
  assert.equal(env.controller.getStatus().currentLevel, "High");

  // Enabling re-pins right away
  env.controller.updateSettings({ enabled: true });
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});

test("handles models without Thinking Level cleanly and re-pins when control reappears", () => {
  const env = createFakeEnv({
    search: "?model=gemini-decision-1",
    modelName: "gemini-decision-1",
    control: null,
  });

  const noCtrlRes = env.controller.syncContext();
  assert.equal(noCtrlRes.ok, false);
  assert.equal(noCtrlRes.reason, "no-control");
  assert.equal(env.controller.getStatus().hasControl, false);

  // Switch back to a thinking-capable model
  env.loc.search = "?model=gemini-3.5-flash-lite";
  env.state.modelName = "gemini-3.5-flash-lite";
  env.state.control = createMockMatSelect({
    options: ["Minimal", "Low", "Medium", "High"],
    selectedIndex: 0,
  });

  const backRes = env.controller.syncContext();
  assert.equal(backRes.ok, true);
  assert.equal(backRes.before, "Minimal");
  assert.equal(backRes.after, "High");
});

test("native <select> fallback picks last enabled option", () => {
  const events = [];
  const nativeSelect = {
    tagName: "SELECT",
    selectedIndex: 1,
    options: [
      { textContent: "Low", disabled: false },
      { textContent: "Medium", disabled: false },
      { textContent: "Extra High", disabled: false },
      { textContent: "Locked Tier", disabled: true },
    ],
    dispatchEvent(ev) {
      events.push(ev.type);
    },
  };

  const result = pin.selectHighestOption(nativeSelect, { Event: FakeEvent });
  assert.equal(result.dispatched, true);
  assert.equal(result.method, "native-select");
  assert.equal(nativeSelect.selectedIndex, 2);
  assert.equal(result.after, "Extra High");
  assert.deepEqual(events, ["input", "change"]);
});

test("stabilization burst catches delayed option availability", () => {
  const control = createMockMatSelect({
    options: ["Low", "Medium", "High"],
    selectedIndex: 2,
  });
  const env = createFakeEnv({ control });
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "High");
  assert.ok(env.getPendingTimerCount() > 0);

  // At 300ms Angular finishes loading Extra High option
  control.setOptions(["Low", "Medium", "High", "Extra High"], 2);
  env.advanceTimers(600);

  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});

test("clears user interaction timestamp on model switch so quick async resets still re-pin", () => {
  const env = createFakeEnv();
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");

  // User manually picks Low
  env.controller.noteTrustedInteraction({
    type: "pointerdown",
    isTrusted: true,
    target: env.state.control.optionEls[0],
  });
  env.state.control.setIndex(0);
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Low");

  // Immediately switch to gemini-4-hydrogen (within 200ms)
  env.advanceTimers(200);
  env.loc.search = "?model=gemini-4-hydrogen";
  env.state.modelName = "gemini-4-hydrogen";
  env.state.control.setOptions(["Low", "Medium", "High", "Extra High"], 2);
  env.controller.syncContext();
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");

  // Angular asynchronously resets back to High 100ms later -> must re-pin, NOT treat as manual override!
  env.advanceTimers(100);
  env.state.control.setIndex(2);
  const rePin = env.controller.syncContext();
  assert.equal(rePin.ok, true);
  assert.equal(env.controller.getStatus().currentLevel, "Extra High");
});
