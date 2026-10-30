// One point's picture and name beside it, on either view of a code space: the point
// under the pointer, the point the arrow keys stepped to, or the point a dragged ring
// sits on. It opens on the roomier side of the point, so it stays inside the view.
// While a finger drags a ring, it opens above the finger instead, where the hand
// does not cover it, and it may then reach over what is above the view.

import type { CSSProperties } from "react";
import type { SpacePoint } from "./code-space-3d";
import type { Lift } from "./mark-drag";
import { LibraryImage } from "../library-image";

/** How far the tooltip keeps from its point, and from a finger on the point. */
const GAP_PX = 12;
const FINGER_CLEARANCE_PX = 40;

/** The tooltip's place in its square view, `at` given as fractions of the view's side (0 to 1, y down). */
export function tooltipPlace(at: { x: number; y: number }, finger: boolean): Pick<CSSProperties, "left" | "right" | "top" | "bottom"> {
  const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  const place: Pick<CSSProperties, "left" | "right" | "top" | "bottom"> = {};
  if (at.x > 0.5) place.right = `calc(${percent(1 - at.x)} + ${GAP_PX}px)`;
  else place.left = `calc(${percent(at.x)} + ${GAP_PX}px)`;
  if (finger) place.bottom = `calc(${percent(1 - at.y)} + ${FINGER_CLEARANCE_PX}px)`;
  else if (at.y > 0.5) place.bottom = `calc(${percent(1 - at.y)} + ${GAP_PX}px)`;
  else place.top = `calc(${percent(at.y)} + ${GAP_PX}px)`;
  return place;
}

/** A point whose picture shows, at `at` in the view's coordinates; `finger` when a finger holds a ring there. */
export interface ShownPoint {
  point: SpacePoint;
  at: { x: number; y: number };
  finger: boolean;
}

/**
 * While a ring is lifted onto a point, that point's picture shows beside it; when a finger holds the
 * ring, from no lower than the finger, so the picture opens above both. `places` are the points
 * where the view draws them, in the same coordinates as the finger.
 */
export function liftedPoint(lifted: Lift | null, points: readonly SpacePoint[], places: readonly { x: number; y: number }[]): ShownPoint | null {
  if (!lifted || lifted.point === null) return null;
  const point = points[lifted.point];
  const place = places[lifted.point];
  if (!point || !place) return null;
  if (!lifted.finger) return { point, at: place, finger: false };
  return { point, at: { x: place.x, y: Math.min(place.y, lifted.finger.y) }, finger: true };
}

/** Inside a positioned square the size of the view (the 3-D view's frame, the plane's square). */
export function PointTooltip({ point, at, finger = false }: { point: SpacePoint; at: { x: number; y: number }; finger?: boolean }) {
  return (
    <div className="code-space-tooltip" style={tooltipPlace(at, finger)} aria-hidden="true">
      {point.imageUrl && <LibraryImage src={point.imageUrl} alt="" width={72} height={72} />}
      <span>{point.label}</span>
    </div>
  );
}
