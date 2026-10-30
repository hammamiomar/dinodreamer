import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Link } from "react-router";
import { canvasPixelRatio, pageScale } from "../../ui/page-scale";
import { BasisGroupLink } from "../look/basis-group-panel";
import { useLibrary } from "../../app/library-session";
import type {
  AtlasBand,
  AtlasCloud,
  AtlasIndexEntry,
  AtlasManifest,
  BandCounts,
} from "../../library/atlas-cloud";
import type { Library } from "../../library/library";
import { LibraryImage, loadLibraryPicture } from "../../ui/library-image";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { useLoaded } from "../../ui/use-loaded";
import { CardLoader, LoadQueue, PICTURE_LOADS_AT_ONCE, pictureSlots, SCREEN_ONLY_LOADS, type PictureSlot } from "./card-loading";
import { ATLAS_TEXT } from "./atlas-text";
import { BAND_COLOURS, bandColours } from "../look/strength-bands";
import { LOOK_TEXT } from "../look/look-text";
import { growPath } from "../look/strongest-request";

const NO_SLOTS: readonly (readonly PictureSlot[])[] = [[], [], [], []];

/** One card loader per library: its records and decoded pictures, shared by every card and the next page's read-ahead. */
const loaders = new WeakMap<Library, CardLoader>();
export function cardLoader(library: Library): CardLoader {
  let loader = loaders.get(library);
  if (!loader) {
    loader = new CardLoader(
      {
        atlasCloud: (block) => library.atlasCloud(block),
        thumbnailUrl: (imageId) => library.thumbnailUrl(imageId),
        decodePicture: (url, priority) => loadLibraryPicture(url, priority === "screen" ? { priority: "high" } : {}),
      },
      new LoadQueue(PICTURE_LOADS_AT_ONCE, SCREEN_ONLY_LOADS),
    );
    loaders.set(library, loader);
  }
  return loader;
}

/**
 * Cards read one screen ahead of the view, above and below; their picture loads queue behind
 * the visible ones. Two screens measured slower on Fast 4G: the extra loads took bandwidth.
 */
const READ_AHEAD_MARGIN = "100% 0px";

/** Whether an element is in the view now; read when a card starts loading, before its first visibility report. */
function inView(element: HTMLElement | null): boolean {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

/** Whether the card is within `margin` of the view; once near it stays near. */
function useNearScreen(ref: RefObject<HTMLElement | null>, margin = READ_AHEAD_MARGIN): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!ref.current || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref, margin]);
  return near;
}

/** Whether the card is in view now. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/** A category's name in Explore's words; a word that a later table adds shows as it is. */
function categoryName(word: string): string {
  return Object.hasOwn(ATLAS_TEXT.families, word) ? ATLAS_TEXT.families[word as keyof typeof ATLAS_TEXT.families] : word;
}

/**
 * One block on the Index: its number and category on a line, its
 * cloud, and four pictures per band with the band's count. The card is shown whole: until its
 * record is read and its pictures decoded, it keeps its place with a hidden copy of its layout,
 * drawn from the index's counts. Every cloud has the same box height, so neighbouring cards'
 * pictures, level headings and count bars share the same rows.
 */
export function CloudBlockCard({
  entry,
  category,
  engine,
}: {
  entry: AtlasIndexEntry;
  /** The block's response category word (the patch role's), or null for a block without one. */
  category: string | null;
  engine: string | null;
}) {
  const library = useLibrary();
  const self = useRef<HTMLElement>(null);
  const near = useNearScreen(self);
  const onScreen = useOnScreen(self);
  const [attempt, retry] = useState(0);
  const [highlight, setHighlight] = useState<AtlasBand | null>(null);
  const loader = cardLoader(library);
  const content = useLoaded(near ? `${entry.block}:${attempt}` : null, () =>
    near ? loader.load(entry.block, onScreen || inView(self.current) ? "screen" : "ahead") : null,
  );
  useEffect(() => {
    if (onScreen) loader.promote(entry.block);
  }, [loader, onScreen, entry.block]);
  useEffect(() => () => loader.release(entry.block), [loader, entry.block]);
  const cloud = content.status === "ready" ? content.value.cloud : null;
  // A thumbnail that failed to load, before the card was shown or after: its slot shows the
  // band's next picture or a tile, never a broken image.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const failed = content.status === "ready" ? content.value.failed : null;
  const slots = useMemo(() => {
    if (!cloud || !failed) return null;
    return pictureSlots(cloud.pictures, (picture) => {
      const url = library.thumbnailUrl(picture.imageId);
      return failed.has(url) || broken.has(url);
    });
  }, [cloud, failed, broken, library]);
  // The number, the cloud and the pictures open the basis group in the panel over the Index, which stays as it is (basis-group-panel.tsx).
  return (
    <article
      ref={self}
      className="atlas-cloud-card"
      data-block={entry.block}
      data-ready={cloud !== null}
    >
      <header className="atlas-cloud-identity">
        <BasisGroupLink className="atlas-block-number heading" block={entry.block} aria-label={ATLAS_TEXT.openBlock(entry.block)} />
        {category !== null && <span className="atlas-cloud-category">{ATLAS_TEXT.category.card(categoryName(category))}</span>}
        <Link className="atlas-grow" to={growPath(entry.block, engine === "fake" ? "?engine=fake" : "")}>
          {LOOK_TEXT.grow}
        </Link>
      </header>
      {cloud ? (
        <>
          <BasisGroupLink
            className="atlas-cloud-area"
            block={entry.block}
            aria-label={ATLAS_TEXT.cloudName(entry.block, cloud.points.length)}
          >
            <CloudGlyph cloud={cloud} highlight={highlight} />
          </BasisGroupLink>
          {cloud.total > 0 ? (
            <BandStrip
              block={entry.block}
              counts={cloud.counts}
              total={cloud.total}
              slots={slots ?? NO_SLOTS}
              onBroken={(url) => setBroken((known) => new Set(known).add(url))}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          ) : (
            <p className="atlas-cloud-status">{ATLAS_TEXT.emptyCloud}</p>
          )}
        </>
      ) : (
        <div className="atlas-cloud-waiting">
          {/* The card's own layout, hidden: it holds the card's place, so nothing moves when the card is shown. */}
          <div className="atlas-cloud-skeleton" aria-hidden="true">
            <div className="atlas-cloud-area" />
            {entry.total > 0 && (
              <BandStrip block={entry.block} counts={entry.counts} total={entry.total} slots={NO_SLOTS} highlight={null} onHighlight={() => {}} skeleton />
            )}
          </div>
          {content.status !== "failed" && <div className="atlas-cloud-loading"><LoadingIndicator>Loading basis group…</LoadingIndicator></div>}
          {content.status === "failed" && (
            <div className="atlas-cloud-failed" role="status">
              <p>{ATLAS_TEXT.failed}</p>
              <button className="link-control" onClick={() => retry((value) => value + 1)}>
                {ATLAS_TEXT.retry}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** The most screen pixels per unit of response, so a small cloud is not blown up past its dots. */
const CLOUD_MOST_PX_PER_UNIT = 32;
/** Dot radius in page pixels. */
const CLOUD_DOT_RADIUS = 1.5;

/**
 * The cloud at a glance: the ring and the record's points (at most 512) in their bands. An Index
 * card uses its own extent inside a fixed-height box, keeping small clouds legible. The block
 * panel fits the ring and points into its parent box, whose dimensions come from CSS.
 */
export function CloudGlyph({
  cloud,
  fill = false,
  highlight = null,
}: {
  cloud: AtlasCloud;
  fill?: boolean;
  /** A band the pointer is over on the card: the other bands' dots fade. */
  highlight?: AtlasBand | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Drawn before the card is painted, so a card is never shown with an empty cloud.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // CSS owns the cloud box: five modules in the Index, the heading's smaller box in a panel.
    const box = element.parentElement!;
    const draw = () => {
      // Page pixels: the box on the screen, less the page scale (ui/page-scale.ts).
      const scaleOfPage = pageScale(element);
      const screenBox = box.getBoundingClientRect();
      const width = screenBox.width / scaleOfPage;
      const height = screenBox.height / scaleOfPage;
      if (!width) return;
      const span = ownDomain(cloud);
      const verticalExtent = Math.max(
        cloud.ring,
        ...cloud.points.map((point) => Math.abs(point.y)),
      );
      let scale: number;
      if (!fill) {
        // Each cloud keeps its own drawing scale inside the same five-module box. The card's rows
        // do not move when a cloud is flatter, taller, or still loading.
        scale = Math.min(CLOUD_MOST_PX_PER_UNIT, (width - 24) / (span.xMax - span.xMin), (height / 2 - 4) / (verticalExtent + 1));
      } else {
        // The whole cloud inside the box, with a 4 px margin for the dots' radius.
        scale = Math.min((width - 8) / (span.xMax - span.xMin), (height - 8) / (2 * verticalExtent));
      }
      element.style.height = `${height}px`;
      const ratio = canvasPixelRatio(element, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const left = (width - (span.xMax - span.xMin) * scale) / 2;
      const x = (value: number) => left + (value - span.xMin) * scale;
      const y = (value: number) => height / 2 - value * scale;
      const styles = getComputedStyle(element);
      context.strokeStyle =
        styles.getPropertyValue("--ink-3").trim() || "#5e5b57";
      context.fillStyle = context.strokeStyle;
      context.beginPath();
      context.arc(x(0), y(0), cloud.ring * scale, 0, 2 * Math.PI);
      context.globalAlpha = 0.05;
      context.fill();
      context.globalAlpha = 0.8;
      context.lineWidth = 0.8;
      context.stroke();
      for (const point of cloud.points) {
        context.fillStyle = bandColours()[point.band];
        context.globalAlpha =
          highlight === null || point.band === highlight ? 0.8 : 0.12;
        context.beginPath();
        context.arc(x(point.x), y(point.y), CLOUD_DOT_RADIUS, 0, 2 * Math.PI);
        context.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [cloud, fill, highlight]);
  return <canvas ref={canvas} aria-hidden="true" />;
}

/** The horizontal span of one record: its ring on both sides and every point. */
function ownDomain(cloud: AtlasCloud): Pick<AtlasManifest["domain"], "xMin" | "xMax"> {
  let xMin = -cloud.ring;
  let xMax = cloud.ring;
  for (const point of cloud.points) {
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
  }
  return { xMin, xMax };
}

function BandStrip({
  block,
  counts,
  total,
  slots,
  onBroken = () => {},
  highlight,
  onHighlight,
  skeleton = false,
}: {
  block: number;
  counts: BandCounts;
  total: number;
  /** Each band's slots (pictureSlots). */
  slots: readonly (readonly PictureSlot[])[];
  /** A picture that the browser could not show, after the library's heal and retry. */
  onBroken?: (url: string) => void;
  highlight: AtlasBand | null;
  onHighlight: (band: AtlasBand | null) => void;
  /** The hidden copy that holds a waiting card's place: no pictures, and the count bar's height without its drawing. */
  skeleton?: boolean;
}) {
  const library = useLibrary();
  const self = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 1, centres: [0, 0, 0, 0] });
  useLayoutEffect(() => {
    const element = self.current;
    if (!element || skeleton) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const scale = pageScale(element);
      const centres = [...element.querySelectorAll(".atlas-band-group")].map(
        (group) => {
          const rect = group.getBoundingClientRect();
          return (rect.left - bounds.left + rect.width / 2) / scale;
        },
      );
      // The SVG's fixed height and its measured width must both use page pixels.
      setGeometry({ width: bounds.width / scale, centres });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [skeleton]);
  const width = Math.max(1, geometry.width - 16);
  let before = 0;
  return (
    <div
      ref={self}
      className="atlas-strength-strip"
      onPointerLeave={() => onHighlight(null)}
    >
      <div className="atlas-band-groups">
        {slots.map((group, index) => {
          const band = index as AtlasBand;
          return (
            // A group of pictures named by its band, not a section: it has no heading of its own.
            <div
              className="atlas-band-group"
              role="group"
              aria-label={ATLAS_TEXT.bands[band]}
              key={band}
              data-band={band}
              data-dim={highlight !== null && highlight !== band}
              style={{ "--band": BAND_COLOURS[band] } as CSSProperties}
              onPointerEnter={() => onHighlight(band)}
            >
              <div className="atlas-band-pictures">
                {group.map((shown, position) => {
                  if (shown.kind === "tile") return <span key={`tile:${position}`} className="atlas-patch-picture atlas-picture-tile" aria-hidden="true" />;
                  const { picture } = shown;
                  const url = library.thumbnailUrl(picture.imageId);
                  return (
                    <BasisGroupLink
                      key={`${picture.imageId}:${picture.slot}:${position}`}
                      block={block}
                      className="atlas-patch-picture"
                      onFocus={() => onHighlight(band)}
                      onBlur={() => onHighlight(null)}
                    >
                      {/* Decoded before the card is shown (card-loading.ts). */}
                      <LibraryImage
                        decoding="sync"
                        src={url}
                        alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[band])}
                        onError={() => onBroken(url)}
                      />
                      <i
                        style={{
                          left: `${(((picture.slot - 5) % 16) / 16) * 100}%`,
                          top: `${(Math.floor((picture.slot - 5) / 16) / 16) * 100}%`,
                        }}
                      />
                    </BasisGroupLink>
                  );
                })}
              </div>
              <div className="atlas-band-heading">
                <b>{ATLAS_TEXT.bands[band]}</b>
                <span>{ATLAS_TEXT.count(counts[band], total)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {skeleton ? (
        <div className="atlas-count-bar" />
      ) : (
        <svg
          className="atlas-count-bar"
          viewBox={`0 0 ${geometry.width} 48`}
          role="img"
          aria-label={ATLAS_TEXT.stripBar}
        >
          {counts.map((count, band) => {
            const segmentWidth = (count / total) * width;
            const start = geometry.centres[band];
            const left = 8 + before;
            const centre = left + segmentWidth / 2;
            before += segmentWidth;
            const visible = highlight === null || highlight === band;
            return (
              <g key={band} opacity={visible ? 1 : 0.2}>
                <path
                  d={`M${start},0 L${start},6 L${centre},27 L${centre},34`}
                  fill="none"
                  stroke={bandColours()[band]}
                  strokeOpacity="0.6"
                  strokeWidth="0.8"
                />
                <rect
                  data-band={band}
                  x={left}
                  y="34"
                  width={segmentWidth}
                  height="8"
                  fill={bandColours()[band]}
                />
              </g>
            );
          })}
          <circle cx="8" cy="38" r="7" className="atlas-count-ring" />
          <path
            d={`M${geometry.width - 7},34 L${geometry.width - 2},38 L${geometry.width - 7},42`}
            className="atlas-count-arrow"
          />
        </svg>
      )}
    </div>
  );
}
