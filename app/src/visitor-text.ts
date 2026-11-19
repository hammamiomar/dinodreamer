// Text that one visitor writes and other people read later: a submission's title and credit, and
// every string of an automaton definition. It reaches pages as text, the owner's terminal and the
// comment lines of exported shader code. None of these needs a control character or a line
// separator, and a terminal or a shader compiler acts on them. So the boundary refuses them where
// the text enters (submission-label.ts, materials/material-file.ts), and the places that print stored
// text make them inert as well (the owner's terminal commands, the shader exports).

/** C0, DEL and C1 control characters (Unicode category Cc) and the line and paragraph separators U+2028 and U+2029. */
const UNSAFE_CHARACTER = /[\p{Cc}\u2028\u2029]/u;
const UNSAFE_CHARACTERS = /[\p{Cc}\u2028\u2029]/gu;

export function hasUnsafeCharacter(text: string): boolean {
  return UNSAFE_CHARACTER.test(text);
}

/**
 * Where a JSON value first holds an unsafe character, in a key or a string, as a readable path such
 * as `recipe.name` or `settings[2]`; null when it holds none. The path escapes the keys it names.
 */
export function firstUnsafeString(value: unknown, path = ""): string | null {
  if (typeof value === "string") return hasUnsafeCharacter(value) ? path || "text" : null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = firstUnsafeString(entry, `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const keyPath = path ? `${path}.${escapedText(key)}` : escapedText(key);
      if (hasUnsafeCharacter(key)) return `${keyPath} (its name)`;
      const found = firstUnsafeString(entry, keyPath);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Text for one comment line of generated code: each unsafe character becomes a space. */
export function oneLineText(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, " ");
}

/** Text for a terminal: each unsafe character shows as its \uXXXX escape and does nothing. */
export function escapedText(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}
