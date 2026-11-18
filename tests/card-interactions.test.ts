import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  element: null as unknown,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", () => ({
  useRef: () => ({ current: state.element }),
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
vi.mock("../src/presentation/cosmetics/cardCosmetics", () => ({
  useCosmeticCard: (c: unknown) => c,
}));
vi.mock("../src/presentation/cards/premiumTreatment", () => ({
  premiumIdentity: () => ({
    treatment: "none",
    family: "neutral",
    motif: "arcane",
  }),
  cardRarityFinish: () => "common",
  premiumPointer: (x: number, y: number) => ({
    x,
    y,
    angleX: -2,
    angleY: 2,
    lightX: 70,
    lightY: 30,
  }),
}));
import { useCardPremiumEffect as bindPremiumEffect } from "../src/presentation/cards/useCardPremiumEffect";
import { bindCardGestures } from "../src/presentation/cards/cardGestures";
class Surface extends EventTarget {
  dataset: Record<string, string> = {};
  values = new Map();
  style = { setProperty: (k: string, v: string) => this.values.set(k, v) };
  isConnected = true;
  tagName = "DIV";
  editable = false;
  draggable = false;
  closest(s: string) {
    return s === '[draggable="true"]'
      ? this.draggable
        ? this
        : null
      : this.editable
        ? this
        : null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 300 };
  }
}
let el: Surface,
  media: EventTarget & { matches: boolean },
  doc: EventTarget & { hidden: boolean },
  win: EventTarget,
  frames: Map<number, FrameRequestCallback>,
  next: number,
  cleanup: (() => void) | undefined;
function pointer(type: string, props: Record<string, unknown> = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, {
    pointerType: "mouse",
    clientX: 40,
    clientY: 50,
    pointerId: 1,
    isPrimary: true,
    ...props,
  });
  el.dispatchEvent(e);
  return e;
}
function mount(interactive = true) {
  bindPremiumEffect(undefined, "large", false, interactive);
  cleanup = state.effects[0]!() as () => void;
}
beforeEach(() => {
  el = new Surface();
  state.element = el;
  state.effects = [];
  media = Object.assign(new EventTarget(), { matches: false });
  doc = Object.assign(new EventTarget(), { hidden: false });
  win = new EventTarget();
  frames = new Map();
  next = 0;
  vi.stubGlobal("Element", Surface);
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(++next, f);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});
describe("shared card interaction lifecycle", () => {
  it("common previews tilt with at most one pending frame and settle without a loop", () => {
    mount();
    pointer("pointerenter");
    pointer("pointermove");
    pointer("pointermove");
    expect(frames.size).toBe(1);
    const [id, cb] = [...frames][0]!;
    frames.delete(id);
    cb(0);
    expect(el.values.get("--cp-ry")).toBe("2deg");
    expect(frames.size).toBe(0);
    pointer("pointerleave");
    expect(el.values.get("--cp-ry")).toBe("0deg");
  });
  it("touch only follows the primary active pointer and cancels cleanly for browser scrolling", () => {
    mount();
    pointer("pointermove", { pointerType: "touch" });
    expect(frames.size).toBe(0);
    pointer("pointerdown", { pointerType: "touch" });
    pointer("pointermove", { pointerType: "touch", pointerId: 2 });
    expect(frames.size).toBe(0);
    pointer("pointermove", { pointerType: "touch" });
    expect(frames.size).toBe(1);
    const e = pointer("pointercancel", { pointerType: "touch" });
    expect(e.defaultPrevented).toBe(false);
    expect(frames.size).toBe(0);
    expect(el.dataset.premiumActive).toBe("false");
  });
  it("respects reduced motion including preference changes mid-interaction", () => {
    mount();
    pointer("pointermove");
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(frames.size).toBe(0);
    pointer("pointermove");
    expect(frames.size).toBe(0);
  });
  it("pauses hidden and blurred previews and removes listeners on unmount", () => {
    mount();
    pointer("pointermove");
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    pointer("pointermove");
    expect(frames.size).toBe(0);
    doc.hidden = false;
    pointer("pointermove");
    win.dispatchEvent(new Event("blur"));
    expect(frames.size).toBe(0);
    cleanup!();
    cleanup = undefined;
    pointer("pointermove");
    expect(frames.size).toBe(0);
    expect(pointer("contextmenu").defaultPrevented).toBe(false);
  });
  it("noninteractive cards never schedule pointer animation", () => {
    mount(false);
    pointer("pointerenter");
    pointer("pointermove");
    expect(frames.size).toBe(0);
  });
  it("does not interfere with pointer input, clicks or keyboard", () => {
    mount();
    for (const t of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "click",
      "keydown",
    ])
      expect(pointer(t).defaultPrevented).toBe(false);
  });
});
describe("scoped gesture defaults", () => {
  it("prevents card context menus but preserves editable fields", () => {
    const off = bindCardGestures(el as unknown as HTMLElement);
    expect(pointer("contextmenu").defaultPrevented).toBe(true);
    el.editable = true;
    expect(pointer("contextmenu").defaultPrevented).toBe(false);
    off();
  });
  it("blocks only native image dragging, preserving intentional deck drag", () => {
    const off = bindCardGestures(el as unknown as HTMLElement);
    el.tagName = "IMG";
    expect(pointer("dragstart").defaultPrevented).toBe(true);
    el.draggable = true;
    expect(pointer("dragstart").defaultPrevented).toBe(false);
    el.tagName = "BUTTON";
    el.draggable = false;
    expect(pointer("dragstart").defaultPrevented).toBe(false);
    off();
    expect(pointer("contextmenu").defaultPrevented).toBe(false);
  });
});
