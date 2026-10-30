import { describe, expect, it } from "vitest";
import { pictureAction } from "./strongest-pictures";

describe("pictureAction", () => {
  it("trains at once on a mouse click: the hover showed the line's word", () => {
    expect(pictureAction(3, null, "mouse")).toBe("train");
  });

  it("trains at once on Enter or Space: the focus showed the line's word", () => {
    expect(pictureAction(3, null, "keyboard")).toBe("train");
  });

  it("makes a finger's first tap on a picture only its choice", () => {
    expect(pictureAction(3, null, "touch")).toBe("arm");
    expect(pictureAction(3, 5, "touch")).toBe("arm");
  });

  it("trains on a finger's tap on the picture it chose", () => {
    expect(pictureAction(3, 3, "touch")).toBe("train");
  });

  it("treats a pen as a finger: it may have no hover", () => {
    expect(pictureAction(3, null, "pen")).toBe("arm");
    expect(pictureAction(3, 3, "pen")).toBe("train");
  });
});
