import { describe, expect, it } from "vitest";
import { checkedGuess, guessOf, NO_NOTES, readBasisGroupNotes, withGuess } from "./basis-groups";

describe("the owner's guesses by basis group", () => {
  it("sets, keeps and clears a guess, and leaves the notes alone when nothing changes", () => {
    const notes = withGuess(NO_NOTES, 7178, "  forks ");
    expect(notes).toEqual({ "7178": { guess: "forks" } });
    expect(withGuess(notes, 7178, "forks")).toBe(notes);
    expect(withGuess(notes, 12240, "")).toBe(notes);
    expect(withGuess(notes, 7178, " ")).toEqual({});
    expect(guessOf(notes, 7178)).toBe("forks");
    expect(guessOf(notes, 12240)).toBeNull();
    expect(() => withGuess(notes, 7178, "a\u0007bell")).toThrow("control characters");
    expect(checkedGuess("x".repeat(81))).toBeNull();
  });

  it("reads the stored object once and refuses a bad block or guess", () => {
    expect(readBasisGroupNotes({ "7178": { guess: "forks" } })).toEqual({ "7178": { guess: "forks" } });
    expect(() => readBasisGroupNotes([])).toThrow("invalid object");
    expect(() => readBasisGroupNotes({ "16384": { guess: "forks" } })).toThrow("invalid block number");
    expect(() => readBasisGroupNotes({ "7178": { guess: " forks" } })).toThrow("invalid guess of 7178");
    expect(() => readBasisGroupNotes({ "7178": { guess: "" } })).toThrow("invalid guess of 7178");
  });
});
