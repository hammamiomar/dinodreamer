import { describe, expect, it } from "vitest";
import { resolveMakerCardView } from "./maker-card";

describe("resolveMakerCardView", () => {
  it("leads with a contributor's custom title and places the basis group in facts", () => {
    const view = resolveMakerCardView({
      block: 4009,
      title: "Velvet Bloom",
      definitionName: "block-4009-figure-pyramid-strongest-seed-0",
      credit: "Nadia",
      detail: "coarse + fine, from a noise field",
      updates: 850,
      published: true,
    });
    expect(view.heading).toBe("Velvet Bloom");
    expect(view.headingPlaceholder).toBe(false);
    expect(view.creditLine).toBe("Made by Nadia");
    expect(view.facts).toEqual([
      "Basis group 4009",
      "coarse + fine, from a noise field",
      "850 updates",
      "Apache 2.0",
    ]);
  });

  it("ignores research definition names as titles and falls back cleanly to Basis group N without assuming a semantic label", () => {
    const view = resolveMakerCardView({
      block: 4009,
      title: "block-4009-figure-pyramid-strongest-seed-0",
      definitionName: "block-4009-figure-pyramid-strongest-seed-0",
      credit: "Omar Hammami",
      updates: 975,
      published: true,
    });
    expect(view.heading).toBe("Basis group 4009");
    expect(view.creditLine).toBe("Made by Omar Hammami");
    expect(view.facts).toEqual(["975 updates", "Apache 2.0"]);
  });

  it("shows gentle live placeholders in publish-form preview mode before fields are filled", () => {
    const view = resolveMakerCardView({
      block: 8412,
      title: "",
      credit: "",
      updates: 1000,
      preview: true,
    });
    expect(view.heading).toBe("Basis group 8412");
    expect(view.headingPlaceholder).toBe(true);
    expect(view.creditLine).toBe("Your name appears here (optional)");
    expect(view.creditPlaceholder).toBe(true);
    expect(view.facts).toEqual(["1,000 updates", "Apache 2.0"]);
  });

  it("omits the credit line on published automata that carry no maker name", () => {
    const view = resolveMakerCardView({
      block: 2801,
      title: "",
      credit: "",
      published: true,
    });
    expect(view.creditLine).toBeNull();
  });
});
