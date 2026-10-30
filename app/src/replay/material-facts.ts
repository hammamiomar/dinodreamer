import { FIGURE_PYRAMID_LAYOUT, type FigureMaterialFile } from "../materials/material-file";

/** The exported page summarizes the basis group, grids, start and training length. */
export function materialLine(file: FigureMaterialFile): string {
  const parts = [
    `Basis group ${file.block}`,
    file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "coarse + fine grids" : "one grid",
  ];
  if (file.start?.kind === "centre-disc") parts.push("central noise start");
  parts.push(`${file.training.updates.toLocaleString("en-US")} optimizer updates`);
  return parts.join(" \u00b7 ");
}
