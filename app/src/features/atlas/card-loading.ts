import { ATLAS_PICTURES_PER_BAND, type AtlasBand, type AtlasCloud } from "../../library/atlas-cloud";

// How an Atlas card's record and pictures load, so a card is shown whole. A card reads its
// record and decodes its sixteen thumbnails before it is shown (cloud-card.tsx); until then
// it keeps its place with a hidden copy of its layout. Cards read one screen ahead of the
// view, and the next page's first cards when the reader nears the end of a page. Picture
// loads wait in one queue with a concurrency limit: the cards on screen go first, so the
// cards ahead do not take the bandwidth the visible ones need (Fast 4G).

/** "screen": the card is in view; "ahead": it is near the view or on the next page. */
export type LoadPriority = "screen" | "ahead";

/**
 * Picture loads in flight at once: two cards' sixteen, so a desktop's first screen goes out
 * in one wave (HTTP/2 carries them on one connection). More waits in the queue, the cards
 * on screen first.
 */
export const PICTURE_LOADS_AT_ONCE = 32;
/**
 * Slots only the cards on screen may use: one card's sixteen. Loads for cards ahead cannot
 * fill the queue, so a card that comes into view starts at once, even while slower loads
 * for the cards ahead are still on the network.
 */
export const SCREEN_ONLY_LOADS = 16;
/** The next page's first cards, read ahead when the reader nears the end of a page: two rows on a desktop. */
export const NEXT_PAGE_CARDS = 4;

interface Waiting {
  key: string;
  /** "stale": its card left the page; it starts only when nothing else waits. */
  priority: LoadPriority | "stale";
  /** Arrival order: equal priorities start first come, first served. */
  order: number;
  start: () => void;
  cancel: () => void;
}

/**
 * Loads with a concurrency limit, of which `screenOnly` slots are kept for loads on screen.
 * A load for a key already waiting or running is the same load; asking it again at
 * "screen" moves a waiting "ahead" load forward. Pure: the load itself is the caller's
 * function, so the order can be tested without a network.
 */
export class LoadQueue {
  private readonly waiting: Waiting[] = [];
  private readonly loads = new Map<string, Promise<unknown>>();
  private running = 0;
  private arrivals = 0;

  constructor(private readonly limit: number, private readonly screenOnly = 0) {}

  run<T>(key: string, priority: LoadPriority, load: () => Promise<T>): Promise<T> {
    const known = this.loads.get(key);
    if (known) {
      const entry = this.waiting.find((waiting) => waiting.key === key);
      if (entry && rank(priority) < rank(entry.priority)) {
        entry.priority = priority;
        this.next();
      }
      return known as Promise<T>;
    }
    const result = new Promise<T>((resolve, reject) => {
      this.waiting.push({
        key,
        priority,
        order: this.arrivals++,
        start: async () => {
          this.running++;
          try {
            resolve(await load());
          } catch (error) {
            reject(error);
          } finally {
            this.running--;
            this.loads.delete(key);
            this.next();
          }
        },
        cancel: () => {
          this.loads.delete(key);
          reject(new Error(`Load cancelled: ${key}`));
        },
      });
    });
    this.loads.set(key, result);
    this.next();
    return result;
  }

  /** Waiting loads, in the order they will start. */
  queued(): string[] {
    return [...this.waiting].sort(startOrder).map((entry) => entry.key);
  }

  /** A waiting load moves ahead of the "ahead" ones; a running or unknown one is left alone. */
  promote(key: string) {
    const entry = this.waiting.find((waiting) => waiting.key === key);
    if (entry) {
      entry.priority = "screen";
      this.next();
    }
  }

  /**
   * A waiting load whose card left the page goes behind every other. It is not cancelled:
   * another card may show the same picture, and asking for it again raises it.
   */
  demote(key: string) {
    const entry = this.waiting.find((waiting) => waiting.key === key);
    if (entry) entry.priority = "stale";
  }

  /**
   * Remove a still-waiting load so departed cards never starve visible ones. Loads already
   * running continue to completion so in-flight work is not wasted.
   */
  cancel(key: string) {
    const index = this.waiting.findIndex((waiting) => waiting.key === key);
    if (index === -1) return;
    const [removed] = this.waiting.splice(index, 1);
    removed!.cancel();
  }

  private next() {
    this.waiting.sort(startOrder);
    while (this.waiting.length > 0) {
      const room = this.waiting[0].priority === "screen" ? this.limit : this.limit - this.screenOnly;
      if (this.running >= room) break;
      this.waiting.shift()!.start();
    }
  }
}

const rank = (priority: Waiting["priority"]) => ({ screen: 0, ahead: 1, stale: 2 })[priority];

function startOrder(a: Waiting, b: Waiting): number {
  return rank(a.priority) - rank(b.priority) || a.order - b.order;
}

/** A card's record with its pictures decoded. */
export interface CardContent {
  cloud: AtlasCloud;
  /** Thumbnail URLs that could not be read, after the library's one heal and retry. */
  failed: ReadonlySet<string>;
  /** The decoded pictures, held while the card shows them so the browser keeps them decoded. */
  pictures: readonly HTMLImageElement[];
}

type AtlasPicture = AtlasCloud["pictures"][number];
/** One slot of a band's strip: a picture, or a neutral tile in the band's colour. */
export type PictureSlot = { kind: "picture"; picture: AtlasPicture } | { kind: "tile"; band: AtlasBand };

/**
 * What each band of a card shows, in band order: as many slots as the record has pictures
 * for the band, at most four. A slot takes the band's pictures in record order, passing over
 * any that failed; a slot left with no picture is a tile. A picture that failed is never
 * shown broken.
 */
export function pictureSlots(pictures: readonly AtlasPicture[], failed: (picture: AtlasPicture) => boolean): PictureSlot[][] {
  return ([0, 1, 2, 3] as const).map((band) => {
    const ofBand = pictures.filter((picture) => picture.band === band);
    const readable = ofBand.filter((picture) => !failed(picture));
    const slots = Math.min(ofBand.length, ATLAS_PICTURES_PER_BAND);
    return Array.from({ length: slots }, (_, slot): PictureSlot =>
      slot < readable.length ? { kind: "picture", picture: readable[slot]! } : { kind: "tile", band });
  });
}

/** The library calls a card's loading needs: its record, and a decoded picture by URL. */
export interface CardSource {
  atlasCloud(block: number): Promise<AtlasCloud>;
  thumbnailUrl(imageId: number): string;
  decodePicture(url: string, priority: LoadPriority): Promise<HTMLImageElement>;
}

/** Two pages of decoded pictures, including cards prefetched but never visited. */
const CACHED_CARDS = 48;

/**
 * Recent card content shared by the cards and prefetch. The cache has a fixed bound;
 * mounted cards also hold their content. A failed record is forgotten so it can be retried.
 */
export class CardLoader {
  private readonly contents = new Map<number, { content: Promise<CardContent>; urls: string[] }>();

  constructor(
    private readonly source: CardSource,
    private readonly queue: LoadQueue,
    private readonly capacity = CACHED_CARDS,
  ) {}

  load(block: number, priority: LoadPriority): Promise<CardContent> {
    if (priority === "screen") this.promote(block);
    const known = this.contents.get(block);
    if (known) {
      this.contents.delete(block);
      this.contents.set(block, known);
      return known.content;
    }
    const urls: string[] = [];
    const content = this.read(block, urls);
    this.contents.set(block, { content, urls });
    while (this.contents.size > this.capacity) this.contents.delete(this.contents.keys().next().value!);
    content.catch(() => {
      if (this.contents.get(block)?.content === content) this.contents.delete(block);
    });
    return content;
  }

  /** A card came into view: its pictures are asked at "screen", and those still waiting move to the front. */
  promote(block: number) {
    this.onScreen.add(block);
    for (const url of this.contents.get(block)?.urls ?? []) this.queue.promote(url);
  }

  /** A card left the page (another page, another search): its waiting pictures go behind all others. */
  release(block: number) {
    this.onScreen.delete(block);
    for (const url of this.contents.get(block)?.urls ?? []) this.queue.demote(url);
  }

  /** Blocks whose cards have been in view; their pictures load at "screen". */
  private readonly onScreen = new Set<number>();

  private async read(block: number, urls: string[]): Promise<CardContent> {
    const cloud = await this.source.atlasCloud(block);
    urls.push(...cloud.pictures.map((picture) => this.source.thumbnailUrl(picture.imageId)));
    const priority: LoadPriority = this.onScreen.has(block) ? "screen" : "ahead";
    const settled = await Promise.allSettled(urls.map((url) => this.queue.run(url, priority, () => this.source.decodePicture(url, priority))));
    const pictures = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failed = new Set(urls.filter((_, index) => settled[index]!.status === "rejected"));
    return { cloud, failed, pictures };
  }
}
