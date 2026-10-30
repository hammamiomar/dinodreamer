import { describe, expect, it } from "vitest";
import { SITE_WORDS } from "../../app/site-words";
import { HOW_SECTIONS, litBy, TERM_SECTIONS } from "./how-sections";

const sectionById = (id: string) => HOW_SECTIONS.find((section) => section.id === id)!;

describe("the glossary's links into the story", () => {
  it("name glossary terms and sections that exist", () => {
    const terms = new Set<string>(SITE_WORDS.how.glossary.map((entry) => entry.term));
    const sections = new Set(HOW_SECTIONS.map((section) => section.id));
    for (const [term, section] of Object.entries(TERM_SECTIONS)) {
      expect(terms.has(term), term).toBe(true);
      expect(sections.has(section), `${term} leads to ${section}`).toBe(true);
    }
  });

  it("light the other section's stages, those the map draws", () => {
    const glossary = sectionById("glossary");
    expect(litBy(glossary.map, null)).toBe(glossary.map);
    expect(litBy(glossary.map, sectionById("attention")).lit).toEqual(["dino"]);
    expect(litBy(glossary.map, sectionById("updates")).lit).toEqual(["automaton", "loss"]);
    expect(litBy(sectionById("attention").map, sectionById("cells")).lit).toEqual([]);
  });
});
