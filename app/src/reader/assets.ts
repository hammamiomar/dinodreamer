import type { ModelFile, ModelRelease } from "../synthesis/assets";

export interface ReaderChunk extends ModelFile {
  firstBlock: number;
  blocks: number;
}
export interface ReaderIndex {
  dictionaryId: string;
  files: ReaderChunk[];
}

/** Validate the whole dictionary once, before any frame is installed. */
export function decodeReaderIndex(value: unknown, release: Pick<ModelRelease, "dictionary" | "blocks">): ReaderIndex {
  const index = value as Record<string, unknown> | null;
  const dictionaryId = release.dictionary.replace(/^model\//, "").replace(/\/$/, "");
  if (!index || index.format !== 1 || index.dictionaryId !== dictionaryId || index.blocks !== 16384 ||
      release.blocks !== 16384 || index.width !== 768 || index.rank !== 3 || !Array.isArray(index.files)) {
    throw new Error("The image analyzer needs all 16,384 native rank-3 basis matrices of the basis collection.");
  }
  let next = 0;
  const files = index.files.map((file: ReaderChunk) => {
    if (!file || file.firstBlock !== next || !Number.isInteger(file.blocks) || file.blocks < 1 || file.blocks > 512 ||
        next + file.blocks > 16384 || typeof file.path !== "string" || !file.path.startsWith(release.dictionary) ||
        file.path.includes("..") || !Number.isInteger(file.bytes) || file.bytes < 1 ||
        typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error("The image analyzer's basis matrix index is incomplete or malformed.");
    }
    next += file.blocks;
    return { firstBlock: file.firstBlock, blocks: file.blocks, path: file.path, bytes: file.bytes, sha256: file.sha256 };
  });
  if (next !== 16384) throw new Error("The image analyzer's basis matrix index does not cover all basis groups.");
  return { dictionaryId, files };
}
