import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  materialEntry, materialKey, MATERIAL_INDEX_KEY, readMaterialIndex, versionedMaterialKey,
} from "../../app/src/features/gallery/material-index.ts";
import { canonicalFigureFile, readFigureMaterial } from "../../app/src/materials/material-file.ts";
import {
  hiddenMaterialKey, materialPoster, migrateMaterialVersions, publishMaterial, purgeMaterial, readMaterials,
  replaceMaterialFiles, restoreMaterial, setMaterialFeatured,
} from "../src/material-review.ts";
import { MemoryBucket } from "./memory-bucket.ts";

const source = readFileSync(new URL("../seed/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8");
const file = canonicalFigureFile(readFigureMaterial(JSON.parse(source)).file);
const label = { title: "Scales", credit: "Project" };
const publishedAt = "2026-10-22T12:15:00.000Z";
const sha256 = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const definition = JSON.stringify(file);

describe("versioned gallery files", () => {
  it("hashes the exact published body and keeps both pairs through a reread at the same step", async () => {
    const library = new MemoryBucket(), submissions = new MemoryBucket();
    const id = "shown";
    const entry = await publishMaterial(library, id, file, label, new Date(publishedAt));
    const first = sha256(definition);
    expect(entry.fileRevision).toBe(first);
    const changed = { ...file, reading: { ...file.reading, strength: 0.7 } };
    const nextText = JSON.stringify(changed);
    const next = sha256(nextText);
    expect(next).not.toBe(first);
    await replaceMaterialFiles(submissions, library, new Map([[id, changed]]));
    expect((await readMaterials(library)).entries[0]).toMatchObject({ id, fileRevision: next, tick: entry.tick });
    for (const [revision, text] of [[first, definition], [next, nextText]] as const) {
      const version = library.objects.get(versionedMaterialKey(id, revision, "material.json"))!;
      expect(new TextDecoder().decode(version.body)).toBe(text);
      expect(version.httpMetadata).toEqual({ contentType: "application/json", cacheControl: "public, max-age=31536000, immutable" });
      const poster = library.objects.get(versionedMaterialKey(id, revision, "poster.png"))!;
      expect(sha256(poster.body)).toBe(sha256(materialPoster(file)));
      expect(poster.httpMetadata.contentType).toBe("image/png");
    }
    expect(await (await library.get(materialKey(id, "material.json")))?.text()).toBe(nextText);
    expect(sha256(library.objects.get(materialKey(id, "poster.png"))!.body)).toBe(sha256(materialPoster(changed)));
    await purgeMaterial(submissions, library, id);
    expect(library.keys("gallery/materials/shown/")).toEqual([]);
  });

  it("keeps the published index and stable files when a new immutable poster write fails", async () => {
    const library = new MemoryBucket(), submissions = new MemoryBucket();
    const entry = await publishMaterial(library, "shown", file, label, new Date(publishedAt));
    const next = { ...file, reading: { ...file.reading, strength: 0.5 } };
    const revision = sha256(JSON.stringify(next));
    const put = library.put.bind(library);
    library.put = async (key, body, options) => {
      if (key === versionedMaterialKey(entry.id, revision, "poster.png")) throw new Error("poster write interrupted");
      await put(key, body, options);
    };
    const replace = () => replaceMaterialFiles(submissions, library, new Map([[entry.id, next]]));
    await expect(replace()).rejects.toThrow("poster write interrupted");
    expect((await readMaterials(library)).entries).toEqual([entry]);
    expect(await (await library.get(materialKey(entry.id, "material.json")))?.text()).toBe(definition);
    library.put = put;
    await replace();
    expect((await readMaterials(library)).entries[0]!.fileRevision).toBe(revision);
  });

  it("accepts old entries and validates the entire lowercase hexadecimal revision", () => {
    const old = materialEntry("shown", file, label, publishedAt);
    expect(readMaterialIndex({ entries: [old] }).entries[0]!.fileRevision).toBeUndefined();
    for (const bad of [null, 123, "", "a".repeat(63), "A".repeat(64), "f".repeat(65), "g".repeat(64)]) {
      expect(() => readMaterialIndex({ entries: [{ ...old, fileRevision: bad }] })).toThrow("invalid file revision");
    }
  });

  it("purges all retained revisions within R2's limit of 1,000 keys per delete", async () => {
    const library = new MemoryBucket(500), submissions = new MemoryBucket();
    const id = "long-history";
    const entry = materialEntry(id, file, label, publishedAt);
    await library.put(MATERIAL_INDEX_KEY, JSON.stringify({ entries: [entry] }));
    for (let version = 0; version < 502; version++) {
      const revision = version.toString(16).padStart(64, "0");
      await library.put(versionedMaterialKey(id, revision, "material.json"), "{}");
      await library.put(versionedMaterialKey(id, revision, "poster.png"), new Uint8Array([1]));
    }
    const remove = library.delete.bind(library);
    library.delete = async (keys) => {
      if (Array.isArray(keys) && keys.length > 1000) throw new Error("too many keys");
      await remove(keys);
    };
    await purgeMaterial(submissions, library, id);
    expect(library.keys(`gallery/materials/${id}/`)).toEqual([]);
    expect((await readMaterials(library)).entries).toEqual([]);
  });
});

async function legacyGallery() {
  const library = new MemoryBucket(), submissions = new MemoryBucket();
  const shown = { ...materialEntry("shown", file, label, publishedAt), cellPicture: true };
  const hidden = { ...materialEntry("hidden", file, label, publishedAt), hiddenAt: "2026-10-23T10:00:00Z", featuredInBlock: true };
  const legacyText = JSON.stringify(file, null, 2) + "\n";
  for (const entry of [shown, hidden]) {
    await library.put(materialKey(entry.id, "material.json"), legacyText);
    await library.put(materialKey(entry.id, "poster.png"), materialPoster(file));
  }
  await library.put(MATERIAL_INDEX_KEY, JSON.stringify({ entries: [shown] }));
  await submissions.put(hiddenMaterialKey(hidden.id), JSON.stringify(hidden));
  return { library, submissions, shown, hidden, legacyText };
}

describe("existing gallery migration", () => {
  it("preserves new owner marks and a material restored during the copy", async () => {
    const { library, submissions, shown, hidden, legacyText } = await legacyGallery();
    const fileRevision = sha256(legacyText);
    const put = library.put.bind(library);
    library.put = async (key, body, options) => {
      await put(key, body, options);
      if (key === versionedMaterialKey(shown.id, fileRevision, "poster.png")) {
        await setMaterialFeatured(submissions, library, shown.id, true);
      }
      if (key === versionedMaterialKey(hidden.id, fileRevision, "poster.png")) {
        await restoreMaterial(submissions, library, hidden.id);
      }
    };
    expect(await migrateMaterialVersions(submissions, library, true)).toEqual({ shown: 1, hidden: 0 });
    expect(await submissions.get(hiddenMaterialKey(hidden.id))).toBeNull();
    const entries = (await readMaterials(library)).entries;
    expect(entries.find((entry) => entry.id === shown.id)).toEqual({ ...shown, featured: true, fileRevision });
    expect(entries.find((entry) => entry.id === hidden.id)?.fileRevision).toBeUndefined();
    library.put = put;
    expect(await migrateMaterialVersions(submissions, library, true)).toEqual({ shown: 1, hidden: 0 });
    expect((await readMaterials(library)).entries.every((entry) => entry.fileRevision === fileRevision)).toBe(true);
  });

  it("copies the stored bytes, preserves existing records and stable files, and skips completed revisions", async () => {
    const { library, submissions, shown, hidden, legacyText } = await legacyGallery();
    const before = new Map(library.objects);
    const migrate = (write: boolean) => migrateMaterialVersions(submissions, library, write);
    expect(await migrate(false)).toEqual({ shown: 1, hidden: 1 });
    expect([...library.objects.keys()]).toEqual([...before.keys()]);
    expect(await migrate(true)).toEqual({ shown: 1, hidden: 1 });
    const fileRevision = sha256(legacyText);
    const hiddenRecord = JSON.parse(await (await submissions.get(hiddenMaterialKey(hidden.id)))!.text());
    expect(hiddenRecord).toEqual({ ...hidden, fileRevision });
    expect((await readMaterials(library)).entries).toEqual([{ ...shown, fileRevision }]);
    for (const id of [shown.id, hidden.id]) {
      for (const name of ["material.json", "poster.png"] as const) {
        const stableKey = materialKey(id, name);
        expect(library.objects.get(stableKey)).toBe(before.get(stableKey));
        expect(sha256(library.objects.get(versionedMaterialKey(id, fileRevision, name))!.body)).toBe(sha256(before.get(stableKey)!.body));
      }
    }
    const completed = new Map(library.objects);
    expect(await migrate(true)).toEqual({ shown: 0, hidden: 0 });
    for (const [key, stored] of completed) expect(library.objects.get(key)).toBe(stored);
    expect((await restoreMaterial(submissions, library, hidden.id)).fileRevision).toBe(fileRevision);
  });

  it("refuses a poster independent of its embedded bytes and resumes after correction", async () => {
    const { library, submissions, hidden, legacyText } = await legacyGallery();
    const key = materialKey(hidden.id, "poster.png");
    const other = readFileSync(new URL("../seed/materials/block-13633-figure-strongest-mean-seed-0.material.json", import.meta.url), "utf8");
    const mismatch = materialPoster(readFigureMaterial(JSON.parse(other)).file);
    await library.put(key, mismatch);
    await expect(migrateMaterialVersions(submissions, library, true)).rejects.toThrow("hidden: the stored poster differs");
    expect(library.keys("gallery/materials/hidden/versions/")).toEqual([]);
    const record = JSON.parse(await (await submissions.get(hiddenMaterialKey(hidden.id)))!.text());
    expect(record).toEqual(hidden);
    expect(sha256(library.objects.get(key)!.body)).toBe(sha256(mismatch));
    await library.put(key, materialPoster(file));
    expect(await migrateMaterialVersions(submissions, library, true)).toEqual({ shown: 0, hidden: 1 });
    expect((await restoreMaterial(submissions, library, hidden.id)).fileRevision).toBe(sha256(legacyText));
  });
});
