// Opening a creation replaces its recipe and title, then restores its saved picture
// at the recorded step. A placeholder starts from the seed; gallery pictures and
// records without a step start at step 0. Picture provenance stays until a new update
// replaces it. Gallery entries become the visitor's only after an edit.
//
// Loads carry a beginOpen ticket. The reducer discards a load if another open starts
// or the recipe, title or held token changes while it waits.

import { parseInkChoices } from "./inks";
import type { Dispatch } from "react";
import type { SavedCreation } from "../../storage/creations";
import { fetchGalleryRecipe, type GalleryEntry } from "../gallery/gallery-api";
import type { EditorAction } from "./state";

type OpenAction = Extract<EditorAction, { type: "openRecipe" }>;

/** Tickets are never reused within a page, so an old load cannot pass for a newer one. */
let lastTicket = 0;

/** Begins an open that must load first; dispatch the loaded action with this ticket, or cancelOpen. */
export function beginOpen(dispatch: Dispatch<EditorAction>): number {
  lastTicket += 1;
  dispatch({ type: "beginOpen", ticket: lastTicket });
  return lastTicket;
}

/** The editor action that opens a saved record; reads its picture's bytes. */
export async function openSavedAction(record: SavedCreation, ticket: number): Promise<OpenAction> {
  const picture = record.placeholder
    ? undefined
    : {
        png: new Uint8Array(await record.previewPng.arrayBuffer()),
        step: record.step ?? 0,
        ...(record.engine ? { engine: record.engine } : {}),
        ...(record.upgradedFrom ? { upgradedFrom: record.upgradedFrom } : {}),
      };
  return {
    type: "openRecipe",
    ticket,
    recipe: record.recipe,
    title: record.title,
    source: { kind: "saved", id: record.id },
    ...(picture ? { picture } : {}),
    // The colours picked for this creation; a Gallery entry opens in the palette's.
    ...(record.inks ? { inks: parseInkChoices(record.inks) } : {}),
  };
}

/**
 * The editor action that opens a gallery entry: its recipe, and its published image as the
 * picture, with the engine the
 * index names and the mark of a recipe written in an earlier format. A picture that cannot be
 * read leaves the run to start from the seed; a recipe that cannot be read rejects.
 */
export async function openGalleryAction(entry: GalleryEntry, ticket: number, fetcher: typeof fetch = fetch): Promise<OpenAction> {
  const [{ recipe, upgradedFrom }, png] = await Promise.all([
    fetchGalleryRecipe(entry, fetcher),
    galleryPicture(entry, fetcher).catch(() => undefined),
  ]);
  const picture = png
    ? {
        png,
        step: 0,
        ...(entry.engine ? { engine: entry.engine } : {}),
        ...(upgradedFrom ? { upgradedFrom } : {}),
      }
    : undefined;
  return { type: "openRecipe", ticket, recipe, title: entry.title, source: { kind: "gallery" }, ...(picture ? { picture } : {}) };
}

async function galleryPicture(entry: GalleryEntry, fetcher: typeof fetch): Promise<Uint8Array> {
  const response = await fetcher(entry.imageUrl);
  if (!response.ok) throw new Error(`The image of “${entry.title}” answered ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}
