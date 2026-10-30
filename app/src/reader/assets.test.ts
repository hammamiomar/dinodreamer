import { describe, expect, it } from "vitest";
import { decodeReaderIndex } from "./assets";

const release = { dictionary: "model/example/", blocks: 16384 };
const makeIndex = () => ({ format: 1, dictionaryId: "example", blocks: 16384, width: 768, rank: 3,
  files: Array.from({ length: 32 }, (_, index) => ({ firstBlock: index * 512, blocks: 512,
    path: `model/example/reader-frames-${index}.safetensors`, bytes: 4718592, sha256: "a".repeat(64) })) });

describe("whole dictionary boundary", () => {
  it("accepts complete bounded frame chunks", () => expect(decodeReaderIndex(makeIndex(), release).files).toHaveLength(32));
  it("rejects a gap, an incomplete dictionary, and another dictionary", () => {
    const gap = makeIndex(); gap.files[2].firstBlock++;
    expect(() => decodeReaderIndex(gap, release)).toThrow("malformed");
    const partial = makeIndex(); partial.files.pop();
    expect(() => decodeReaderIndex(partial, release)).toThrow("all basis groups");
    expect(() => decodeReaderIndex({ ...makeIndex(), dictionaryId: "other" }, release)).toThrow("native");
  });
});
