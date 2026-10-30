// The recorded library codes of a request's block and role: the neighbourhood its
// cells' codes move in. The detail draws them grey behind the request's own codes;
// measurements do not resize the minimap's frame.
// Each point's key is its recorded token, "imageId:slot" (pointKey).

import { regionSource } from "../../../code-target";
import { useMemo } from "react";
import { useLoaded } from "../../../ui/use-loaded";
import { useLibrary } from "../../../app/library-session";
import type { Token } from "../../../recipe";
import type { SpacePoint } from "../../../ui/code-space/code-space-3d";
import { tokenLabel } from "../presentation";

/** A cloud point's key: the recorded token it stands for. */
export function pointKey(token: { imageId: number; slot: number }): string {
  return `${token.imageId}:${token.slot}`;
}

/** The recorded token a point of the cloud stands for, read from its key; null for any other key. */
export function pointToken(key: string): { imageId: number; slot: number } | null {
  const match = /^(\d+):(\d+)$/.exec(key);
  return match ? { imageId: Number(match[1]), slot: Number(match[2]) } : null;
}

/**
 * The block's recorded codes of the source token's role; for a storage token, of its own slot.
 * A new token of the same role keeps the same points, so moving the target keeps the view.
 */
export function useBlockCloud(block: number, source: Token): SpacePoint[] {
  const library = useLibrary();
  const { role } = source;
  const storageSlot = role === "storage" ? source.slot : null;
  const key = useMemo(() => ({ library, block, role, storageSlot }), [library, block, role, storageSlot]);
  const cloud = useLoaded(key, async () => {
    const record = await library.block(block);
    const points = role === "patch" ? regionSource(record.cloud) : record.cloud;
    return points
      .filter((point) => point.token.role === role && (storageSlot === null || point.token.slot === storageSlot))
      .map((point) => ({
        key: pointKey(point.token),
        code: point.code,
        label: `Image ${point.token.imageId} · ${tokenLabel(point.token)}`,
        imageUrl: library.thumbnailUrl(point.token.imageId),
      }));
  });
  // Loading and failure show no context points; never retain another block's targets.
  return cloud.status === "ready" ? cloud.value : EMPTY_CLOUD;
}

const EMPTY_CLOUD: SpacePoint[] = [];
