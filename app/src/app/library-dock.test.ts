import { describe, expect, it } from "vitest";
import {
  dockFolded,
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
  it("recognizes basis group panel paths over Create", () => {
    expect(isCreatePanelPath("/create/basis/7125")).toBe(true);
    expect(isCreatePanelPath("/create")).toBe(false);
    expect(isCreatePanelPath("/basis/7125")).toBe(false);
  });

  it("shows once a creation has a request or a run has started", () => {
    expect(hasLiveCreation(0, false)).toBe(false);
    expect(hasLiveCreation(1, false)).toBe(true);
    expect(hasLiveCreation(0, true)).toBe(true);
    expect(dockShown(0, false)).toBe(false);
    expect(dockShown(1, false)).toBe(true);
    expect(dockShown(0, true)).toBe(true);
  });

  it("never shows outside Create basis group panels", () => {
    expect(dockPlacement("/basis/7125", true)).toBe("none");
    expect(dockPlacement("/index", true)).toBe("none");
    expect(dockPlacement("/index", false)).toBe("none");
    expect(dockPlacement("/", true)).toBe("none");
    expect(dockPlacement("/create", true)).toBe("none");
  });

  it("floats over Create basis group panels when a creation is active", () => {
    expect(dockPlacement("/create/basis/7125", true)).toBe("float");
    expect(dockPlacement("/create/basis/7125", false)).toBe("none");
  });

  it("mounts in the panel dialog slot when registered", () => {
    const float = { id: "float" } as unknown as HTMLElement;
    expect(dockHost("float", { float })).toBe(float);
    expect(dockHost("float", { float: null })).toBeNull();
    expect(dockHost("none", { float })).toBeNull();
  });

  it("starts folded and follows the user's fold choice", () => {
    expect(dockFolded("float", null)).toBe(true);
    expect(dockFolded("float", "folded")).toBe(true);
    expect(dockFolded("float", "open")).toBe(false);
    expect(dockFolded("none", null)).toBe(false);
  });

  it("reads the panel block and Create request id from the URL", () => {
    expect(panelBlock("/basis/7125")).toBe(7125);
    expect(panelBlock("/create/basis/7125")).toBe(7125);
    expect(panelBlock("/index")).toBeNull();
    expect(panelRequest("/create/basis/7125", "?role=patch&request=3")).toBe(3);
    expect(panelRequest("/create/basis/7125", "?role=patch")).toBeNull();
    expect(panelRequest("/basis/7125", "?request=3")).toBeNull();
  });

  it("caps the narrow sheet canvas to the viewport with horizontal padding", () => {
    expect(sheetCanvasSize(390)).toBe(320);
    expect(sheetCanvasSize(320)).toBe(288);
  });
});
