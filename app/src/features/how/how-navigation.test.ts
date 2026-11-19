import { describe, expect, it } from "vitest";
import { SITE_WORDS } from "../../app/site-words";
import { firstSectionOfAct, hashForSection, nextSection, previousSection, sectionIndexFromHash, sectionsOfAct } from "./how-navigation";
import { HOW_ACTS, HOW_SECTIONS, HOW_STAGES, STAGE_SECTION } from "./how-sections";

describe("the section list", () => {
  it("has unique ids, each with its words", () => {
    const ids = HOW_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const words = SITE_WORDS.how.sections[id as keyof typeof SITE_WORDS.how.sections];
      expect(words, id).toBeDefined();
      expect(words.heading.length, id).toBeGreaterThan(0);
      expect(words.claim.length, id).toBeGreaterThan(0);
    }
  });

  it("cites only references that exist", () => {
    const keys = new Set<string>(SITE_WORDS.how.references.map((reference) => reference.key));
    const texts = Object.values(SITE_WORDS.how.sections).flatMap((words) => [words.claim, ...words.paragraphs]);
    const cited = texts.flatMap((text) => Array.from(text.matchAll(/\[[^\]]+\]\(([a-z0-9-]+)\)/g), (match) => match[1]!));
    expect(cited.length).toBeGreaterThan(0);
    for (const key of cited) expect(keys.has(key), key).toBe(true);
  });

  it("keeps the acts in story order, each with at least one section", () => {
    const seen: string[] = [];
    for (const section of HOW_SECTIONS) if (seen.at(-1) !== section.act) seen.push(section.act);
    expect(seen).toEqual(HOW_ACTS);
  });

  it("lights only stages that are present, and every stage leads somewhere", () => {
    for (const section of HOW_SECTIONS) {
      for (const stage of section.map.lit) expect(section.map.present, section.id).toContain(stage);
      // The map draws stages in its own order whatever the section lists.
      const order = section.map.present.map((stage) => HOW_STAGES.indexOf(stage));
      expect(order, section.id).toEqual([...order].sort((a, b) => a - b));
    }
    for (const stage of HOW_STAGES) expect(HOW_SECTIONS.some((section) => section.id === STAGE_SECTION[stage]), stage).toBe(true);
  });
});

describe("navigation", () => {
  it("reads a section from the hash and writes it back", () => {
    expect(sectionIndexFromHash("")).toBe(0);
    expect(sectionIndexFromHash("#attention")).toBe(HOW_SECTIONS.findIndex((section) => section.id === "attention"));
    expect(sectionIndexFromHash("#no-such-section")).toBe(0);
    expect(hashForSection(0)).toBe("");
    expect(hashForSection(2)).toBe(`#${HOW_SECTIONS[2]!.id}`);
    expect(sectionIndexFromHash(hashForSection(5))).toBe(5);
  });

  it.each(["#%", "#%ZZ", "#%E0%A4%A", "#%FF"])("uses the overview for malformed hash %s", (hash) => {
    expect(sectionIndexFromHash(hash)).toBe(0);
  });

  it("accepts a percent-encoded section name", () => {
    expect(sectionIndexFromHash("#%61ttention")).toBe(sectionIndexFromHash("#attention"));
  });

  it("steps within the story and stops at its ends", () => {
    expect(previousSection(0)).toBeNull();
    expect(nextSection(0)).toBe(1);
    expect(nextSection(HOW_SECTIONS.length - 1)).toBeNull();
  });

  it("groups sections by act", () => {
    expect(firstSectionOfAct("overview")).toBe(0);
    const basis = sectionsOfAct("basis");
    expect(basis.length).toBeGreaterThan(1);
    expect(basis.every((entry) => entry.section.act === "basis")).toBe(true);
    expect(basis[0]!.index).toBe(firstSectionOfAct("basis"));
  });
});
