import type { Code, MaterialAnchor } from "../../recipe";
import { LOOK_TEXT } from "./look-text";

/**
 * A native code with its picture identity and strength. Uploaded patches have no
 * library ID. A library patch from the full cloud may have no public picture.
 */
export type CloudToken = { code: Code; slot: number; norm: number } & (
  | { source: "library"; imageId: number; publicPreview: boolean }
  | { source: "upload"; imageId?: never }
);

export function cloudTokenKey(point: CloudToken): string {
  return `${point.source === "library" ? point.imageId : "upload"}:${point.slot}`;
}

export function cloudTokenPicture(point: CloudToken): string {
  return point.source === "library" ? LOOK_TEXT.pictureOf.library(point.imageId) : LOOK_TEXT.pictureOf.upload;
}

export function hasPicture(point: CloudToken): boolean {
  return point.source === "upload" || point.publicPreview;
}

/**
 * An automaton's reference patch (its definition's anchor) as a point of its basis group's cloud: the
 * response vector and magnitude it was trained toward, and its picture when that is a library picture.
 */
export function anchorToken(anchor: MaterialAnchor): CloudToken {
  if (anchor.source === "library") {
    return { source: "library", imageId: anchor.imageId, slot: anchor.slot, code: anchor.code, norm: anchor.norm, publicPreview: anchor.publicPreview !== false };
  }
  return { source: "upload", slot: anchor.slot, code: anchor.code, norm: anchor.norm };
}
