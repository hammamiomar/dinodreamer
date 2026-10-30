// A submission as a recovery copy: its PNG and recipe rebuilt into the creation file that
// the app's Saved page imports ("Import a creation…", app/src/storage/recipe-file.ts).
// The format name and version are that module's. The owner's commands run under plain
// Node, which cannot load the app's extensionless imports, so they are repeated here;
// a test decodes this file with the app's decoder.

export const CREATION_FILE_FORMAT = "dinodreamer-creation";
export const CREATION_FILE_VERSION = 1;

export interface RecoveredCreation {
  title: string;
  /** The stored recipe, already checked by the Worker when it was submitted. */
  recipe: unknown;
  png: Uint8Array;
  /** When the creation was submitted or published: the file's createdAt and updatedAt. */
  at: string;
  /** The engine build that made the image, when the submission named it. */
  engine?: string;
}

/** The JSON text of a creation file; the image travels inside it as a PNG data URL. */
export function creationFileText(creation: RecoveredCreation): string {
  const previewPng = `data:image/png;base64,${Buffer.from(creation.png).toString("base64")}`;
  const file = {
    format: CREATION_FILE_FORMAT,
    version: CREATION_FILE_VERSION,
    title: creation.title,
    createdAt: creation.at,
    updatedAt: creation.at,
    recipe: creation.recipe,
    previewPng,
    ...(creation.engine === undefined ? {} : { engine: creation.engine }),
  };
  return JSON.stringify(file);
}
