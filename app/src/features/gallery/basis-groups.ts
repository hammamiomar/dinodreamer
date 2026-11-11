// The owner's names for the basis groups: what he thinks each one is, such as "light on glass". The
// Automata page shows a group's name beside its number; a group without one shows its number alone.
// They are published/basis-groups.json on the public bucket, an object from the group's number to its
// record. The owner's view writes it (gallery/src/admin.ts); the page reads it through the Worker
// (GET /api/basis-groups). No browser or React imports.

export const BASIS_GROUP_NAMES_KEY = "published/basis-groups.json";
/** The most characters a name holds. */
export const NAME_CHARACTERS = 80;
/** The basis groups of the release's dictionary: 16,384 blocks. */
const BLOCKS = 16384;

export interface BasisGroupRecord {
  /** The owner's name, 1 to NAME_CHARACTERS characters without control characters; a cleared name removes the record. */
  name: string;
}
/** The records by block number, as the object is stored: `{ "729": { "name": "light on glass" } }`. */
export type BasisGroupNames = Record<string, BasisGroupRecord>;
export const NO_NAMES: BasisGroupNames = {};

/** A name as the field gives it, trimmed; null when it is empty, too long or carries control characters. */
export function checkedName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > NAME_CHARACTERS || /[\p{Cc}]/u.test(trimmed)) return null;
  return trimmed;
}

function check(condition: boolean, field: string): asserts condition {
  if (!condition) throw new Error(`The basis group names have an invalid ${field}`);
}

/** Check the stored object once at the boundary; a reader then trusts its names. */
export function readBasisGroupNames(value: unknown): BasisGroupNames {
  check(typeof value === "object" && value !== null && !Array.isArray(value), "object");
  for (const [key, record] of Object.entries(value as Record<string, unknown>)) {
    const block = Number(key);
    check(/^\d{1,5}$/.test(key) && Number.isInteger(block) && block >= 0 && block < BLOCKS, "block number");
    check(typeof record === "object" && record !== null, `record of ${key}`);
    const { name } = record as { name?: unknown };
    check(typeof name === "string" && checkedName(name) === name, `name of ${key}`);
  }
  return value as BasisGroupNames;
}

export function nameOf(names: BasisGroupNames, block: number): string | null {
  return names[String(block)]?.name ?? null;
}

/** The names with this block's name set, or removed when the name is empty; the same object when nothing changes. */
export function withName(names: BasisGroupNames, block: number, name: string): BasisGroupNames {
  const key = String(block);
  const trimmed = name.trim();
  if (trimmed === "") {
    if (!(key in names)) return names;
    const { [key]: _removed, ...rest } = names;
    return rest;
  }
  const checked = checkedName(trimmed);
  if (checked === null) throw new Error(`A name is 1 to ${NAME_CHARACTERS} characters without control characters`);
  if (names[key]?.name === checked) return names;
  return { ...names, [key]: { name: checked } };
}
