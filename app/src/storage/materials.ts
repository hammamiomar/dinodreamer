import { readFigureMaterial, type FigureMaterial, type FigureMaterialFile } from "../materials/material-file";

const STORE = "materials";
let database: Promise<IDBDatabase> | undefined;
export function openMaterialDatabase(name = "dinodreamer-materials"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: "id" });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}
function appDatabase() {
  if (!database) {
    database = openMaterialDatabase();
    database.catch(() => { database = undefined; });
  }
  return database;
}
export async function keepMaterial(file: FigureMaterialFile, db = appDatabase()): Promise<void> {
  const opened = await db;
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(file);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("The automaton could not be saved on this device."));
  });
}
/**
 * Save a gallery automaton on this device. A different automaton already kept under the same file id
 * (the visitor's own run, or another file that claims the id) stays as it is: nothing is written and
 * the promise rejects. The same automaton saved again is written again.
 */
export async function keepPublishedMaterial(file: FigureMaterialFile, db = appDatabase()): Promise<void> {
  const opened = await db;
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let different = false;
    const reading = store.get(file.id);
    reading.onsuccess = () => {
      const stored = reading.result as { rule?: { layout?: unknown; values?: unknown } } | undefined;
      different = stored !== undefined && (stored.rule?.layout !== file.rule.layout || stored.rule?.values !== file.rule.values);
      if (different) transaction.abort();
      else store.put(file);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(different
      ? new Error("This device keeps a different automaton under the same name; it was not replaced.")
      : transaction.error ?? new Error("The automaton could not be saved on this device."));
  });
}
/** Parse each record independently. Unreadable records stay stored for future recovery. */
export async function keptMaterials(dictionaryId?: string, db = appDatabase()): Promise<FigureMaterial[]> {
  const opened = await db;
  const files = await new Promise<unknown[]>((resolve, reject) => {
    const request = opened.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const materials: FigureMaterial[] = [];
  for (const file of files) {
    try { materials.push(readFigureMaterial(file, dictionaryId)); }
    catch { /* A failed parse must not hide other records or delete the stored definition. */ }
  }
  return materials;
}
export async function deleteMaterial(id: string, db = appDatabase()): Promise<void> {
  const opened = await db;
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
