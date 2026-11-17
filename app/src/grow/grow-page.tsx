import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Outlet, useSearchParams } from "react-router";
import { useLibrary } from "../app/library-session";
import { useMaterialRequest } from "../app/material-request";
import { SITE_WORDS, fill } from "../app/site-words";
import type { MaterialAnchor } from "../recipe";
import { useObjectUrl } from "../ui/files";
import { fetchPublishedMaterial } from "../features/gallery/material-gallery";
import { WARNED_BELOW } from "../features/look/grow-from-picture";
import { STRENGTH_BANDS, sampleStrengthCuts, type BandIndex } from "../features/look/strength-bands";
import { anchorToken, bandRequest, strongestBandRequest } from "../features/look/strongest-request";
import { BasisGroupLink } from "../features/look/basis-group-panel";
import { TokenPicture } from "../features/look/token-pictures";
import { keptMaterials } from "../storage/materials";
import { LibraryImage } from "../ui/library-image";
import { methodNeedsSet, type FigureMaterial, type FigureMethod, type SetPicture } from "../materials/material-file";
import { continuationRequest, continuationSource, type ContinuationSource } from "./continuation";
import { GrowPanel } from "./grow-panel";
import { trainRun } from "./train-run";
import { bandName } from "./live-readout";
import { resolveTargetSet } from "./target-set";
import { methodFromSearch } from "./train-method";
import "./grow.css";

const WORDS = SITE_WORDS.grow;

/** The patch Train aims at: its picture with the patch marked, one sentence, its band, the warning near the ring, and the way to another. */
function Occurrence({ block, anchor, uploadUrl, lift }: { block: number; anchor: MaterialAnchor; uploadUrl?: string; lift: boolean }) {
  let toward: string = WORDS.towardLibrary;
  if (anchor.source === "upload") toward = WORDS.towardUpload;
  else if (lift) toward = WORDS.towardNearest;
  const warned = STRENGTH_BANDS.indexOf(anchor.band) < WARNED_BELOW;
  return <div className="grow-toward">
    <TokenPicture point={anchorToken(anchor)} uploadUrl={uploadUrl} />
    <div>
      <p>{toward}</p>
      <span className={`band ${anchor.band}`}>{bandName(anchor.band)}</span>
      {warned && <p className="grow-warning">{WORDS.weakReference}</p>}
      <BasisGroupLink className="grow-pick" block={block}>{WORDS.pickAnother}</BasisGroupLink>
    </div>
  </div>;
}

/** Patches per side of a library picture, and the patches a set picture brings around its own: 3 × 3. */
const PICTURE_PATCHES = 16;
const SET_WINDOW_PATCHES = 3;

/**
 * One set picture as the set uses it: the 3 × 3 patches around its patch (moved inside the picture at
 * its edges), cut from the picture's thumbnail by its place (grow.css .grow-set-crop).
 */
function SetCrop({ picture }: { picture: SetPicture }) {
  const library = useLibrary();
  const first = (position: number) => Math.min(Math.max(position - 1, 0), PICTURE_PATCHES - SET_WINDOW_PATCHES);
  const place = { "--row0": first(Math.floor(picture.patch / PICTURE_PATCHES)), "--column0": first(picture.patch % PICTURE_PATCHES) } as CSSProperties;
  return <span className="grow-set-crop" style={place}><LibraryImage src={library.thumbnailUrl(picture.imageId)} alt="" /></span>;
}

/**
 * A set method's target, in the place and shape of the marked patch: the set's pictures, each the 3 × 3
 * patches it brings; one sentence; in the level's place what each picture brings; and in the place of
 * the way to another patch, the group's page, where its pictures show large. A set method does not train
 * toward the reference patch, so there is no level to choose.
 */
function SetOccurrence({ block, pictures, sentence }: { block: number; pictures: readonly SetPicture[]; sentence: string }) {
  return <div className="grow-set">
    <div className="grow-set-pictures" role="img" aria-label={fill(WORDS.setPictures, { count: pictures.length })}>
      {pictures.map((picture) => <SetCrop key={picture.imageId} picture={picture} />)}
    </div>
    <div>
      <p>{sentence}</p>
      <span className="band">{WORDS.setPatches}</span>
      <BasisGroupLink className="grow-pick" block={block}>{WORDS.setLink}</BasisGroupLink>
    </div>
  </div>;
}

/**
 * The set a new run of a set method resolves, from the group's strongest rows by the worker's own rule
 * (target-set.ts resolveTargetSet): null while it loads or for another method, [] when the rows cannot be read.
 */
function useSetPictures(block: number | null, method: FigureMethod): SetPicture[] | null {
  const library = useLibrary();
  const [state, setState] = useState<{ block: number; pictures: SetPicture[] } | null>(null);
  const wanted = block !== null && methodNeedsSet(method);
  useEffect(() => {
    if (!wanted || block === null) return;
    let current = true;
    void library.strongestRows(block).then((rows) => {
      if (current) setState({ block, pictures: rows ? resolveTargetSet(rows) : [] });
    });
    return () => { current = false; };
  }, [library, block, wanted]);
  return wanted && state?.block === block ? state.pictures : null;
}

/**
 * A continuation's patch: the sentence names the update it trains on from, and in place of the way to
 * another patch the four response levels of the basis group; the definition's own level is its own
 * reference patch, another level that level's patch nearest the main direction (bandRequest).
 */
function ContinuedOccurrence({ source, anchor, onLevel }: {
  source: ContinuationSource; anchor: MaterialAnchor; onLevel: (level: BandIndex) => void;
}) {
  return <div className="grow-toward">
    <TokenPicture point={anchorToken(anchor)} />
    <div>
      <p>{fill(WORDS.continuing, { update: source.fromUpdate.toLocaleString("en-US") })}</p>
      <span className={`band ${anchor.band}`}>{bandName(anchor.band)}</span>
      <span className="grow-levels" role="group" aria-label={WORDS.continuedLevels}>
        {STRENGTH_BANDS.map((band, level) => <button key={band} type="button" className="grow-pick" aria-pressed={band === anchor.band}
          onClick={() => onLevel(level as BandIndex)}>{bandName(band)}</button>)}
      </span>
    </div>
  </div>;
}

/** A definition saved on this device by its id, else a published one by its entry id. */
async function loadDefinition(id: string): Promise<FigureMaterial> {
  const saved = (await keptMaterials()).find((material) => material.file.id === id);
  return saved ?? fetchPublishedMaterial(id);
}

/** The definition a /train?continue=<id> address names, as Train continues it, or why it cannot. */
function useContinuationSource(id: string | null): { source: ContinuationSource | null; problem: string | null } {
  const [state, setState] = useState<{ id: string | null; source: ContinuationSource | null; problem: string | null }>(
    { id: null, source: null, problem: null });
  useEffect(() => {
    if (id === null) return;
    let current = true;
    void loadDefinition(id).then(continuationSource).then(
      (source) => { if (current) setState({ id, source, problem: null }); },
      (error: unknown) => { if (current) setState({ id, source: null, problem: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  }, [id]);
  return state.id === id ? state : { source: null, problem: null };
}

/**
 * A continuation's training target: the definition's own reference patch, or, for another response
 * level, that level's patch of the same basis group.
 */
function useContinuationRequest(source: ContinuationSource | null, level: BandIndex | null) {
  const library = useLibrary();
  const { request, setRequest } = useMaterialRequest();
  const [selection, setSelection] = useState<{
    source: ContinuationSource; level: BandIndex; problem: string | null;
  } | null>(null);
  const needsLookup = source !== null && level !== null && STRENGTH_BANDS[level] !== source.anchor.band;
  const selected = selection?.source === source && selection.level === level
    && (selection.problem !== null || request?.anchor?.band === STRENGTH_BANDS[level!]) ? selection : null;
  useEffect(() => {
    if (!source) return;
    // Back on Train for a definition whose run goes on, the page aims where that run does, at whatever level it chose.
    const running = trainRun.state().settings;
    if (level === null && running?.continuation?.id === source.id) {
      setRequest(running.request, running.picture);
      return;
    }
    if (level === null || STRENGTH_BANDS[level] === source.anchor.band) {
      setRequest(continuationRequest(source));
      return;
    }
    let current = true;
    setSelection(null);
    void library.blockCloud(source.block).then((cloud) => {
      if (!current) return;
      const next = bandRequest(cloud, sampleStrengthCuts(cloud.whole.gateMedian, cloud.sample.norms), level);
      if (!next) throw new Error("This response level has no public reference patch.");
      setRequest(next);
      setSelection({ source, level, problem: null });
    }).catch((error: unknown) => {
      if (current) setSelection({ source, level, problem: error instanceof Error ? error.message : String(error) });
    });
    return () => { current = false; };
  }, [library, source, level, setRequest]);
  return { loading: needsLookup && selected === null, problem: needsLookup ? selected?.problem ?? null : null };
}

/** The block a /train?block=N address asks for, or null. */
function askedBlock(search: URLSearchParams): number | null {
  const value = Number(search.get("block"));
  return search.has("block") && Number.isInteger(value) && value >= 0 && value < 16384 ? value : null;
}

/**
 * /train?block=N starts from Look's default request, "Start with the Strongest band" and Send
 * (strongestBandRequest), unless Look already handed over a request for that block.
 */
function useBlockRequest(block: number | null) {
  const library = useLibrary();
  const { request, setRequest } = useMaterialRequest();
  // "none": the block has no Strongest patch with a public picture; otherwise the error that stopped the read.
  const [problem, setProblem] = useState<string | null>(null);
  const needed = block !== null && request?.block !== block;
  useEffect(() => {
    if (!needed || block === null) return;
    let current = true;
    setProblem(null);
    void library.blockCloud(block).then((cloud) => {
      if (!current) return;
      const next = strongestBandRequest(cloud, sampleStrengthCuts(cloud.whole.gateMedian, cloud.sample.norms));
      if (next) setRequest(next);
      else setProblem("none");
    }).catch((error: unknown) => { if (current) setProblem(String(error)); });
    return () => { current = false; };
  }, [library, block, needed, setRequest]);
  return { loading: needed && problem === null, problem };
}

/** The live grower: the request in, a growing material, its readouts, and the kept material out. */
export function GrowPage() {
  const [search] = useSearchParams();
  const asked = askedBlock(search);
  const { request, picture } = useMaterialRequest();
  const { loading, problem } = useBlockRequest(asked);
  const continued = useContinuationSource(search.get("continue"));
  const source = continued.source;
  const [level, setLevel] = useState<BandIndex | null>(null);
  useEffect(() => setLevel(null), [source]);
  const reference = useContinuationRequest(source, level);
  const uploadUrl = useObjectUrl(picture?.preview ?? null) ?? undefined;
  // A continuation waits for its definition and its own training target.
  const continuing = search.has("continue");
  const sourceReady = source !== null && request?.block === source.block && !reference.loading && reference.problem === null;
  const waiting = loading || problem !== null || (continuing && !sourceReady);
  const block = continuing ? source?.block ?? null : waiting ? asked : request?.block ?? asked;
  // The method: "Train a variation" names it in the address; a continuation trains by its definition's own.
  const [chosenMethod, setChosenMethod] = useState<FigureMethod>(() => methodFromSearch(search));
  const method = continuing && source ? source.objective.method : chosenMethod;
  const setPictures = useSetPictures(continuing ? null : block, method);

  // Under the display: the occurrence, or why there is none yet.
  let occurrence: ReactNode;
  if (loading) occurrence = <p className="grow-note" role="status">{fill(WORDS.choosing, { block: asked ?? "" })}</p>;
  else if (problem !== null) {
    occurrence = <div className="grow-toward-problem">
      <p className="grow-note">{problem === "none" ? fill(WORDS.noStrongest, { block: asked ?? "" }) : problem}</p>
      {asked !== null && <BasisGroupLink className="grow-pick" block={asked}>{WORDS.pickAnother}</BasisGroupLink>}
    </div>;
  }
  else if (continuing && continued.problem !== null) occurrence = <p className="grow-note">{continued.problem}</p>;
  else if (continuing && source?.objective.set) {
    // A set method's definition continues toward its own set; the reference patch plays no part.
    const { pictures } = source.objective.set;
    const sentence = fill(WORDS.continuingSet, { update: source.fromUpdate.toLocaleString("en-US"), count: pictures.length });
    occurrence = <SetOccurrence block={source.block} pictures={pictures} sentence={sentence} />;
  }
  else if (continuing && source) {
    occurrence = <>
      <ContinuedOccurrence source={source} anchor={request?.anchor ?? source.anchor} onLevel={setLevel} />
      {reference.loading && <p className="grow-note" role="status">{WORDS.loading}</p>}
      {reference.problem && <p className="grow-note" role="alert">{reference.problem}</p>}
    </>;
  }
  else if (continuing && !sourceReady) occurrence = <p className="grow-note" role="status">{WORDS.loading}</p>;
  else if (request?.mode === "plant") occurrence = <p className="grow-note">{WORDS.plant}</p>;
  else if (request && !request.anchor) occurrence = <p className="grow-note">{WORDS.noAnchor}</p>;
  else if (request?.anchor && methodNeedsSet(method)) {
    occurrence = setPictures === null
      ? <p className="grow-note" role="status">{fill(WORDS.setLoading, { block: request.block })}</p>
      : <SetOccurrence block={request.block} pictures={setPictures} sentence={fill(WORDS.towardSet, { count: setPictures.length })} />;
  }
  else if (request?.anchor) occurrence = <Occurrence block={request.block} anchor={request.anchor} uploadUrl={uploadUrl} lift={picture?.lift ?? false} />;
  else occurrence = <p className="grow-note">{WORDS.nothing}</p>;

  return <main className="grow-page">
    <GrowPanel block={block} request={waiting ? null : request} continuation={continuing ? source : null} method={method} onMethod={setChosenMethod} heading={<>
      <h1 className="display grow-title" style={{ "--lines": block === null ? 1 : 2 } as CSSProperties}>{WORDS.title}{block !== null && <><br />{block}</>}</h1>
      <div className="grow-occurrence">{occurrence}</div>
    </>} />
    {/* A basis group opens in its panel over Train (basis-group-panel.tsx); the run goes on under it. */}
    <Outlet />
  </main>;
}
