import { fill, SITE_WORDS } from "../../app/site-words";
import type { FigureMaterialFile } from "../../materials/material-file";
import { kindLine } from "../playground/playground";
import type { MaterialEntry } from "./material-index";

const WORDS = SITE_WORDS.material;

/** Add the authoritative count only if the generated description does not already state it. */
function updatesAfterTitle(title: string, updates: number): string | null {
  const count = fill(WORDS.updates, { updates: updates.toLocaleString("en-US") });
  const stated = title.split(" · ").some((part) => part === count || part.endsWith(`, ${count}`));
  return stated ? null : count;
}

/** The file owns both its complete recipe description and its optimizer update count. */
export function fileRecipeCaption(file: FigureMaterialFile): string {
  return [file.name, updatesAfterTitle(file.name, file.training.updates)].filter(Boolean).join(" · ");
}

/** Preserve an existing title exactly; a title copied from the recipe needs only the missing count below it. */
export function materialCaption(entry: MaterialEntry, file: FigureMaterialFile | null, failed = false): { title: string; recipe: string | null } {
  const title = entry.title.trim();
  if (file === null) {
    return {
      title: title || [fill(WORDS.basisGroup, { block: entry.block }), kindLine(entry)].join(" · "),
      recipe: failed ? WORDS.updatesUnavailable : WORDS.updatesLoading,
    };
  }
  const recipe = fileRecipeCaption(file);
  if (!title) return { title: recipe, recipe: null };
  if (title === file.name) return { title: entry.title, recipe: updatesAfterTitle(title, file.training.updates) };
  return { title: entry.title, recipe: title === recipe ? null : recipe };
}
