import { describe, expect, it } from "vitest";
import { formatShare } from "./glossary";

const plain = (text: string) => text.replaceAll("\u00a0", " ");

describe("provenance formatting", () => {
  it("prints a share as a whole percent with a true minus sign, unclamped", () => {
    expect(formatShare(1.1361258)).toBe("114\u00a0%");
    expect(plain(formatShare(-0.17147395))).toBe("−17 %");
    expect(plain(formatShare(-0.004))).toBe("0 %");
    expect(plain(formatShare(0))).toBe("0 %");
    expect(plain(formatShare(0.255))).toBe("26 %");
  });
});
