import { describe, expect, it, vi } from "vitest";

vi.mock("../../mapboxCapacitorWorker", () => ({
  default: { Marker: class {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() {}
  } },
}));

import { attachHazardRouteDrag } from "../hazardBypassDrag";

function setup(hit = true) {
  const handlers = new Map<string, EventListener>();
  const container = {
    addEventListener: vi.fn((name: string, fn: EventListener) => handlers.set(name, fn)),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  };
  const map = {
    getCanvasContainer: () => container,
    getStyle: () => ({ layers: [{ id: "route-r-fast-line-hit" }] }),
    getLayer: () => ({}),
    queryRenderedFeatures: () => hit ? [{}] : [],
    unproject: ([x, y]: number[]) => ({ lng: x, lat: y }),
    on: vi.fn(), off: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
  };
  const pull = vi.fn();
  const cleanup = attachHazardRouteDrag(map as never, pull);
  const send = (name: string, x = 10, y = 10, pointerId = 1) => {
    const event = new Event(name, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId, button: 0 });
    handlers.get(name)?.(event);
    return event;
  };
  return { pull, send, cleanup, container };
}

describe("Bend gesture ownership", () => {
  it("captures a route pull before normal map gestures and commits its endpoints", () => {
    const { send, pull, container } = setup();
    expect(send("pointerdown").defaultPrevented).toBe(true);
    expect(container.setPointerCapture).toHaveBeenCalledWith(1);
    expect(send("touchstart").defaultPrevented).toBe(true);
    send("pointermove", 60, 20);
    send("pointerup", 70, 20);
    expect(pull).toHaveBeenCalledWith([10, 10], [70, 20]);
    expect(send("click").defaultPrevented).toBe(true);
  });

  it("leaves map gestures alone away from the route", () => {
    const { send, pull } = setup(false);
    expect(send("pointerdown").defaultPrevented).toBe(false);
    send("pointerup", 70, 20);
    expect(pull).not.toHaveBeenCalled();
  });

  it("uses capture listeners and cleans up without committing an unfinished pull", () => {
    const { send, pull, cleanup, container } = setup();
    expect(container.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), { capture: true, passive: false });
    send("pointerdown");
    send("pointermove", 60, 20);
    cleanup();
    expect(pull).not.toHaveBeenCalled();
    expect(container.removeEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), { capture: true, passive: false });
  });

  it("does not turn a short tap into a bend", () => {
    const { send, pull } = setup();
    send("pointerdown");
    send("pointerup", 12, 12);
    expect(pull).not.toHaveBeenCalled();
  });

  it("does not commit a cancelled or multi-finger pull", () => {
    const { send, pull } = setup();
    send("pointerdown");
    send("pointermove", 60, 20);
    send("pointercancel");
    send("pointerdown");
    send("pointerdown", 20, 20, 2);
    send("pointerup", 70, 20);
    expect(pull).not.toHaveBeenCalled();
  });
});
