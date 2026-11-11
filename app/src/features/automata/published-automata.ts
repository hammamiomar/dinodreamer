// The public Automata page's automata: every entry of the published index (gallery/material-index.ts),
// as the page arranges them (gallery.ts). A published automaton is always shown; the owner's view adds
// the research runs a visitor does not see (features/owner/).

import { FIGURE_PYRAMID_LAYOUT } from "../../materials/material-file";
import { placeOf, type MaterialEntry } from "../gallery/material-index";
import type { GalleryAutomaton } from "./gallery";

/** A published automaton in the gallery, with the index entry its stage plays. */
export interface PublishedAutomaton extends GalleryAutomaton {
  entry: MaterialEntry;
}

export function automatonOfEntry(entry: MaterialEntry, pictureUrl: string): PublishedAutomaton {
  return {
    id: entry.id,
    group: entry.block,
    place: placeOf(entry),
    grids: entry.layout === FIGURE_PYRAMID_LAYOUT ? "coarse-fine" : "fine",
    pictureUrl,
    shown: true,
    cellPicture: entry.cellPicture === true,
    groupPicture: entry.featuredInBlock === true,
    siteFeatured: entry.featured === true,
    metTarget: entry.fired,
    madeAt: entry.publishedAt,
    entry,
  };
}
