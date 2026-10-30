import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { publish, type LocalFile } from "../publish-library-folder.ts";

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function files(): LocalFile[] {
  const directory = mkdtempSync(join(tmpdir(), "library-publication-"));
  directories.push(directory);
  return ["data.bin", "more.bin", "manifest.json", "reader.json"].map((name) => {
    const path = join(directory, name);
    writeFileSync(path, "{}");
    return { key: `model/test/${name}`, path, size: 2, md5: "", contentType: "application/octet-stream" };
  });
}

it("waits for every data upload before publishing any root manifest", async () => {
  vi.useFakeTimers();
  const started: string[] = [];
  let finishUpload!: () => void;
  const slow = new Promise<void>((resolve) => { finishUpload = resolve; });
  const publication = publish({
    async put(key) {
      started.push(key);
      if (key.endsWith("data.bin")) await slow;
    },
  }, files(), "model/test");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(started).toEqual(["model/test/data.bin", "model/test/more.bin"]);
  finishUpload();
  await vi.runAllTimersAsync();
  await publication;
  expect(started.slice(2)).toEqual(["model/test/manifest.json", "model/test/reader.json"]);
});

it("does not publish manifests after a data upload fails", async () => {
  vi.useFakeTimers();
  const started: string[] = [];
  const publication = publish({
    async put(key) {
      started.push(key);
      throw new Error("upload failed");
    },
  }, files(), "model/test");
  const failure = expect(publication).rejects.toThrow("upload failed");
  await vi.advanceTimersByTimeAsync(2_000);
  await failure;
  expect(started.every((key) => !key.endsWith(".json"))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
