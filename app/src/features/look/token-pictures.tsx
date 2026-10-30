import { useEffect, useRef, useState } from "react";
import { useLibrary } from "../../app/library-session";
import { GRID, PATCH_SLOT_OFFSET, type StrengthCuts } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { sameValues } from "../../ui/tween";
import { cloudTokenKey, cloudTokenPicture, type CloudToken } from "./cloud-token";
import { LOOK_TEXT } from "./look-text";
import { BandChip } from "./strength-display";
import { bandIndex, lobePosition } from "./strength-bands";

/** A patch without a public picture is a plain tile; its picture is never requested. */
export function TokenPicture({ point, large = false, uploadUrl }: { point: CloudToken; large?: boolean; uploadUrl?: string }) {
  const library = useLibrary();
  const cell = point.slot - PATCH_SLOT_OFFSET;
  const size = large ? 320 : 64;
  let picture;
  if (point.source === "upload" && uploadUrl) picture = <img src={uploadUrl} alt={LOOK_TEXT.pictureOf.upload} width={size} height={size} />;
  else if (point.source === "library" && point.publicPreview) picture = <LibraryImage src={library.thumbnailUrl(point.imageId)} alt="" width={size} height={size} />;
  else picture = <span className="look-no-picture">{LOOK_TEXT.noPicture}</span>;
  return (
    <span className="look-token-picture" data-large={large || undefined}>
      {picture}
      <span className="look-patch" style={{ left: `${cell % GRID / GRID * 100}%`, top: `${Math.floor(cell / GRID) / GRID * 100}%` }} />
    </span>
  );
}

/** A strip is a contact sheet: 64 px pictures side by side, one module each. */
const TILE_WIDTH = 64;

/** All patches are reachable by scrolling. Only the visible pictures enter the DOM. */
export function TokenStrip({ indices, token, label, selected, onHover, onSeed, uploadUrl }: {
  indices: readonly number[];
  token: (index: number) => CloudToken;
  label: string;
  selected?: ReadonlySet<number>;
  uploadUrl?: string;
  onHover: (index: number | null) => void;
  onSeed: (index: number, additive: boolean) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 600 });
  useEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(([entry]) => setViewport((current) => ({ ...current, width: entry.contentRect.width })));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A different list starts at its first picture. The same list in a new array, as when the rows
  // load or a parent renders again, keeps its place.
  const shown = useRef(indices);
  useEffect(() => {
    if (sameValues(shown.current, indices)) return;
    shown.current = indices;
    scroller.current?.scrollTo({ left: 0 });
    setViewport((current) => ({ ...current, left: 0 }));
  }, [indices]);
  const first = Math.max(0, Math.floor(viewport.left / TILE_WIDTH) - 2);
  const last = Math.min(indices.length, Math.ceil((viewport.left + viewport.width) / TILE_WIDTH) + 2);
  return (
    <div className="look-token-strip">
      <button className="look-strip-step" aria-label={LOOK_TEXT.strip.previous(label)} disabled={viewport.left <= 0}
        onClick={() => scroller.current?.scrollBy({ left: -viewport.width })}>‹</button>
      <div className="look-token-scroll" ref={scroller} role="group" aria-label={label}
        onScroll={(event) => {
          // Read the position now: React clears currentTarget after the event, and the updater can run later.
          const left = event.currentTarget.scrollLeft;
          setViewport((current) => ({ ...current, left }));
        }}>
        <div className="look-token-track" style={{ width: indices.length * TILE_WIDTH }}>
          {indices.slice(first, last).map((index, offset) => {
            const point = token(index);
            const cell = point.slot - PATCH_SLOT_OFFSET;
            return (
              <button key={cloudTokenKey(point)} className="look-token" style={{ left: (first + offset) * TILE_WIDTH }}
                data-index={index} aria-pressed={selected?.has(index)}
                aria-label={LOOK_TEXT.strip.select(cloudTokenPicture(point).toLowerCase(), cell % GRID + 1, Math.floor(cell / GRID) + 1)}
                onMouseEnter={() => onHover(index)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(index)} onBlur={() => onHover(null)}
                onClick={(event) => onSeed(index, event.shiftKey)}>
                <TokenPicture point={point} uploadUrl={uploadUrl} />
              </button>
            );
          })}
        </div>
      </div>
      <button className="look-strip-step" aria-label={LOOK_TEXT.strip.next(label)}
        disabled={viewport.left + viewport.width >= indices.length * TILE_WIDTH}
        onClick={() => scroller.current?.scrollBy({ left: viewport.width })}>›</button>
    </div>
  );
}

/**
 * The picked patch beside the cloud: its picture, its band and place, and Grow from this patch.
 * Advanced adds the region's two actions: select around it, and ask Grow for it.
 */
export function TokenPreview({ point, strength, onGrow, advanced, onSelectAround, onSelectAnchor, isAnchor, uploadUrl }: {
  point: CloudToken;
  strength: StrengthCuts;
  onGrow: () => void;
  advanced: boolean;
  onSelectAround: () => void;
  onSelectAnchor: () => void;
  isAnchor: boolean;
  uploadUrl?: string;
}) {
  const cell = point.slot - PATCH_SLOT_OFFSET;
  return (
    <aside className="look-preview" aria-label={LOOK_TEXT.cloud.picked}>
      <TokenPicture point={point} large uploadUrl={uploadUrl} />
      <p className="look-preview-where">
        <BandChip band={bandIndex(point.norm, strength)} />
        <span>{LOOK_TEXT.position(lobePosition(point.norm, strength))}</span>
      </p>
      <p className="look-preview-from" title={point.source === "library" ? cloudTokenPicture(point) : undefined}>
        {LOOK_TEXT.patchOf(cell % GRID + 1, Math.floor(cell / GRID) + 1, point.source === "upload")}
      </p>
      <button className="button" onClick={onGrow}>{LOOK_TEXT.cloud.growFrom}</button>
      {advanced && (
        <div className="look-preview-actions">
          <button className="button" onClick={onSelectAround}>{LOOK_TEXT.selectAround}</button>
          <button className="button" aria-pressed={isAnchor} disabled={isAnchor} onClick={onSelectAnchor}>{isAnchor ? LOOK_TEXT.asking : LOOK_TEXT.askForIt}</button>
        </div>
      )}
    </aside>
  );
}
