import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useLibrary } from "../../app/library-session";
import { useMaterialRequest } from "../../app/material-request";
import { useUploadedPicture } from "../../app/uploaded-picture";
import { useLoaded } from "../../ui/use-loaded";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { ResponseOverlay, ResponseView, usePictureShown } from "../../ui/responses";
import { explorePath } from "../atlas/atlas-position";
import { BasisGroupLink } from "./basis-group-panel";
import { BasisGroupLinkLabel } from "../../ui/basis-group-link-label";
import { LOOK_TEXT } from "./look-text";
import { firingCells } from "./strongest-blocks";
import { pictureGrowRequest } from "./grow-from-picture";
import type { PictureBlock, PictureReadout } from "./picture-readout";
import { BandChip } from "./strength-display";
import { bandIndex, sampleStrengthCuts, strengthCuts } from "./strength-bands";
import { growPath } from "./strongest-request";
import "./picture.css";

const text = LOOK_TEXT.picturePage;

/**
 * The uploaded picture's centre crop and the basis groups selected in it. Each group can
 * open its panel or train from the picture's patches.
 */
export function UploadedPicturePage() {
  const upload = useUploadedPicture();
  return (
    <main className="picture-page">
      <header className="picture-head">
        <div><p className="label">{text.label}</p><h1 className="heading">{upload.picture?.name ?? text.untitled}</h1></div>
        <Link className="link-control" to={explorePath()}>{text.chooseAnother}</Link>
      </header>
      {upload.picture && upload.previewUrl ? (
        <PictureContent key={upload.revision} previewUrl={upload.previewUrl} readout={upload.readout} />
      ) : (
        <div className="picture-empty">
          {upload.phase === "empty" && <p>{text.empty}</p>}
          <PictureStatus />
          {upload.phase !== "preparing" && <Link className="button" to={explorePath()}>{text.toExplore}</Link>}
        </div>
      )}
      {/* A basis group opens in its panel over this page (basis-group-panel.tsx). */}
      <Outlet />
    </main>
  );
}

function PictureContent({ previewUrl, readout }: { previewUrl: string; readout: PictureReadout | null }) {
  const location = useLocation();
  const [hovered, setHovered] = useState<PictureBlock | null>(null);
  const [limit, setLimit] = useState(24);
  const picture = usePictureShown(previewUrl);
  const grow = useGrowFromPicture();
  const entries = useMemo(() => readout?.blocks.slice(0, limit).map((entry) => ({
    entry,
    patches: firingCells(entry.tokens.map((point) => point.slot - PATCH_SLOT_OFFSET)),
  })) ?? [], [readout, limit]);
  const overlay = useMemo(() => hovered ? firingCells(hovered.tokens.map((point) => point.slot - PATCH_SLOT_OFFSET)) : null, [hovered]);
  return (
    <div className="picture-layout">
      <figure className="picture-figure">
        <div className="picture-preview" data-block={hovered?.block}>
          <img ref={picture.ref} src={previewUrl} onLoad={picture.onLoad} width={256} height={256} alt={text.pictureName} />
          {overlay && picture.shown && <ResponseOverlay patches={overlay} scale={1} />}
        </div>
        <figcaption aria-live="polite">{hovered ? text.hovered(hovered.block, hovered.tokens.length) : text.hoverHint}</figcaption>
        <p className="picture-note">{text.note}</p>
      </figure>
      <section className="picture-blocks" aria-label={text.blocksName}>
        <div className="picture-blocks-head">
          <h2 className="label">{text.blocksTitle}</h2>
          <p>{text.blocksLead}</p>
        </div>
        <PictureStatus />
        {readout && (
          <>
            <div className="picture-block-grid">
              {entries.map(({ entry, patches }) => (
                <div key={entry.block} className="picture-block" data-block={entry.block} data-patches={entry.tokens.length}
                  onMouseEnter={() => setHovered(entry)} onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(entry)} onBlur={() => setHovered(null)}>
                  <BasisGroupLink className="picture-block-open" block={entry.block}>
                    <ResponseView src={previewUrl} alt="" patches={patches} scale={1} />
                    <span><b><BasisGroupLinkLabel block={entry.block} /></b><small>{text.patches(entry.tokens.length)}</small><StrongestBand entry={entry} /></span>
                    <i aria-hidden="true"><i style={{ width: `${entry.tokens.length / 256 * 100}%` }} /></i>
                  </BasisGroupLink>
                  <button type="button" className="button picture-block-grow" disabled={grow.opening !== null} onClick={() => void grow.open(entry, location.search)}>
                    {grow.opening === entry.block ? text.opening : text.growFrom}
                  </button>
                </div>
              ))}
            </div>
            {grow.problem && <p className="picture-status" role="alert">{grow.problem}</p>}
            <p className="picture-list-count">{text.listCount(entries.length, readout.blocks.length)}</p>
            {limit < readout.blocks.length && <button className="link-control" onClick={() => setLimit(limit + 24)}>{text.more}</button>}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * "Grow from this" on a block: the block's cloud is read, the request is built by the band rule
 * (grow-from-picture.ts) with the picture's own patches, and Grow opens on it with the picture.
 */
function useGrowFromPicture() {
  const library = useLibrary();
  const upload = useUploadedPicture();
  const { setRequest } = useMaterialRequest();
  const navigate = useNavigate();
  const location = useLocation();
  const operation = useRef(0);
  const [opening, setOpening] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  // Leaving this location invalidates a read that could otherwise replace a newer choice.
  useEffect(() => {
    setOpening(null);
    return () => { operation.current++; };
  }, [location.key]);
  const open = async (entry: PictureBlock, search: string) => {
    const current = ++operation.current;
    setOpening(entry.block);
    setProblem("");
    try {
      const cloud = await library.blockCloud(entry.block);
      if (current !== operation.current) return;
      const grow = pictureGrowRequest(cloud, entry.tokens, sampleStrengthCuts(cloud.whole.gateMedian, cloud.sample.norms));
      if (!grow) {
        setProblem(LOOK_TEXT.picture.none);
        return;
      }
      setRequest(grow.request, upload.picture ? { name: upload.picture.name, preview: upload.picture.preview } : null);
      navigate(growPath(entry.block, search));
    } catch (error) {
      if (current === operation.current) setProblem(String(error instanceof Error ? error.message : error));
    } finally {
      if (current === operation.current) setOpening(null);
    }
  };
  return { open, opening, problem };
}

/** Your strongest patch in a block, named by that block's band cuts. Reads its 2.7 KB Atlas record once. */
function StrongestBand({ entry }: { entry: PictureBlock }) {
  const library = useLibrary();
  const record = useLoaded(entry.block, () => library.atlasCloud(entry.block));
  if (record.status !== "ready") return null;
  const strongest = Math.max(...entry.tokens.map((point) => point.norm));
  return <BandChip band={bandIndex(strongest, strengthCuts(record.value))} />;
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
