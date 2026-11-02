// The owner's guesses at what each basis group grows, shown on the Automata page in quotes as a
// guess, never as a name: published/basis-groups.json on the public bucket, an object from the
// group's number to its note. The owner page's guess field writes it (gallery/src/admin.ts); the
// Automata page reads it through the Worker (GET /api/basis-groups). No browser or React imports.

export const BASIS_GROUP_NOTES_KEY = "published/basis-groups.json";
/** The most characters a guess holds. */
export const GUESS_CHARACTERS = 80;
/** The basis groups of the release's dictionary: 16,384 blocks. */
const BLOCKS = 16384;

export interface BasisGroupNote {
  /** The owner's guess, 1 to GUESS_CHARACTERS characters without control characters; a cleared guess removes the note. */
  guess: string;
}
/** The notes by block number, as the object is stored: `{ "7178": { "guess": "forks" } }`. */
export type BasisGroupNotes = Record<string, BasisGroupNote>;
export const NO_NOTES: BasisGroupNotes = {};

/** A guess as the field gives it, trimmed; null when it is empty, too long or carries control characters. */
export function checkedGuess(guess: string): string | null {
  const trimmed = guess.trim();
  if (trimmed === "" || trimmed.length > GUESS_CHARACTERS || /[\p{Cc}]/u.test(trimmed)) return null;
  return trimmed;
}

function check(condition: boolean, field: string): asserts condition {
  if (!condition) throw new Error(`The basis group notes have an invalid ${field}`);
}

/** Check the stored object once at the boundary; a reader then trusts its notes. */
export function readBasisGroupNotes(value: unknown): BasisGroupNotes {
  check(typeof value === "object" && value !== null && !Array.isArray(value), "object");
  for (const [key, note] of Object.entries(value as Record<string, unknown>)) {
    const block = Number(key);
    check(/^\d{1,5}$/.test(key) && Number.isInteger(block) && block >= 0 && block < BLOCKS, "block number");
    check(typeof note === "object" && note !== null, `note of ${key}`);
    const { guess } = note as { guess?: unknown };
    check(typeof guess === "string" && checkedGuess(guess) === guess, `guess of ${key}`);
  }
  return value as BasisGroupNotes;
}

export function guessOf(notes: BasisGroupNotes, block: number): string | null {
  return notes[String(block)]?.guess ?? null;
}

/** The notes with this block's guess set, or removed when the guess is empty; the same object when nothing changes. */
export function withGuess(notes: BasisGroupNotes, block: number, guess: string): BasisGroupNotes {
  const key = String(block);
  const trimmed = guess.trim();
  if (trimmed === "") {
    if (!(key in notes)) return notes;
    const { [key]: _removed, ...rest } = notes;
    return rest;
  }
  const checked = checkedGuess(trimmed);
  if (checked === null) throw new Error(`A guess is 1 to ${GUESS_CHARACTERS} characters without control characters`);
  if (notes[key]?.guess === checked) return notes;
  return { ...notes, [key]: { guess: checked } };
}
