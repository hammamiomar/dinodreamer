// Where the reader is on the How page, as pure rules over the section list (how-sections.ts): the
// section an address names, the addresses of sections, the next and previous section, and the
// sections of an act. The page (how-page.tsx) keeps one index and the browser's history; nothing
// here touches the document.

import { HOW_SECTIONS, type HowAct, type HowSection } from "./how-sections";

/** The index of the section a location's hash names; the first section for no hash or an unknown one. */
export function sectionIndexFromHash(hash: string): number {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return 0;
  }
  const index = HOW_SECTIONS.findIndex((section) => section.id === id);
  return index === -1 ? 0 : index;
}

/** The hash of a section's address, "#attention"; the first section's address has none. */
export function hashForSection(index: number): string {
  return index === 0 ? "" : `#${HOW_SECTIONS[index]!.id}`;
}

export function clampSection(index: number): number {
  return Math.max(0, Math.min(HOW_SECTIONS.length - 1, Math.trunc(index)));
}

export function nextSection(index: number): number | null {
  return index + 1 < HOW_SECTIONS.length ? index + 1 : null;
}

export function previousSection(index: number): number | null {
  return index > 0 ? index - 1 : null;
}

/** The sections of an act, with their indices in the story. */
export function sectionsOfAct(act: HowAct): { index: number; section: HowSection }[] {
  return HOW_SECTIONS.map((section, index) => ({ index, section })).filter((entry) => entry.section.act === act);
}

/** The first section of an act: where its tab leads. */
export function firstSectionOfAct(act: HowAct): number {
  return HOW_SECTIONS.findIndex((section) => section.act === act);
}

/** The index of a section by its id, or null. */
export function sectionIndexOf(id: string): number | null {
  const index = HOW_SECTIONS.findIndex((section) => section.id === id);
  return index === -1 ? null : index;
}

/** Whether an arrow key should move the story: not while the reader is in a control or a dialog. */
export function keyboardMoves(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("input, select, textarea, [contenteditable], dialog, .block-panel")) return false;
  return true;
}
