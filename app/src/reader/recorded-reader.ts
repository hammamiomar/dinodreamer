import { HOW_PICTURE, recordedFolder } from "../features/how/how-source";
import { decodeAddresses } from "../features/how/recorded";
import type { ImageAddresses } from "./protocol";

/**
 * The picture reading of `?engine=fake` and the fixture release, where no model loads (as the fake
 * synthesis client in editor/run/use-run.ts): How's recorded reading of the page's one picture
 * (how-source.ts HOW_PICTURE, public/how/recorded), so Your picture can be opened and tested without
 * WebGPU. The uploaded pixels are not read: any picture shows the hibiscus's basis groups.
 */
export async function readRecordedPicture(): Promise<ImageAddresses> {
  const response = await fetch(`${recordedFolder(HOW_PICTURE.imageId)}addresses.bin`);
  if (!response.ok) throw new Error(`The recorded reading could not be loaded (HTTP ${response.status}).`);
  return { dictionaryId: `recorded:${HOW_PICTURE.imageId}`, grid: 16, ...decodeAddresses(await response.arrayBuffer()) };
}
