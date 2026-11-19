import { describe, expect, it } from "vitest";
import { createRecipe, createRequest } from "../features/editor/model";
import { fixtureLibrary, fixtureProvenancePage } from "../library/fixture-library";
import { recordedCode } from "../library/observations";
import { validateRecipe } from "../recipe";
import { libraryToken } from "../library/roles";
import { MAX_STRONG_EXAMPLES, resolveTokenHandoff, strongExamples } from "./handoff";
import type { TokenReference } from "./handoff";

describe("a reference without a code", () => {
  it("names a patch card's listed token and resolves its recorded code", async () => {
    const { library } = await fixtureLibrary();
    const card = (await fixtureProvenancePage(library, "patch", "context")).cards[0]!;
    const example = card.examples[0]!;
    const reference: TokenReference = { token: libraryToken(example.imageId, "patch", example.position), block: card.block };
    expect(reference.token).toEqual({ imageId: example.imageId, role: "patch", slot: 5 + example.position! });

    const handoff = await resolveTokenHandoff(library, reference);
    const record = (await library.observations(card.block)).record(example.imageId)!;
    expect(handoff.code).toEqual(recordedCode(record, 5 + example.position!));
    expect(handoff.strongExamples).toEqual(strongExamples(await library.block(card.block), reference.token));
    const recipe = createRequest(createRecipe("fixture"), handoff);
    expect(validateRecipe(recipe, { blocks: library.release.blocks })).toEqual([]);
  });

  it("names a prefix card's own token", async () => {
    const { library } = await fixtureLibrary();
    const card = (await fixtureProvenancePage(library, "cls", "context")).cards[0]!;
    const reference: TokenReference = { token: libraryToken(card.examples[0]!.imageId, "cls", card.examples[0]!.position), block: card.block };
    expect(reference.token).toEqual({ imageId: card.examples[0]!.imageId, role: "cls", slot: 0 });
    const handoff = await resolveTokenHandoff(library, reference);
    expect(handoff.code).toHaveLength(3);
  });
});

describe("resolving a reference", () => {
  it("keeps a code the reference carries and reads only the block's record", async () => {
    const { library, requests } = await fixtureLibrary();
    const drag: TokenReference = { token: { imageId: 9007199254000006, role: "patch", slot: 47 }, block: 6, code: [1, 2, 3] };
    const handoff = await resolveTokenHandoff(library, drag);
    expect(handoff).toEqual({ ...drag, strongExamples: strongExamples(await library.block(6), drag.token) });
    expect([...requests.keys()].some((url) => url.includes("/observations/"))).toBe(false);
  });

  it("refuses a picture the block has no record of", async () => {
    const { library } = await fixtureLibrary();
    await expect(resolveTokenHandoff(library, { token: { imageId: 12345, role: "patch", slot: 141 }, block: 6 })).rejects.toThrow(
      "Basis group 6 has no record of image 12345.",
    );
  });
});

describe("a handoff's strong examples", () => {
  it("lists the role's examples in stored order, distinct pictures, without the source", async () => {
    const { library } = await fixtureLibrary();
    const record = await library.block(6);
    // Block 6 lists six patch examples: strong 0–2, moderate 0, variation 0–1. The source is strong 1.
    const source = { imageId: 9007199254740991, role: "patch", slot: 28 } as const;
    expect(strongExamples(record, source).map((token) => token.imageId)).toEqual([
      9007199254000006,
      9007199254000007,
      9007199254000002,
      9007199254000005,
      9007199254000001,
    ]);
    expect(strongExamples(record, source).every((token) => token.role === "patch")).toBe(true);
  });

  it("takes the token's own role: a storage token gets that slot's examples, with their slot", async () => {
    const { library } = await fixtureLibrary();
    const record = await library.block(6);
    const source = { imageId: 9007199254000004, role: "storage", slot: 2 } as const;
    const examples = strongExamples(record, source);
    expect(examples.map((token) => token.imageId)).toEqual([9007199254000001, 9007199254740991, 9007199254000002]);
    expect(examples.every((token) => token.slot === 2)).toBe(true);
  });

  it("stops at the maximum", async () => {
    const { library } = await fixtureLibrary();
    const record = await library.block(6);
    const many = { ...record, examples: Array.from({ length: 20 }, (_, index) => ({ ...record.examples[0]!, token: { ...record.examples[0]!.token, imageId: index } })) };
    expect(strongExamples(many, { imageId: 999, role: "patch", slot: 47 })).toHaveLength(MAX_STRONG_EXAMPLES);
  });
});
