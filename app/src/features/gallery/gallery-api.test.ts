import { describe, expect, it } from "vitest";
import { CELLS, OPTIMIZER_BEFORE_FORMAT_5 } from "../../recipe";
import type { Recipe } from "../../recipe";
import { creationProblems, fetchGallery, fetchGalleryRecipe, submissionProblems, submitCreation } from "./gallery-api";

const BASE = new URL("https://library.test/");

const area = () => Array.from({ length: CELLS }, (_, cell) => cell === 136);

function recipe(): Recipe {
  const token = { imageId: 7, role: "patch" as const, slot: 141 };
  return {
    format: 7,
    release: "pass-003",
    seed: 1,
    requests: [
      {
        id: 1,
        block: 6,
        respondLike: { enabled: true, weight: 0.3, source: token, code: [1, 0, 0], where: area().map((inside) => inside ? 100 : 0), alsoBlocks: [], target: { kind: "point" }, radius: 1 },
        lookLike: { enabled: true, weight: 1, references: [{ token, source: area() }], where: area().map((inside) => inside ? 100 : 0) },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
    optimizer: { ...OPTIMIZER_BEFORE_FORMAT_5 },
  };
}

const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("gallery index", () => {
  it("reads entries and resolves bucket-relative URLs", async () => {
    const fetcher = (async () =>
      Response.json({
        entries: [
          {
            id: "a1",
            title: "Collar",
            credit: "Contributor",
            imageUrl: "gallery/a1/image.png",
            recipeUrl: "https://elsewhere.test/gallery/a1/recipe.json",
            publishedAt: "2026-10-11T09:00:00Z",
          },
        ],
      })) as unknown as typeof fetch;
    const [entry] = await fetchGallery(BASE, fetcher);
    expect(entry!.imageUrl).toBe("https://library.test/gallery/a1/image.png");
    expect(entry!.recipeUrl).toBe("https://elsewhere.test/gallery/a1/recipe.json");
    expect(entry!.thumbnailUrl).toBeNull();
  });

  it("resolves a thumbnail like the image, when the index has one", async () => {
    const fetcher = (async () =>
      Response.json({
        entries: [
          {
            id: "a1",
            title: "Collar",
            credit: "",
            imageUrl: "gallery/a1/image.png",
            thumbnailUrl: "gallery/a1/thumbnail.webp",
            recipeUrl: "gallery/a1/recipe.json",
            publishedAt: "2026-10-12T09:00:00Z",
          },
        ],
      })) as unknown as typeof fetch;
    const [entry] = await fetchGallery(BASE, fetcher);
    expect(entry!.thumbnailUrl).toBe("https://library.test/gallery/a1/thumbnail.webp");
  });

  it("keeps the engine build that made an entry's image, and none when the index names none", async () => {
    const entry = (engine?: string) => ({
      id: "a1",
      title: "Collar",
      credit: "",
      imageUrl: "gallery/a1/image.png",
      recipeUrl: "gallery/a1/recipe.json",
      publishedAt: "2026-10-13T04:48:39.996Z",
      ...(engine === undefined ? {} : { engine }),
    });
    const fetcher = (async () => Response.json({ entries: [entry("app/528a718f4e655b9c/dinodreamer_engine_bg.wasm"), entry(), entry("")] })) as unknown as typeof fetch;
    const [named, unnamed, blank] = await fetchGallery(BASE, fetcher);
    expect(named!.engine).toBe("app/528a718f4e655b9c/dinodreamer_engine_bg.wasm");
    expect("engine" in unnamed!).toBe(false);
    expect("engine" in blank!).toBe(false);
  });

  it("refuses an index without an entries list or with an incomplete entry", async () => {
    const answer = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
    await expect(fetchGallery(BASE, answer([]))).rejects.toThrow(/no entries list/);
    await expect(fetchGallery(BASE, answer({ entries: [{ id: "a1" }] }))).rejects.toThrow(/entry 0 has no title/);
  });

  it("parses a published recipe before the editor sees it", async () => {
    const entry = { id: "a1", title: "Collar", credit: "", imageUrl: "", thumbnailUrl: null, recipeUrl: "https://x/r.json", publishedAt: "" };
    const good = (async () => Response.json(recipe())) as unknown as typeof fetch;
    const bad = (async () => Response.json({ format: 1 })) as unknown as typeof fetch;
    expect(await fetchGalleryRecipe(entry, good)).toEqual({ recipe: recipe() });
    await expect(fetchGalleryRecipe(entry, bad)).rejects.toThrow(/recipe.rules: expected an object/);
  });

  it("says when an earlier objective made the entry's image: a format-3 recipe with Appearance on", async () => {
    const entry = { id: "a1", title: "Collar", credit: "", imageUrl: "", thumbnailUrl: null, recipeUrl: "https://x/r.json", publishedAt: "" };
    const current = recipe();
    const request = current.requests[0]!;
    const asWritten = (lookEnabled: boolean) => ({
      ...current,
      format: 3,
      requests: [
        {
          ...request,
          respondLike: { ...request.respondLike, where: area() },
          lookLike: { ...request.lookLike, enabled: lookEnabled, where: area() },
        },
      ],
    });
    const answer = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
    const marked = await fetchGalleryRecipe(entry, answer(asWritten(true)));
    expect(marked.upgradedFrom).toBe(3);
    expect(marked.recipe).toEqual(recipe());
    // Code only (the doggy ear entry): the upgraded recipe still makes the image, so no mark.
    expect("upgradedFrom" in (await fetchGalleryRecipe(entry, answer(asWritten(false))))).toBe(false);
  });
});

describe("submissions", () => {
  it("refuses a creation whose image was made by an earlier objective, with what to do", () => {
    expect(creationProblems({ upgradedFrom: 3 })).toEqual([
      "This image was made with Appearance before painted strength. Open it, run it again, and submit the new image.",
    ]);
    expect(creationProblems({ upgradedFrom: 1 })).toEqual([
      "This image was made with the brush from before October 11. Open it, run it again, and submit the new image.",
    ]);
    expect(creationProblems({ upgradedFrom: 2 })).toEqual([
      "This image was made with the Whole canvas term from before October 13. Open it, run it again, and submit the new image.",
    ]);
    expect(creationProblems({})).toEqual([]);
  });

  it("names every limit the Worker enforces", () => {
    const invalid = recipe();
    invalid.requests[0]!.lookLike.references = [];
    invalid.requests[0]!.block = 16384;
    const problems = submissionProblems(
      {
        image: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]),
        recipe: invalid,
        title: " ",
        credit: "x".repeat(41),
      },
      { blocks: 16384 },
    );
    expect(problems).toEqual([
      "Give your image a title.",
      "The credit is longer than 40 characters.",
      "The image is larger than 2 MB.",
      "Image-editing configuration: constraint 1: basis group 16384 is outside the basis collection.",
      "Image-editing configuration: constraint 1: Look like is on but has no references.",
    ]);
    expect(submissionProblems({ image: png, recipe: recipe(), title: "Collar", credit: "" }, { blocks: 16384 })).toEqual([]);
  });

  it("posts the four multipart fields and returns the id", async () => {
    let sent: FormData | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return Response.json({ id: "s9" });
    }) as unknown as typeof fetch;
    expect(await submitCreation({ image: png, recipe: recipe(), title: " Collar ", credit: "Contributor" }, null, fetcher)).toEqual({ id: "s9" });
    const form = sent! as FormData;
    expect(form.get("title")).toBe("Collar");
    expect(form.get("credit")).toBe("Contributor");
    expect(JSON.parse(await (form.get("recipe") as Blob).text())).toEqual(recipe());
    expect((form.get("image") as Blob).size).toBe(4);
    expect(form.has("turnstileToken")).toBe(false);
    expect(form.has("engine")).toBe(false);
  });

  it("names the engine that made the image when the creation records one, and omits a blank", async () => {
    const posted = async (engine: string | undefined) => {
      let sent: FormData | null = null;
      const fetcher = (async (_url: string, init: RequestInit) => {
        sent = init.body as FormData;
        return Response.json({ id: "s9" });
      }) as unknown as typeof fetch;
      await submitCreation({ image: png, recipe: recipe(), title: "Collar", credit: "", engine }, null, fetcher);
      return (sent! as FormData).get("engine");
    };
    expect(await posted("dinodreamer-engine-3a1f.wasm")).toBe("dinodreamer-engine-3a1f.wasm");
    expect(await posted(" ")).toBeNull();
    expect(await posted(undefined)).toBeNull();
  });

  it("adds the Turnstile token as a fifth field when the form has one", async () => {
    let sent: FormData | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return Response.json({ id: "s9" });
    }) as unknown as typeof fetch;
    await submitCreation({ image: png, recipe: recipe(), title: "Collar", credit: "" }, "XXXX.DUMMY.TOKEN.XXXX", fetcher);
    expect((sent! as FormData).get("turnstileToken")).toBe("XXXX.DUMMY.TOKEN.XXXX");
  });

  it("shows the Worker's reason for a refusal", async () => {
    const fetcher = (async () => Response.json({ error: "Too many submissions; try again in an hour." }, { status: 429 })) as unknown as typeof fetch;
    await expect(submitCreation({ image: png, recipe: recipe(), title: "Collar", credit: "" }, null, fetcher)).rejects.toThrow(
      "Too many submissions; try again in an hour.",
    );
  });
});
