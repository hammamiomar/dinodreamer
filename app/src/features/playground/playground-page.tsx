// Automata keeps the selected material in the URL. The stage stays fixed beside a scrolling
// shelf on wide screens; on narrow screens the shelf follows it in page flow. The owner view
// shares this layout and supplies its own entries, tile marks and stage actions.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Outlet, useSearchParams } from "react-router";
import type { BasisGroupPanelOutlet } from "../look/basis-group-panel";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import { keptOrigin, MATERIALS_KEPT_EVENT } from "../../replay/keep-material";
import { MaterialStage, PUBLISHED_SOURCE, type MaterialSource } from "../../replay/material-stage";
import { keptMaterials } from "../../storage/materials";
import { MaterialLabel } from "../gallery/material-label";
import { useMaterialIndex } from "../gallery/material-gallery";
import { materialsByBlock, type MaterialEntry } from "../gallery/material-index";
import { inWindow, travelOutline } from "./outline-travel";
import { EVERY_MATERIAL, familiesPresent, featuredMaterials, keptByChoices, materialToPlay, type PlaygroundChoices } from "./playground";
import { PlaygroundShelf, type Choose, type KeptState, type TileMark } from "./playground-shelf";
import { StageBlockNumber } from "./block-preview";
import { keptEntry, withKept } from "./yours";
import "./playground.css";

const WORDS = SITE_WORDS.playground;

export function PlaygroundPage() {
  const index = useMaterialIndex();
  const entries = index.index.entries;
  const featured = useMemo(() => featuredMaterials(entries), [entries]);
  return (
    <PlaygroundLayout
      entries={entries}
      status={index.status}
      message={index.status === "failed" ? index.message : undefined}
      baseSource={PUBLISHED_SOURCE}
      featured={featured}
    />
  );
}

/** A group above Featured on the shelf: the owner mode's Pending review. */
export interface LeadingGroup {
  key: string;
  title: string;
  entries: readonly MaterialEntry[];
}

/**
 * The Playground's stage and shelf, for the page above and for the owner mode (features/owner/).
 * `entries` are the published automata that the shelf groups by block; the address can name one of
 * them, a kept one, or one of `leadingGroups`. The stage reads them from `baseSource` (a kept one from
 * this device). `featured` and `leadingGroups` are the shelf's first groups, `marksOf` gives a tile
 * its marks, and `stageActions` and `stageNotice` put the owner's actions and their result on the stage.
 */
export function PlaygroundLayout({ entries, status, message, baseSource, featured, leadingGroups = NO_GROUPS, marksOf, stageActions, stageNotice }: {
  entries: readonly MaterialEntry[];
  status: "loading" | "ready" | "failed";
  message?: string;
  baseSource: MaterialSource;
  featured: readonly MaterialEntry[];
  leadingGroups?: readonly LeadingGroup[];
  marksOf?: (entry: MaterialEntry) => readonly TileMark[];
  stageActions?: (entry: MaterialEntry) => ReactNode;
  stageNotice?: (entry: MaterialEntry) => string | null;
}) {
  const [search, setSearch] = useSearchParams();
  const [choices, setChoices] = useState<PlaygroundChoices>(EVERY_MATERIAL);
  const families = useBlockFamilies(entries);
  const yours = useKeptMaterials();
  const source = useMemo(() => withKept(yours.figures, baseSource), [yours.figures, baseSource]);
  const stage = useRef<HTMLElement>(null);

  const asked = search.get("material");
  const leading = leadingGroups.flatMap((group) => group.entries).find((entry) => entry.id === asked);
  const playing = leading ?? materialToPlay(
    { id: asked, yoursFirst: search.get("group") === "yours" },
    yours.figures.map((figure) => figure.entry),
    entries,
  );
  // Refreshing saved records must not restart a published replay.
  const stageSource = yours.figures.some((figure) => figure.entry.id === playing?.id) ? source : baseSource;
  const choose: Choose = (entry, picture) => {
    const frame = stage.current?.querySelector(".frame")?.getBoundingClientRect();
    // One history entry for the page: Back leaves it, whatever was played.
    setSearch({ material: entry.id }, { replace: true, preventScrollReset: true });
    if (frame && inWindow(frame)) {
      travelOutline(picture.getBoundingClientRect(), frame);
    } else {
      // Where the shelf flows under the stage, the chosen material comes into view.
      stage.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  useKeptArrival(stage, yours);
  // The basis group panel over this page (basis-group-panel.tsx) opens the playing automaton's group on its reference patch.
  const panelOutlet = useMemo<BasisGroupPanelOutlet>(() => ({
    referencePatch: async (block) => (playing && playing.block === block ? (await source.load(playing)).file.anchor : null),
  }), [playing, source]);

  const kept = entries.filter((entry) => keptByChoices(entry, choices, families.get(entry.block)));
  return (
    <main className="playground">
      <section ref={stage} className="playground-stage" aria-label={playing?.title}>
        {playing ? (
          <>
            <header className="playground-head">
              <StageBlockNumber block={playing.block} family={families.get(playing.block)} />
              <MaterialLabel entry={playing} load={source.load} />
            </header>
            <MaterialStage entries={[playing]} source={stageSource} layout="instrument"
              ownerActions={stageActions?.(playing)} notice={stageNotice?.(playing)} />
          </>
        ) : (
          <p className="playground-status" role={status === "failed" ? "alert" : undefined}>
            {status === "loading" && WORDS.loading}
            {status === "failed" && fill(WORDS.failed, { message: message ?? "" })}
            {status === "ready" && WORDS.nothingPublished}
          </p>
        )}
      </section>
      <PlaygroundShelf
        yours={yours}
        playing={playing}
        source={source}
        featured={featured}
        leadingGroups={leadingGroups}
        marksOf={marksOf}
        groups={materialsByBlock({ entries: kept })}
        choices={choices}
        families={familiesPresent(entries, families)}
        matching={kept.length}
        familyOf={(block) => families.get(block)}
        onChoices={setChoices}
        onChoose={choose}
        onRemoved={() => { yours.refresh(); setSearch({}, { replace: true, preventScrollReset: true }); }}
      />
      <Outlet context={panelOutlet} />
    </main>
  );
}

const NO_GROUPS: readonly LeadingGroup[] = [];

/** The kept materials of this device, read again when Keep, Import, Remove or Grow change them. */
function useKeptMaterials(): KeptState {
  const [state, setState] = useState<Omit<KeptState, "refresh">>({ status: "loading", figures: [] });
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    let current = true;
    keptMaterials().then(
      (kept) => { if (current) setState({ status: "ready", figures: kept.map((material) => ({ entry: keptEntry(material), material })) }); },
      (error: unknown) => { if (current) setState({ status: "failed", message: String(error instanceof Error ? error.message : error), figures: [] }); },
    );
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    window.addEventListener(MATERIALS_KEPT_EVENT, refresh);
    return () => window.removeEventListener(MATERIALS_KEPT_EVENT, refresh);
  }, []);
  return { ...state, refresh };
}

/**
 * When the stage's Keep adds a material to Yours, its outline travels from the frame to the new
 * tile, if both are in the window: the frame's box is taken at the moment of keeping, the tile's
 * once Yours has been read again and the tile is drawn. A material Train's run kept (it trains
 * whatever page is open) did not come from the stage, so it arrives without the outline.
 */
function useKeptArrival(stage: RefObject<HTMLElement>, yours: KeptState) {
  const from = useRef<{ box: DOMRect; known: Set<string> } | null>(null);
  useEffect(() => {
    const kept = (event: Event) => {
      if (keptOrigin(event) !== "stage") return;
      const frame = stage.current?.querySelector(".frame");
      if (frame) from.current = { box: frame.getBoundingClientRect(), known: new Set(yours.figures.map((figure) => figure.entry.id)) };
    };
    window.addEventListener(MATERIALS_KEPT_EVENT, kept);
    return () => window.removeEventListener(MATERIALS_KEPT_EVENT, kept);
  }, [stage, yours.figures]);
  useLayoutEffect(() => {
    const start = from.current;
    const arrived = start && yours.figures.find((figure) => !start.known.has(figure.entry.id));
    if (!start || !arrived) return;
    from.current = null;
    const picture = document.querySelector(`.playground-yours [data-material="${CSS.escape(arrived.entry.id)}"] img`);
    const box = picture?.getBoundingClientRect();
    if (box && inWindow(start.box) && inWindow(box)) travelOutline(start.box, box);
  }, [yours.figures]);
}

/** The family of each block with a material, from the release's provenance records; "unknown" without one. */
function useBlockFamilies(entries: readonly MaterialEntry[]): Map<number, string> {
  const library = useLibrary();
  const [families, setFamilies] = useState<Map<number, string>>(new Map());
  const blocks = [...new Set(entries.map((entry) => entry.block))].sort((a, b) => a - b);
  const key = blocks.join(",");
  useEffect(() => {
    if (!key) return;
    let current = true;
    const reads = key.split(",").map(Number).map(async (block): Promise<[number, string]> => {
      const pending = library.provenance(block);
      if (pending === null) return [block, "unknown"];
      try {
        return [block, (await pending).roles.patch?.family ?? "unknown"];
      } catch {
        return [block, "unknown"];
      }
    });
    void Promise.all(reads).then((pairs) => { if (current) setFamilies(new Map(pairs)); });
    return () => { current = false; };
  }, [library, key]);
  return families;
}
