import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readFigureMaterial } from "../materials/material-file";
import { deleteMaterial, keepMaterial, keptMaterials, openMaterialDatabase } from "./materials";

it("keeps one file per material id, restores exact weights and supports local deletion", async () => {
  const database = openMaterialDatabase(`material-test-${crypto.randomUUID()}`);
  const file = JSON.parse(readFileSync(new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
  await keepMaterial(file, database); await keepMaterial(file, database);
  const materials = await keptMaterials(file.dictionaryId, database);
  expect(materials).toHaveLength(1);
  expect(materials[0].file).toEqual(file);
  expect(materials[0].values).toEqual(readFigureMaterial(file).values);
  expect(await keptMaterials("different-dictionary", database)).toEqual([]);
  await deleteMaterial(file.id, database);
  expect(await keptMaterials(undefined, database)).toEqual([]);
  (await database).close();
});

it("reads a saved figure material through the format-4 loader", async () => {
  const database = openMaterialDatabase(`material-test-${crypto.randomUUID()}`);
  const file = JSON.parse(readFileSync(new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
  await keepMaterial(file, database);
  const [material] = await keptMaterials(undefined, database);
  expect(material.file.format).toBe(4);
  expect(material.file).toEqual(file);
  expect(material.values).toHaveLength(7776);
  (await database).close();
});


it("isolates unreadable records without changing or deleting them", async () => {
  const database = openMaterialDatabase(`material-test-${crypto.randomUUID()}`);
  const file = JSON.parse(readFileSync(new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8"));
  await keepMaterial(file, database);
  const old = { id: "legacy", format: 1, rule: { layout: "e1-16-96-bounded-v1" } };
  const corrupt = { ...file, id: "corrupt", rule: { ...file.rule, values: "invalid" } };
  const opened = await database;
  await new Promise<void>((resolve, reject) => {
    const transaction = opened.transaction("materials", "readwrite");
    transaction.objectStore("materials").put(old);
    transaction.objectStore("materials").put(corrupt);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const listed = await keptMaterials(undefined, database);
  expect(listed.map((material) => material.file.id)).toEqual([file.id]);
  const stored = await new Promise<unknown[]>((resolve, reject) => {
    const request = opened.transaction("materials").objectStore("materials").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(stored).toHaveLength(3);
  expect(stored).toContainEqual(old);
  expect(stored).toContainEqual(corrupt);
  opened.close();
});
