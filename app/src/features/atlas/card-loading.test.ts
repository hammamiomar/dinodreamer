import { describe, expect, it } from "vitest";
import type { AtlasCloud } from "../../library/atlas-cloud";
import { CardLoader, LoadQueue, pictureSlots, type CardSource, type LoadPriority } from "./card-loading";

/** A load the test finishes by hand, with a record of which loads started. */
function manualLoads() {
  const started: string[] = [];
  const finish = new Map<string, (value: string) => void>();
  const fail = new Map<string, (error: Error) => void>();
  const load = (key: string) => () => new Promise<string>((resolve, reject) => {
    started.push(key);
    finish.set(key, resolve);
    fail.set(key, reject);
  });
  return { started, finish, fail, load };
}
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("the picture queue", () => {
  it("runs at most its limit at once and starts the next when one ends", async () => {
    const queue = new LoadQueue(2);
    const loads = manualLoads();
    const runs = new Map(["a", "b", "c", "d"].map((key) => [key, queue.run(key, "ahead", loads.load(key))]));
    expect(loads.started).toEqual(["a", "b"]);
    loads.finish.get("a")!("done");
    await expect(runs.get("a")).resolves.toBe("done");
    expect(loads.started).toEqual(["a", "b", "c"]);
    // A failed load reaches its caller and still frees its place.
    loads.fail.get("b")!(new Error("offline"));
    await expect(runs.get("b")).rejects.toThrow("offline");
    await settle();
    expect(loads.started).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps slots for the cards on screen while loads for cards ahead are running", async () => {
    const queue = new LoadQueue(4, 2);
    const loads = manualLoads();
    for (const key of ["ahead-1", "ahead-2", "ahead-3"]) void queue.run(key, "ahead", loads.load(key));
    expect(loads.started).toEqual(["ahead-1", "ahead-2"]);
    void queue.run("screen-1", "screen", loads.load("screen-1"));
    void queue.run("screen-2", "screen", loads.load("screen-2"));
    void queue.run("screen-3", "screen", loads.load("screen-3"));
    expect(loads.started).toEqual(["ahead-1", "ahead-2", "screen-1", "screen-2"]);
    expect(queue.queued()).toEqual(["screen-3", "ahead-3"]);
  });

  it.each(["promote", "run"] as const)("uses free reserved slots immediately after %s", (method) => {
    const queue = new LoadQueue(4, 2);
    const loads = manualLoads();
    for (const key of ["first", "second", "visible"]) void queue.run(key, "ahead", loads.load(key));
    if (method === "promote") queue.promote("visible");
    else void queue.run("visible", "screen", loads.load("visible"));
    expect(loads.started).toEqual(["first", "second", "visible"]);
    expect(queue.queued()).toEqual([]);
  });

  it("rejects synchronous failures and releases the slot for the next load", async () => {
    const queue = new LoadQueue(1);
    const failed = queue.run("failed", "screen", () => { throw new Error("decode failed"); });
    const next = queue.run("next", "screen", async () => "loaded");
    await expect(failed).rejects.toThrow("decode failed");
    await expect(next).resolves.toBe("loaded");
  });

  it("starts the cards on screen before the cards ahead, each in arrival order", async () => {
    const queue = new LoadQueue(1);
    const loads = manualLoads();
    void queue.run("busy", "screen", loads.load("busy"));
    void queue.run("ahead-1", "ahead", loads.load("ahead-1"));
    void queue.run("ahead-2", "ahead", loads.load("ahead-2"));
    void queue.run("screen-1", "screen", loads.load("screen-1"));
    void queue.run("screen-2", "screen", loads.load("screen-2"));
    expect(queue.queued()).toEqual(["screen-1", "screen-2", "ahead-1", "ahead-2"]);
  });

  it("gives one load per key, and asking it on screen moves it forward", async () => {
    const queue = new LoadQueue(1);
    const loads = manualLoads();
    void queue.run("busy", "screen", loads.load("busy"));
    const first = queue.run("ahead-1", "ahead", loads.load("ahead-1"));
    void queue.run("ahead-2", "ahead", loads.load("ahead-2"));
    expect(queue.run("ahead-2", "screen", loads.load("ahead-2"))).not.toBe(first);
    expect(queue.queued()).toEqual(["ahead-2", "ahead-1"]);
    expect(queue.run("ahead-1", "ahead", loads.load("ahead-1"))).toBe(first);
    // Both on screen now: arrival order decides.
    queue.promote("ahead-1");
    expect(queue.queued()).toEqual(["ahead-1", "ahead-2"]);
  });
});

it("puts the loads of a card that left the page behind all others, until they are asked again", () => {
  const queue = new LoadQueue(1);
  const loads = manualLoads();
  void queue.run("busy", "screen", loads.load("busy"));
  void queue.run("left", "screen", loads.load("left"));
  void queue.run("ahead", "ahead", loads.load("ahead"));
  queue.demote("left");
  expect(queue.queued()).toEqual(["ahead", "left"]);
  void queue.run("left", "ahead", loads.load("left"));
  expect(queue.queued()).toEqual(["left", "ahead"]);
});

describe("a card's content", () => {
  const cloud = (block: number, pictures: number) => ({
    block,
    pictures: Array.from({ length: pictures }, (_, index) => ({ imageId: block * 100 + index, slot: 5, band: 0 })),
  }) as unknown as AtlasCloud;

  function source(records: Map<number, AtlasCloud | Error>, failing = new Set<string>()) {
    const reads: number[] = [];
    const decodes: Array<[string, LoadPriority]> = [];
    const value: CardSource = {
      atlasCloud: async (block) => {
        reads.push(block);
        const record = records.get(block)!;
        if (record instanceof Error) throw record;
        return record;
      },
      thumbnailUrl: (imageId) => `thumb/${imageId}`,
      decodePicture: async (url, priority) => {
        decodes.push([url, priority]);
        if (failing.has(url)) throw new Error("no picture");
        return { src: url } as HTMLImageElement;
      },
    };
    return { value, reads, decodes };
  }

  it("reads the record, then decodes every picture, counting the ones that fail", async () => {
    const { value, decodes } = source(new Map([[7, cloud(7, 3)]]), new Set(["thumb/701"]));
    const content = await new CardLoader(value, new LoadQueue(4)).load(7, "screen");
    expect(content.cloud.block).toBe(7);
    expect(content.pictures.map((picture) => picture.src)).toEqual(["thumb/700", "thumb/702"]);
    expect([...content.failed]).toEqual(["thumb/701"]);
    expect(decodes).toEqual([["thumb/700", "screen"], ["thumb/701", "screen"], ["thumb/702", "screen"]]);
  });

  it("shares one load between the card and the read-ahead, and reads a failed record again", async () => {
    const records = new Map<number, AtlasCloud | Error>([[3, new Error("503")]]);
    const { value, reads } = source(records);
    const loader = new CardLoader(value, new LoadQueue(4));
    const ahead = loader.load(3, "ahead");
    expect(loader.load(3, "screen")).toBe(ahead);
    await expect(ahead).rejects.toThrow("503");
    records.set(3, cloud(3, 1));
    await expect(loader.load(3, "screen")).resolves.toMatchObject({ failed: new Set() });
    expect(reads).toEqual([3, 3]);
  });

  it("retains only the most recently used cards, including prefetched cards that were never shown", async () => {
    const records = new Map([1, 2, 3].map((block) => [block, cloud(block, 1)]));
    const { value, reads } = source(records);
    const loader = new CardLoader(value, new LoadQueue(4), 2);
    const first = await loader.load(1, "ahead");
    await loader.load(2, "ahead");
    expect(await loader.load(1, "screen")).toBe(first);
    await loader.load(3, "ahead");
    expect(await loader.load(1, "screen")).toBe(first);
    await loader.load(2, "ahead");
    expect(reads).toEqual([1, 2, 3, 2]);
  });

  it("loads a card ahead at low priority, and moves its waiting pictures forward when it comes into view", async () => {
    const queue = new LoadQueue(1);
    const loads = manualLoads();
    void queue.run("busy", "screen", loads.load("busy"));
    const { value } = source(new Map([[5, cloud(5, 2)], [6, cloud(6, 1)]]));
    const loader = new CardLoader(value, queue);
    void loader.load(5, "ahead");
    void loader.load(6, "ahead");
    await settle();
    expect(queue.queued()).toEqual(["thumb/500", "thumb/501", "thumb/600"]);
    void loader.load(6, "screen");
    expect(queue.queued()).toEqual(["thumb/600", "thumb/500", "thumb/501"]);
    loader.release(6);
    expect(queue.queued()).toEqual(["thumb/500", "thumb/501", "thumb/600"]);
  });
});

describe("the picture slots of a card", () => {
  const picture = (imageId: number, band: 0 | 1 | 2 | 3) => ({ imageId, slot: 5, band });
  const ids = (slots: ReturnType<typeof pictureSlots>) => slots.map((band) => band.map((slot) => (slot.kind === "picture" ? slot.picture.imageId : `tile ${slot.band}`)));

  it("shows each band's pictures in record order, a slot per picture up to four", () => {
    const pictures = [picture(1, 0), picture(2, 0), picture(3, 1), picture(4, 3), picture(5, 3)];
    expect(ids(pictureSlots(pictures, () => false))).toEqual([[1, 2], [3], [], [4, 5]]);
  });

  it("gives a failed picture's slot to the band's next picture, else a tile in the band's colour", () => {
    // Five Weakly pictures in the record: the fifth stands in for the failed second.
    const pictures = [1, 2, 3, 4, 5].map((imageId) => picture(imageId, 1)).concat([picture(6, 3)]);
    const failed = new Set([2, 6]);
    expect(ids(pictureSlots(pictures, (shown) => failed.has(shown.imageId)))).toEqual([[], [1, 3, 4, 5], [], ["tile 3"]]);
  });
});
