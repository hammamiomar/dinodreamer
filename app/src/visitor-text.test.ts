import { describe, expect, it } from "vitest";
import { escapedText, firstUnsafeString, hasUnsafeCharacter, oneLineText } from "./visitor-text";

// Every character the rule refuses: C0, DEL, C1, and the two Unicode separators that end a line in
// WGSL and in JavaScript. The text is built at run time so that this file holds none of them.
const UNSAFE = [0x00, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x2028, 0x2029].map((code) => String.fromCodePoint(code));

describe("visitor text", () => {
  it.each(UNSAFE.map((character) => [character.codePointAt(0)!.toString(16), character]))("refuses U+%s", (_, character) => {
    expect(hasUnsafeCharacter(`a${character}b`)).toBe(true);
  });

  it("accepts ordinary text, accents, emoji and bidirectional letters", () => {
    for (const text of ["Garden at dusk", "Pâquerette", "🌿 moss", "שלום", "a — b · c"]) expect(hasUnsafeCharacter(text)).toBe(false);
  });

  it("finds the first unsafe key or string of a JSON value and names its path", () => {
    expect(firstUnsafeString({ id: "a", recipe: { name: "ok", settings: { labels: ["x", "y"] } } })).toBeNull();
    expect(firstUnsafeString({ id: "a", recipe: { name: `bad${UNSAFE[6]}` } })).toBe("recipe.name");
    expect(firstUnsafeString({ notes: ["ok", `line${UNSAFE[13]}break`] })).toBe("notes[1]");
    expect(firstUnsafeString({ [`key${UNSAFE[6]}`]: 1 })).toBe("key\\u001b (its name)");
  });

  it("keeps generated comments to one line and shows each unsafe character in a terminal as an escape", () => {
    const text = `a${UNSAFE[2]}b${UNSAFE[13]}c${UNSAFE[6]}[2K`;
    expect(oneLineText(text)).toBe("a b c [2K");
    expect(escapedText(text)).toBe("a\\u000ab\\u2028c\\u001b[2K");
    expect(escapedText(`csi${UNSAFE[11]}x`)).toBe("csi\\u009bx");
  });
});
