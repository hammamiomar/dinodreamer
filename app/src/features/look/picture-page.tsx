import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigation, useOutlet } from "react-router";
import { useLibrary } from "../../app/library-session";
import { useUploadedPicture } from "../../app/uploaded-picture";
import { useLoaded } from "../../ui/use-loaded";
import { GRID, PATCH_SLOT_OFFSET } from "../../recipe";
import { ResponseView } from "../../ui/responses";
import { indexPath } from "../atlas/atlas-position";
import { BasisGroupLink } from "./basis-group-panel";
import { BasisGroupLinkLabel } from "../../ui/basis-group-link-label";
import { LOOK_TEXT } from "./look-text";
import { firingCells } from "./strongest-blocks";
import { PatchMap } from "./patch-map";
import { GroupLevels, LEVELS, rowsToRead, useRowsInView } from "./picture-levels";
import { groupsAtPatch, groupsByCoverage, type PictureBlock, type PictureReadout, type ShownGroup } from "./picture-readout";
import { BandChip } from "./strength-display";
import { BAND_COLOURS, BAND_NAMES, bandIndex, strengthCuts } from "./strength-bands";
import "./picture.css";

const text = LOOK_TEXT.picturePage;
/** Groups in the list before "Show more basis groups". */
const GROUPS_PER_PAGE = 24;

/**
 * The uploaded picture as one large map, and the basis groups selected in it. A group's row shows
 * your picture with its patches, then its library pictures by response level; pointing at a patch of
 * the map lists the groups selected there. A group opens in its panel, where Train starts.
 */
export function UploadedPicturePage() {
  const upload = useUploadedPicture();
  // A basis group opens in its panel over this page (basis-group-panel.tsx).
  const panel = useOutlet();
  return (
    <main className="picture-page">
      <header className="picture-head">
        <div>
          <h1 className="heading">{text.label}</h1>
          {upload.picture && <p className="picture-file">{upload.picture.name}</p>}
        </div>
        <Link className="link-control" to={indexPath()}>{text.chooseAnother}</Link>
      </header>
      {upload.picture && upload.previewUrl ? (
        <PictureContent key={upload.revision} previewUrl={upload.previewUrl} readout={upload.readout} panelOpen={panel !== null} />
      ) : (
        <div className="picture-empty">
          {upload.phase === "empty" && <p>{text.empty}</p>}
          <PictureStatus />
          {upload.phase !== "preparing" && <Link className="button" to={indexPath()}>{text.toExplore}</Link>}
        </div>
      )}
      {panel}
    </main>
  );
}

function PictureContent({ previewUrl, readout, panelOpen }: {
  previewUrl: string;
  readout: PictureReadout | null;
  /** A basis group's panel covers the page: its rows read no pictures meanwhile. */
  panelOpen: boolean;
}) {
  const departing = useNavigation().state !== "idle";
  const [hovered, setHovered] = useState<PictureBlock | null>(null);
  // The patch chosen on the map: the list shows the groups selected there.
  const [patch, setPatch] = useState<number | null>(null);
  const [limit, setLimit] = useState(GROUPS_PER_PAGE);
  const shown = useMemo<ShownGroup[]>(() => {
    if (!readout) return [];
    return patch === null ? groupsByCoverage(readout, limit) : groupsAtPatch(readout, patch);
  }, [readout, patch, limit]);
  const lit = useMemo(() => hovered ? firingCells(hovered.tokens.map((point) => point.slot - PATCH_SLOT_OFFSET)) : null, [hovered]);

  // Which rows read their level pictures now (picture-levels.tsx).
  const list = useRef<HTMLOListElement>(null);
  const order = shown.map(({ entry }) => entry.block);
  const inView = useRowsInView(list, order.join(" "));
  const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
  const onSettled = useCallback((block: number) => {
    setSettled((previous) => (previous.has(block) ? previous : new Set(previous).add(block)));
  }, []);
  const reading = rowsToRead(order, inView, settled, departing || panelOpen);

  const column = patch === null ? 0 : (patch % GRID) + 1;
  const row = patch === null ? 0 : Math.floor(patch / GRID) + 1;
  return (
    <div className="picture-layout">
      <figure className="picture-figure">
        <PatchMap src={previewUrl} name={text.mapName} lit={lit} chosen={patch}
          onChoose={(cell) => setPatch((previous) => (previous === cell ? null : cell))} onClear={() => setPatch(null)} />
      </figure>
      <section className="picture-groups" aria-labelledby="picture-groups-title">
        <div className="picture-groups-head" aria-live="polite">
          <h2 id="picture-groups-title">{patch === null ? text.groupsTitle : text.groupsAtPatchTitle(column, row)}</h2>
          {patch !== null && <button type="button" className="link-control" onClick={() => setPatch(null)}>{text.showAll}</button>}
          {patch === null && readout && <span>{text.listCount(shown.length, readout.blocks.length)}</span>}
        </div>
        <PictureStatus />
        {readout && (
          <>
            <ColumnHead />
            <ol ref={list} className="picture-group-list">
              {shown.map(({ entry, norm }) => (
                <GroupRow key={entry.block} entry={entry} norm={norm} patch={patch} previewUrl={previewUrl}
                  reading={reading.has(entry.block)} onSettled={onSettled} onHover={setHovered} />
              ))}
            </ol>
            {patch === null && limit < readout.blocks.length && (
              <button type="button" className="link-control picture-more" onClick={() => setLimit(limit + GROUPS_PER_PAGE)}>{text.more}</button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The list's column head, stated once and kept in view while the list scrolls: your picture, then the
 * library's four levels in their colours, weaker to stronger. It names what every row's squares are.
 */
function ColumnHead() {
  return (
    <div className="picture-columns" aria-hidden="true">
      <span className="picture-columns-yours">{text.columnYours}</span>
      <span className="picture-columns-scale"><span>{text.weaker}</span><i /><span>{text.stronger}</span></span>
      {LEVELS.map((band) => (
        <b key={band} className="picture-columns-level" data-band={band} style={{ "--band": BAND_COLOURS[band] } as CSSProperties}>{BAND_NAMES[band]}</b>
      ))}
    </div>
  );
}

/**
 * One basis group, read left to right: its number and how many of your patches select it, then your
 * picture with the group's patches, then the group's library pictures under the four level columns.
 * Your square and the library picture of your level share that level's colour, and the level's name
 * sits under your square. The level is read from `norm` (your strongest patch, or the chosen patch)
 * by the group's own cuts in its Atlas record (2.7 KB), which the level pictures read too. The whole
 * row opens the group.
 */
function GroupRow({ entry, norm, patch, previewUrl, reading, onSettled, onHover }: {
  entry: PictureBlock;
  norm: number;
  /** The patch chosen on the map, boxed on your square. */
  patch: number | null;
  previewUrl: string;
  reading: boolean;
  onSettled: (block: number) => void;
  onHover: (entry: PictureBlock | null) => void;
}) {
  const library = useLibrary();
  const record = useLoaded(entry.block, () => library.atlasCloud(entry.block));
  const band = record.status === "ready" ? bandIndex(norm, strengthCuts(record.value)) : null;
  const patches = useMemo(() => firingCells(entry.tokens.map((point) => point.slot - PATCH_SLOT_OFFSET)), [entry]);
  const levelColour = band === null ? undefined : ({ "--band": BAND_COLOURS[band] } as CSSProperties);
  return (
    <li className="picture-group" data-block={entry.block}
      onMouseEnter={() => onHover(entry)} onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(entry)} onBlur={() => onHover(null)}>
      <BasisGroupLink className="picture-group-open" block={entry.block}>
        <span className="picture-group-line">
          <b className="picture-group-number"><BasisGroupLinkLabel block={entry.block} /></b>
          <span>{text.rowPatches(entry.tokens.length)}</span>
        </span>
        <div className="picture-group-yours" data-marked={band !== null || undefined} style={levelColour}>
          <ResponseView src={previewUrl} alt={text.locatorName(entry.block)} patches={patches} scale={1} />
          {patch !== null && <span className="picture-group-patch" style={{ left: `${(patch % GRID) / GRID * 100}%`, top: `${Math.floor(patch / GRID) / GRID * 100}%` }} />}
        </div>
        {band !== null && <span className="picture-group-yours-level"><BandChip band={band} /></span>}
        <GroupLevels block={entry.block} reading={reading} marked={band} onSettled={onSettled} />
      </BasisGroupLink>
    </li>
  );
}

function PictureStatus() {
  const upload = useUploadedPicture();
  if (!upload.message) return null;
  return (
    <div className="picture-status">
      <p role={upload.phase === "failed" ? "alert" : "status"}>{upload.message}</p>
      {upload.phase === "failed" && upload.picture && <button className="button" onClick={() => void upload.read()}>{text.readAgain}</button>}
      {(upload.phase === "preparing" || upload.phase === "reading") && <button className="link-control" onClick={upload.clear}>{text.cancel}</button>}
    </div>
  );
}
