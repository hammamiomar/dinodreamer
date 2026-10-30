// How a block's responses are drawn over a picture: where the block fires.
//
// A token fires in a block when the block is among that token's top-K blocks
// (its `gated` flag). Every token carries some response through attention, so
// tinting by response norm alone would cover whole pictures. Only firing tokens are tinted, and
// a firing token's opacity follows its norm relative to the picture's strongest
// firing token: the strongest is 0.55, the weakest still shows. One rule for the
// Atlas, the example lists, the inspector and the prefix swatches.
//
// The tint is the ink (styles.css --ink, #efece8): the language has no accent
// colour, so strength reads as light over the picture. The prefix swatches sit on
// the dark interface and use the same ink with the same opacities.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { GRID, PATCH_SLOT_OFFSET } from "../recipe";
import { PREFIX_ROLES } from "../library/roles";
import type { TokenResponses } from "../library/records";
import { LibraryImage, loadLibraryPicture } from "./library-image";

/** Opacity of the weakest firing token, so it still shows. */
export const FIRING_MIN_ALPHA = 0.12;
/** Opacity of the picture's strongest firing token; the picture stays legible beneath it. */
export const FIRING_MAX_ALPHA = 0.55;
/** The tint over pictures: the ink (--ink) as RGB. */
const FIRING_RGB = [239, 236, 232] as const;

/** The norm of the strongest firing token in a picture, over any of its token sets; 0 if none fires. */
export function firingScale(...sets: readonly TokenResponses[]): number {
  let strongest = 0;
  for (const set of sets) {
    set.norm.forEach((norm, slot) => {
      if (set.gated[slot] && norm > strongest) strongest = norm;
    });
  }
  return strongest;
}

/**
 * Opacity of one token: 0 unless it fires; otherwise 0.12 + 0.43 × √(norm / scale),
 * where `scale` is the picture's strongest firing norm. The square root spreads
 * the weaker firing tokens over more of the range.
 */
export function firingAlpha(norm: number, gated: boolean, scale: number): number {
  if (!gated || !(scale > 0) || !(norm > 0)) return 0;
  const fraction = Math.min(1, norm / scale);
  return FIRING_MIN_ALPHA + (FIRING_MAX_ALPHA - FIRING_MIN_ALPHA) * Math.sqrt(fraction);
}

/**
 * Show the tint with its image. The load event handles newly loaded images; the pre-paint
 * check handles images already in the browser cache.
 */
export function usePictureShown(src: string): { ref: RefObject<HTMLImageElement>; shown: boolean; onLoad: () => void } {
  const ref = useRef<HTMLImageElement>(null);
  const [shownSrc, setShownSrc] = useState<string | null>(null);
  useLayoutEffect(() => {
    const picture = ref.current;
    if (picture && picture.complete && picture.naturalWidth > 0) setShownSrc(src);
  }, [src]);
  return { ref, shown: shownSrc === src, onLoad: () => setShownSrc(src) };
}

/** Downloads and decodes `src` at high priority, in the mode the views read pictures; rejects when the browser cannot. */
function decodePicture(src: string): Promise<void> {
  return loadLibraryPicture(src, { priority: "high" }).then(() => undefined);
}

/** How long after a failed download the one retry waits: a 503 from the bucket usually clears at once. */
const PREVIEW_RETRY_MS = 1500;

/**
 * True once `src` has decoded, trying once more after a first failure; false
 * when both tries fail, so the view keeps what it shows instead of a broken image.
 */
export async function previewDecoded(src: string, decode: (src: string) => Promise<void> = decodePicture, retryAfterMs = PREVIEW_RETRY_MS): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await decode(src);
      return true;
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
  }
  return false;
}

/**
 * The source to show now for a picture that paints first and sharpens later:
 * `placeholderSrc` (a thumbnail the Atlas already has) until `src` (the lossless
 * preview) has downloaded and decoded in the background, then `src`. A preview
 * that fails to download leaves the placeholder in place. Without a placeholder,
 * `src` at once.
 */
export function useProgressivePicture(placeholderSrc: string | undefined, src: string): string {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!placeholderSrc) return;
    let current = true;
    void previewDecoded(src).then((decoded) => {
      if (current && decoded) setReady(src);
    });
    return () => {
      current = false;
    };
  }, [placeholderSrc, src]);
  return !placeholderSrc || ready === src ? src : placeholderSrc;
}

/** A 16 × 16 overlay, one pixel per patch token, scaled by CSS to cover its view; drawn before it is first painted. */
export function ResponseOverlay({ patches, scale }: { patches: TokenResponses; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(GRID, GRID);
    patches.norm.forEach((norm, cell) => {
      image.data.set([...FIRING_RGB, Math.round(255 * firingAlpha(norm, patches.gated[cell]!, scale))], cell * 4);
    });
    context.putImageData(image, 0, 0);
  }, [patches, scale]);
  return <canvas ref={canvasRef} className="response-overlay" width={GRID} height={GRID} aria-hidden="true" />;
}

/** The tint from weak to strong firing: the key's swatch, five steps of the tint over the ground. */
export function FiringSwatch() {
  const steps = [0.02, 0.25, 0.5, 0.75, 1].map((fraction) => `rgb(${FIRING_RGB.join(" ")} / ${firingAlpha(fraction, true, 1).toFixed(2)})`);
  return (
    <span className="response-legend-tint" aria-hidden="true">
      {steps.map((colour) => (
        <span key={colour} style={{ background: colour }} />
      ))}
    </span>
  );
}

/** The one-line key under the inspector. */
export function ResponseLegend() {
  return (
    <p className="response-legend muted">
      <FiringSwatch />
      lit = where this basis group responds in this picture
    </p>
  );
}

/**
 * A view of one picture with the patches where the block fires tinted, once the
 * picture is there. `scale` is the picture's `firingScale`. `fallbackSrc` replaces
 * `src` if it fails to load.
 */
export function ResponseView({
  src,
  fallbackSrc,
  alt,
  patches,
  scale,
  priority,
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  /** The 256 patch tokens; null draws the picture alone. */
  patches: TokenResponses | null;
  scale: number;
  /** "low" for a list of thumbnails that must not delay the inspected picture. */
  priority?: "low";
}) {
  // The URL that failed; a new `src` starts again from `src`.
  const [failed, setFailed] = useState<string | null>(null);
  const chosen = failed === src && fallbackSrc ? fallbackSrc : src;
  const picture = usePictureShown(chosen);
  // React 18 passes the attribute through only in its lowercase form.
  const fetchPriority = priority ? { fetchpriority: priority } : {};
  return (
    <div className="response-view">
      {/* CORS mode: the synthesis worker later fetches the same immutable URL from the cache (ui/library-image.tsx). */}
      <LibraryImage
        ref={picture.ref}
        src={chosen}
        alt={alt}
        loading="lazy"
        decoding="async"
        width={256}
        height={256}
        {...fetchPriority}
        onLoad={picture.onLoad}
        onError={() => {
          if (chosen === src && fallbackSrc) setFailed(src);
        }}
      />
      {patches && picture.shown && <ResponseOverlay patches={patches} scale={scale} />}
    </div>
  );
}

/** CLS and the four storage tokens as five small cells, with the same rule. */
export function PrefixCells({ prefix, scale, highlight }: { prefix: TokenResponses; scale: number; highlight?: number }) {
  return (
    <div className="prefix-cells" aria-hidden="true">
      {PREFIX_ROLES.map((role, slot) => (
        <span
          key={role}
          className="prefix-cell"
          data-highlight={slot === highlight}
          style={{ "--alpha": firingAlpha(prefix.norm[slot]!, prefix.gated[slot]!, scale) } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** The 256 patch tokens of a picture's full 261-slot response set. */
export function patchResponses(responses: TokenResponses): TokenResponses {
  return { norm: responses.norm.slice(PATCH_SLOT_OFFSET), gated: responses.gated.slice(PATCH_SLOT_OFFSET) };
}
