import { fill, SITE_WORDS } from "../app/site-words";
import { FIGURE_PYRAMID_LAYOUT, type FigureMaterialFile } from "../materials/material-file";

/**
 * The title a person gave an automaton when they published it, or "". A title equal to the
 * definition's name is the research run's own name, not a person's title.
 */
export function ownTitle(title: string, file: Pick<FigureMaterialFile, "name">): string {
  return title !== "" && title !== file.name ? title : "";
}

/**
 * Who made an automaton, where it is shown: the title its maker gave, then "by" and their name.
 * "" when there is neither, so that nothing shows where the name would be.
 */
export function makerLine(maker: { title: string; credit: string }, file: Pick<FigureMaterialFile, "name">): string {
  const title = ownTitle(maker.title, file);
  const by = maker.credit === "" ? "" : fill(SITE_WORDS.stage.by, { credit: maker.credit });
  return [title, by].filter((part) => part !== "").join(" · ");
}

/** The exported page summarizes the basis group, grids, start and training length. */
export function materialLine(file: FigureMaterialFile): string {
  const parts = [
    `Basis group ${file.block}`,
    file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "coarse + fine grids" : "one grid",
  ];
  if (file.start?.kind === "centre-disc") parts.push("noise disc start");
  parts.push(`${file.training.updates.toLocaleString("en-US")} optimizer updates`);
  return parts.join(" \u00b7 ");
}
