import { useEffect, useState } from "react";
import { useLibrary } from "../app/library-session";
import { SITE_WORDS, fill } from "../app/site-words";
import { BasisGroupLink } from "../features/look/basis-group-panel";
import { GRID, PATCH_SLOT_OFFSET } from "../recipe";
import { LibraryImage } from "../ui/library-image";
import type { CoSelection } from "./co-selection";
import { neededPatches, type ReadRegion } from "./selection-cells";

const WORDS = SITE_WORDS.grow;
/** Groups in the row: the requested group, then the first co-selected ones in the panel's order. */
const PICTURES_SHOWN = 6;
/** The thumbnails' side in CSS pixels; the library's thumbnails are drawn down to it. */
const PICTURE_SIDE = 56;

/**
 * A basis group as its strongest public library picture, the selected patch marked: the Index's
 * card at thumbnail size. The library remembers each group's rows, so a group that stays in the
 * row costs one read. Without rows, a plain tile.
 */
function GroupPicture({ group }: { group: number }) {
  const library = useLibrary();
  const [patch, setPatch] = useState<{ imageId: number; slot: number } | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    setPatch(undefined);
    library.strongestPatch(group).then((found) => { if (current) setPatch(found); });
    return () => { current = false; };
  }, [library, group]);
  if (!patch) return <span className="grow-co-selected-picture" data-empty={patch === null || undefined} />;
  const cell = patch.slot - PATCH_SLOT_OFFSET;
  return (
    <span className="grow-co-selected-picture">
      <LibraryImage src={library.thumbnailUrl(patch.imageId)} alt="" width={PICTURE_SIDE} height={PICTURE_SIDE} />
      <span className="grow-co-selected-patch" style={{ left: `${(cell % GRID) / GRID * 100}%`, top: `${Math.floor(cell / GRID) / GRID * 100}%` }} />
    </span>
  );
}

/**
 * The basis groups selected on the read patches at the latest measurement (co-selection.ts), as
 * pictures: the requested group first, dimmed while no read patch selects it, then the groups most
 * often among the 32, each as its strongest library picture with its number, a link to its page.
 * Two sentences above say what DINO sees on how many patches and what the target is, every count
 * with its unit. The counts per group are not shown: the order says it, and
 * the status line gives the requested group's. Every line of words is 16 px.
 */
export function CoSelectedPictures({ coSelection, region }: { coSelection: CoSelection; region: ReadRegion }) {
  const { readPatches, top, requested } = coSelection;
  const others = top.filter((entry) => entry.group !== requested.group).slice(0, PICTURES_SHOWN - 1);
  const cards = [{ group: requested.group, seen: requested.patches > 0, requested: true }, ...others.map((entry) => ({ group: entry.group, seen: true, requested: false }))];
  const hint = region ? WORDS.coSelectedHintCentre : WORDS.coSelectedHint;
  return <section className="grow-co-selected" aria-labelledby="grow-co-selected-title">
    <h2 id="grow-co-selected-title" className="label">{WORDS.coSelected}</h2>
    <p className="grow-hint">{fill(hint, { group: requested.group, needed: neededPatches(readPatches), patches: readPatches })}</p>
    <ul className="grow-co-selected-row">
      {cards.map((card) => <li key={card.group} className="grow-co-selected-card" data-requested={card.requested || undefined} data-off={!card.seen || undefined}>
        <GroupPicture group={card.group} />
        <BasisGroupLink block={card.group} />
      </li>)}
    </ul>
  </section>;
}
