import { describe, expect, it } from "vitest";
import {
  dockFolded,
  dockFolds,
  dockForm,
  dockHost,
  dockPlacement,
  dockShown,
  hasLiveCreation,
  isCreatePanelPath,
  panelBlock,
  panelRequest,
  sheetCanvasSize,
} from "./library-dock";

describe("library dock", () => {
  it("knows a block panel's path over Create", () => {
    expect(isCreatePanelPath("/create/basis/7125")).toBe(true);
    expect(isCreatePanelPath("/create")).toBe(false);
    expect(isCreatePanelPath("/basis/7125")).toBe(false);
  });

  it("shows once a creation has a request or a run has started", () => {
    expect(hasLiveCreation(0, false)).toBe(false);
    expect(hasLiveCreation(1, false)).toBe(true);
    expect(hasLiveCreation(0, true)).toBe(true);
  });

  it("shows for a live creation alone", () => {
    expect(dockShown(0, false)).toBe(false);
    expect(dockShown(1, false)).toBe(true);
    expect(dockShown(0, true)).toBe(true);
  });

  it("never shows outside the image editor: not on a block page, nor on the Index", () => {
    expect(dockPlacement("/basis/7125", true, true)).toBe("none");
    expect(dockPlacement("/basis/7125", true, false)).toBe("none");
    // A live creation must not cover the Index's cards.
    expect(dockPlacement("/index", true, false)).toBe("none");
    expect(dockPlacement("/index", false, false)).toBe("none");
    expect(dockPlacement("/", true, false)).toBe("none");
    expect(dockPlacement("/create", true, true)).toBe("none");
  });

  it("over Create, mounts in a panel's rail or floats over the panel, never over the editor alone", () => {
    expect(dockPlacement("/create/basis/7125", true, true)).toBe("panel");
    expect(dockPlacement("/create/basis/7125", true, false)).toBe("float");
    expect(dockPlacement("/create/basis/7125", false, true)).toBe("none");
    expect(dockPlacement("/create", true, false)).toBe("none");
  });

  it("over a panel, mounts inside the panel's dialog, so the panel's Tab loop and aria-modal include it", () => {
    // Stand-ins for the panel's two slots, both children of its dialog (block-panel.tsx).
    const slots = { rail: { id: "rail" } as unknown as HTMLElement, float: { id: "float" } as unknown as HTMLElement };
    expect(dockHost("panel", slots)).toBe(slots.rail);
    expect(dockHost("float", slots)).toBe(slots.float);
    // A panel that has not registered its slot yet: in place until it does.
    expect(dockHost("float", { rail: null, float: null })).toBeNull();
  });

  it("folds the tray at every width; the rail never", () => {
    expect(dockFolds("float")).toBe(true);
    expect(dockFolds("panel")).toBe(false);
    expect(dockFolds("none")).toBe(false);
  });

  it("starts folded over a basis group's page; the visitor's choice then holds; the rail never folds", () => {
    // Before any choice.
    expect(dockFolded("float", null)).toBe(true);
    // The visitor's last fold or open holds everywhere.
    expect(dockFolded("float", "folded")).toBe(true);
    expect(dockFolded("float", "open")).toBe(false);
    expect(dockFolded("panel", "folded")).toBe(false);
  });

  it("is the rail in a panel's slot, and a tray everywhere else", () => {
    expect(dockForm("panel")).toBe("rail");
    expect(dockForm("float")).toBe("tray");
  });

  it("knows the open panel's block, and over Create the request the panel was opened from", () => {
    expect(panelBlock("/basis/7125")).toBe(7125);
    expect(panelBlock("/create/basis/7125")).toBe(7125);
    expect(panelBlock("/index")).toBeNull();
    expect(panelRequest("/create/basis/7125", "?role=patch&request=3")).toBe(3);
    expect(panelRequest("/create/basis/7125", "?role=patch")).toBeNull();
    // Over the Index there is no request to show.
    expect(panelRequest("/basis/7125", "?request=3")).toBeNull();
  });

  it("gives a phone's sheet a 320 px canvas, less only where the window cannot hold it", () => {
    expect(sheetCanvasSize(390)).toBe(320);
    expect(sheetCanvasSize(320)).toBe(288);
  });
});
