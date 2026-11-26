import { describe, expect, it, vi } from "vitest";
import { createManifoldFocusStore } from "./manifold-focus";

describe("createManifoldFocusStore", () => {
  it("gives precedence to the most recently mounted active claim and restores underlying claims on release", () => {
    const store = createManifoldFocusStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getFocus()).toEqual({ group: null, accent: null });

    const pageClaim = store.claim({ group: 6638, accent: "oklch(72.0% 0.110 45.0)" });
    expect(store.getFocus()).toEqual({ group: 6638, accent: "oklch(72.0% 0.110 45.0)" });
    expect(listener).toHaveBeenCalledTimes(1);

    const panelClaim = store.claim({ group: 4009, accent: null });
    expect(store.getFocus()).toEqual({ group: 4009, accent: null });
    expect(listener).toHaveBeenCalledTimes(2);

    // Repeating an identical update emits no redundant notification.
    panelClaim.update({ group: 4009, accent: null });
    expect(listener).toHaveBeenCalledTimes(2);

    panelClaim.release();
    expect(store.getFocus()).toEqual({ group: 6638, accent: "oklch(72.0% 0.110 45.0)" });
    expect(listener).toHaveBeenCalledTimes(3);

    pageClaim.release();
    expect(store.getFocus()).toEqual({ group: null, accent: null });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keeps child/panel claims above parent page claims even when the child effect mounts first (direct /train/basis/4009?block=729)", () => {
    const store = createManifoldFocusStore();
    // Simulate React mounting child BasisGroupPanel (render order 2) before parent GrowPage (render order 1).
    const childPanel = store.claim({ group: 4009, accent: null }, { order: 2 });
    const parentPage = store.claim({ group: 729, accent: null }, { order: 1 });
    expect(store.getFocus()).toEqual({ group: 4009, accent: null });

    // Closing the panel restores the underlying page's group.
    childPanel.release();
    expect(store.getFocus()).toEqual({ group: 729, accent: null });

    // Navigating away from /train to /index unmounts the page and resets focus to null.
    parentPage.release();
    expect(store.getFocus()).toEqual({ group: null, accent: null });
  });

  it("gives explicit panel layer precedence over page claims regardless of mount order", () => {
    const store = createManifoldFocusStore();
    const panel = store.claim({ group: 4009, accent: null }, { layer: "panel", order: 1 });
    const page = store.claim({ group: 729, accent: null }, { layer: "page", order: 10 });
    expect(store.getFocus()).toEqual({ group: 4009, accent: null });

    panel.release();
    expect(store.getFocus()).toEqual({ group: 729, accent: null });

    page.release();
    expect(store.getFocus()).toEqual({ group: null, accent: null });
  });
});
