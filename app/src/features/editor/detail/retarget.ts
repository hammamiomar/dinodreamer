// Retargeting chooses another recorded token of the request's block. A request that
// asks several blocks needs the new token's address before the change can apply.

import type { Library } from "../../../library/library";
import type { Request } from "../../../recipe";
import { slotRole } from "../../../recipe-parse";
import type { SpacePoint } from "../../../ui/code-space/code-space-3d";
import { codeBlockCount } from "../model";
import type { EditorAction } from "../state";
import { pointKey, pointToken } from "./block-cloud";

/**
 * The action that makes `point` the request's target, or null when the point is its token
 * already. Rejects when the request asks more than one block and the new token's address
 * cannot be read.
 */
export async function retargetAction(
  library: Pick<Library, "tokenAddress">,
  request: Request,
  point: Pick<SpacePoint, "key" | "code">,
  opened: number,
): Promise<EditorAction | null> {
  const at = pointToken(point.key);
  if (!at || point.key === pointKey(request.respondLike.source)) return null;
  const token = { imageId: at.imageId, role: slotRole(at.slot), slot: at.slot };
  let address = null;
  if (codeBlockCount(request) > 1) {
    const reading = library.tokenAddress(token);
    if (!reading) throw new Error("This library does not publish the token's basis groups.");
    address = await reading;
  }
  return {
    type: "retargetRequest",
    requestId: request.id,
    opened,
    expectedSource: request.respondLike.source,
    expectedTarget: request.respondLike.target,
    token,
    code: [point.code[0], point.code[1], point.code[2]],
    address,
  };
}

/** A point of the cloud other than the request's own token, each as likely; null when there is none. */
export function randomPoint<T extends Pick<SpacePoint, "key">>(cloud: readonly T[], request: Request, random: () => number = Math.random): T | null {
  const own = pointKey(request.respondLike.source);
  const others = cloud.filter((point) => point.key !== own);
  if (others.length === 0) return null;
  return others[Math.min(others.length - 1, Math.floor(random() * others.length))]!;
}
