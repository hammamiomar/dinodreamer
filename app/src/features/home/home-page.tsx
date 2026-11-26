// The home page (`/`): an untouched negative-space entrance followed by four zero-prerequisite
// scenes paired with interactive stages on the pure-black right-hand panel (or inline on narrow screens).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { fillNodes } from "../../app/fill-nodes";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useManifoldFocus, type ManifoldFocus } from "../../ground/manifold-focus";
import { DRAWN_AT_RANDOM } from "../../grow/random-group";
import type { FigureMaterial } from "../../materials/material-file";
import { useMediaMatch } from "../../ui/media-match";
import { ResetMark } from "../../ui/reset-mark";
import { usePrefersReducedMotion } from "../../ui/tween";
import { useLoaded, type Loaded } from "../../ui/use-loaded";
import { indexPath } from "../atlas/atlas-position";
import { useMaterialIndex, usePublishedMaterial } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { AUTOMATON_RECORD_FOLDER, loadAutomatonState } from "../how/automaton-record";
import { HOW_AUTOMATON, HOW_REGROW_AT_TICK } from "../how/figures/figure-data";
import { ChoosePictureButton } from "../look/picture-entry";
import { HomeCollectionStage } from "./home-collection-stage";
import { HomeKeepStage } from "./home-keep-stage";
import { ENTRANCE_AUTOMATA, entrancePool, HOME_TICKS_PER_SECOND, shuffled } from "./home-material";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import { FIELD_DRAW_RATIO, HomePanel, type Shown } from "./home-panel";
import { HomePropertiesStage } from "./home-properties-stage";
import { entranceAutomaton } from "./home-relay";
import { approachedBeats, HOME_BEATS, readingLine, sectionAt, type HomeBeat } from "./home-scroll";
import { collectionCoverage, PROPERTY_GROUPS, randomUnexploredGroup } from "./home-specimens";
import { HomeTrainStage } from "./home-train-stage";
import "./home.css";

const WORDS = SITE_WORDS.home;
const HEADER = SITE_WORDS.header;
const BURN_URL = "https://burn.dev";
const NARROW_QUERY = "(max-width: 1023px)";

const STILL_WORDS: Record<Exclude<HomeStill, null>, string> = {
  "no-webgpu": WORDS.noWebGpu,
  "reduced-motion": WORDS.reducedMotion,
};

function sameFocus(a: ManifoldFocus, b: ManifoldFocus): boolean {
  return a.group === b.group && a.accent === b.accent;
}

/** The entrance's automaton (home-relay.ts, entranceAutomaton), keeping the running field during relays. */
function useEntranceAutomaton(choice: MaterialEntry | null, file: Loaded<FigureMaterial>): Shown | null {
  const [running, setRunning] = useState<Shown | null>(null);
  const shown = entranceAutomaton(choice, file, running);
  if (shown?.material && (running?.entry !== shown.entry || running.material !== shown.material)) {
    setRunning(shown);
  }
  return shown;
}

export function HomePage() {
  const home = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const update = () => {
      const fullWidthTouch = window.matchMedia("(pointer: coarse)").matches && Math.abs(screen.width - window.innerWidth) < 2;
      home.current?.style.setProperty("--home-background-height", fullWidthTouch ? `${screen.height}px` : "100lvh");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const index = useMaterialIndex();
  const reducedMotion = usePrefersReducedMotion();
  const narrow = useMediaMatch(NARROW_QUERY);

  const [noReplay, setNoReplay] = useState(false);
  const replayFailed = useCallback(() => setNoReplay(true), []);
  const still: HomeStill = !("gpu" in navigator) || noReplay ? "no-webgpu" : reducedMotion ? "reduced-motion" : null;

  const entries = index.status === "ready" ? index.index.entries : [];
  const coverage = useMemo(() => collectionCoverage(entries), [entries]);

  // Entrance relay pool, shuffled once per visit.
  const [order] = useState(() => shuffled(ENTRANCE_AUTOMATA, Math.random));
  const pool = useMemo(() => {
    if (index.status !== "ready") return [];
    const matched = entrancePool(index.index.entries, order);
    return matched.length > 0 ? matched : index.index.entries.slice(0, 1);
  }, [index, order]);
  const [turned, setTurned] = useState(0);
  const [reset, setReset] = useState(0);
  const chosenEntry: MaterialEntry | null = pool.length > 0 ? pool[((turned % pool.length) + pool.length) % pool.length]! : null;
  const chosenMaterial = usePublishedMaterial(still ? null : chosenEntry);
  const entrance = useEntranceAutomaton(chosenEntry, chosenMaterial);

  // Track active beat and furthest reached beat so untouched entrances download nothing below them.
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [place, setPlace] = useState<{ beat: HomeBeat; scrolled: boolean }>({ beat: "entrance", scrolled: false });
  const [reached, setReached] = useState({ furthest: 0, scrolled: false });
  const approached = approachedBeats(reached.furthest, reached.scrolled);

  // Closing hibiscus automaton (basis group 4009, the site's favicon figure), loaded only as Beat 4 is reached.
  const endEntry = useMemo(() => entries.find((candidate) => candidate.id === HOW_AUTOMATON) ?? null, [entries]);
  const endLoads = still === null && approached.end;
  const endMaterial = usePublishedMaterial(endLoads ? endEntry : null);
  const endState = useLoaded(endLoads ? "end-state" : null, () => (endLoads ? loadAutomatonState() : null));
  const endShown: Shown | null = endEntry ? { entry: endEntry, material: endMaterial.status === "ready" ? endMaterial.value : null } : null;
  const endInitialState = useMemo(() => (endState.status === "ready" ? {
    tick: endState.value.replay.tick,
    fine: endState.value.fine.state,
    coarse: endState.value.coarse.state,
  } : undefined), [endState]);

  // Track active pattern and sampled accent per beat so the site-wide 3D manifold morphs live.
  const [entranceAccent, setEntranceAccent] = useState<string | null>(null);
  const [propertiesFocus, setPropertiesFocus] = useState<ManifoldFocus>({ group: PROPERTY_GROUPS[0], accent: null });
  const [collectionFocus, setCollectionFocus] = useState<ManifoldFocus>({ group: null, accent: null });
  const [trainFocus, setTrainFocus] = useState<ManifoldFocus>({ group: null, accent: null });
  const [keepFocus, setKeepFocus] = useState<ManifoldFocus>({ group: null, accent: null });
  const [endAccent, setEndAccent] = useState<string | null>(null);

  const onEntranceAccent = useCallback((accent: string) => {
    setEntranceAccent((previous) => (previous === accent ? previous : accent));
  }, []);
  const onPropertiesFocus = useCallback((focus: ManifoldFocus) => {
    setPropertiesFocus((previous) => (sameFocus(previous, focus) ? previous : focus));
  }, []);
  const onCollectionFocus = useCallback((focus: ManifoldFocus) => {
    setCollectionFocus((previous) => (sameFocus(previous, focus) ? previous : focus));
  }, []);
  const onTrainFocus = useCallback((focus: ManifoldFocus) => {
    setTrainFocus((previous) => (sameFocus(previous, focus) ? previous : focus));
  }, []);
  const onKeepFocus = useCallback((focus: ManifoldFocus) => {
    setKeepFocus((previous) => (sameFocus(previous, focus) ? previous : focus));
  }, []);
  const onEndAccent = useCallback((accent: string) => {
    setEndAccent((previous) => (previous === accent ? previous : accent));
  }, []);

  const activeFocus: ManifoldFocus = (() => {
    switch (place.beat) {
      case "entrance":
        return { group: entrance?.entry.block ?? null, accent: entranceAccent };
      case "properties":
        return propertiesFocus;
      case "collection":
        return collectionFocus;
      case "train":
        return trainFocus;
      case "keep":
        return keepFocus;
      case "end":
        return { group: endEntry?.block ?? 4009, accent: endAccent };
    }
  })();
  useManifoldFocus(activeFocus.group, activeFocus.accent);

  const [fallbackRandomOpen] = useState(() => randomUnexploredGroup([], Math.random(), null));
  const randomOpen = collectionFocus.group ?? fallbackRandomOpen;

  useEffect(() => {
    const read = () => {
      const tops = sections.current.flatMap((element) => (element ? [element.getBoundingClientRect().top + window.scrollY] : []));
      if (tops.length === 0) return;
      const line = readingLine(window.innerHeight, 0);
      const at = sectionAt(tops, window.scrollY, line);
      const next = { beat: HOME_BEATS[at] ?? "entrance", scrolled: window.scrollY > 0 };
      setPlace((previous) => (previous.beat === next.beat && previous.scrolled === next.scrolled ? previous : next));
      setReached((previous) => {
        const furthest = Math.max(previous.furthest, at);
        const scrolled = previous.scrolled || next.scrolled;
        return furthest === previous.furthest && scrolled === previous.scrolled ? previous : { furthest, scrolled };
      });
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  const section = (at: number) => (element: HTMLElement | null) => {
    sections.current[at] = element;
  };

  let problem: string | null = null;
  if (index.status === "failed") problem = fill(WORDS.materialFailed, { message: index.message });
  else if (chosenMaterial.status === "failed") problem = fill(WORDS.materialFailed, { message: chosenMaterial.message });

  const links = (
    <nav className="home-links" aria-label={WORDS.linksName}>
      <Link to={indexPath()}>{HEADER.explore}</Link>
      <Link to="/automata">{HEADER.playground}</Link>
      <Link to="/train">{HEADER.grow}</Link>
      <Link to="/picture">{HEADER.picture}</Link>
      <Link to="/how">{HEADER.how}</Link>
    </nav>
  );

  const openIndexUrl = `${indexPath()}?material=none`;
  const collectionHeading = index.status === "ready"
    ? fill(WORDS.collection.heading, { lit: coverage.withAutomaton.toLocaleString("en-US") })
    : WORDS.collection.headingLoading;

  return (
    <main ref={home} className="home" data-beat={place.beat}>
      {!narrow && (
        <HomePanel
          beat={place.beat}
          still={still}
          entrance={entrance}
          end={endShown}
          endState={endState.status === "ready" ? endState.value : null}
          reset={reset}
          entries={entries}
          indexReady={index.status === "ready"}
          approached={approached}
          onNoReplay={replayFailed}
          onEntranceAccent={onEntranceAccent}
          onPropertiesFocus={onPropertiesFocus}
          onCollectionFocus={onCollectionFocus}
          onTrainFocus={onTrainFocus}
          onKeepFocus={onKeepFocus}
          onEndAccent={onEndAccent}
        />
      )}

      <div className="home-words">
        {/* 0. Entrance: untouched negative space, centered doors, and relay controls. */}
        <section ref={section(0)} className="home-entrance">
          {narrow && (
            <div className="home-narrow-entrance-field">
              {entrance && (
                <HomeMaterial
                  key={reset}
                  entry={entrance.entry}
                  material={place.beat === "entrance" && !still ? entrance.material : null}
                  posterWhileRunning={false}
                  drawRatio={FIELD_DRAW_RATIO}
                  regrowAtTick={Number.POSITIVE_INFINITY}
                  stepsPerSecond={HOME_TICKS_PER_SECOND}
                  carryCells
                  onAccent={onEntranceAccent}
                  onNoReplay={replayFailed}
                />
              )}
            </div>
          )}
          <Link to="/" className="home-title">{SITE_WORDS.frame.wordmark}</Link>
          {links}
          <div className="home-foot">
            {pool.length > 1 && (
              <div className="home-turn" role="group" aria-label={WORDS.turnName}>
                <button type="button" aria-label={WORDS.previousAutomaton} onClick={() => setTurned((count) => count - 1)}>
                  <Chevron direction="left" />
                </button>
                <button
                  type="button"
                  aria-label={WORDS.resetAutomaton}
                  disabled={still !== null || chosenMaterial.status !== "ready"}
                  onClick={() => setReset((count) => count + 1)}
                >
                  <ResetMark />
                </button>
                <button type="button" aria-label={WORDS.nextAutomaton} onClick={() => setTurned((count) => count + 1)}>
                  <Chevron direction="right" />
                </button>
              </div>
            )}
            <button
              type="button"
              className="home-down"
              aria-label={WORDS.nextSection}
              onClick={() => sections.current[1]?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" })}
            >
              <Chevron direction="down" />
            </button>
          </div>
          {problem && <p className="home-note" role="status">{problem}</p>}
        </section>

        {/* 1. Look inside: isolated pattern vs. surrounding scene */}
        <section ref={section(1)} className="home-beat" data-beat="properties">
          <div className="home-beat-words">
            <h2 className="heading">{WORDS.properties.heading}</h2>
            <div className="home-prose">
              <p className="home-sentence">{WORDS.properties.bodyLead}</p>
              <p className="home-sentence">{WORDS.properties.bodyAction}</p>
            </div>
          </div>
          {narrow && (
            <div className="home-inline-stage">
              <HomePropertiesStage
                entries={entries}
                approached={approached.properties}
                active={place.beat === "properties"}
                still={still}
                onNoReplay={replayFailed}
                onFocus={onPropertiesFocus}
              />
            </div>
          )}
        </section>

        {/* 2. The open collection: 2-row tabular ledger + photo door */}
        <section ref={section(2)} className="home-beat" data-beat="collection">
          <div className="home-beat-words">
            <h2 className="heading">{collectionHeading}</h2>
            <dl className="home-ledger">
              <div className="home-ledger-row">
                <dt>
                  <strong>{index.status === "ready" ? coverage.withAutomaton.toLocaleString("en-US") : "—"}</strong>{" "}
                  <span>{WORDS.collection.grownLabel}</span>
                </dt>
                <dd><Link className="link-control" to="/automata">{WORDS.collection.grownLink}</Link></dd>
              </div>
              <div className="home-ledger-row">
                <dt>
                  <strong>{index.status === "ready" ? coverage.withoutAutomaton.toLocaleString("en-US") : "16,384"}</strong>{" "}
                  <span>{WORDS.collection.openLabel}</span>
                </dt>
                <dd><Link className="link-control" to={openIndexUrl}>{WORDS.collection.openLink}</Link></dd>
              </div>
            </dl>
            <div className="home-prose">
              <p className="home-sentence">{WORDS.collection.bodyLead}</p>
              <p className="home-sentence">{WORDS.collection.bodyAction}</p>
            </div>
            <div className="home-doors">
              <ChoosePictureButton className="button primary">{WORDS.collection.pictureDoor}</ChoosePictureButton>
            </div>
          </div>
          {narrow && (
            <div className="home-inline-stage">
              <HomeCollectionStage
                entries={entries}
                indexReady={index.status === "ready"}
                approached={approached.collection}
                active={place.beat === "collection"}
                onFocus={onCollectionFocus}
              />
            </div>
          )}
        </section>

        {/* 3. Make your own: 3 high-contrast steps + recorded training scrubber */}
        <section ref={section(3)} className="home-beat" data-beat="train">
          <div className="home-beat-words">
            <h2 className="heading">{WORDS.train.heading}</h2>
            <ol className="home-steps">
              {WORDS.train.steps.map((step, indexAt) => (
                <li key={step.lead}>
                  <span className="home-step-num" aria-hidden="true">{indexAt + 1}</span>
                  <div className="home-step-body">
                    <span className="home-step-lead">{step.lead}</span>
                    <span className="home-step-detail">{step.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="home-doors">
              <Link className="button primary" to="/train">{WORDS.train.trainDoor}</Link>
              <Link className="button" to={`/train?block=${randomOpen}`} state={DRAWN_AT_RANDOM}>
                {WORDS.train.randomDoor}
              </Link>
            </div>
          </div>
          {narrow && (
            <div className="home-inline-stage">
              <HomeTrainStage
                entries={entries}
                approached={approached.train}
                active={place.beat === "train"}
                still={still}
                onNoReplay={replayFailed}
                onFocus={onTrainFocus}
              />
            </div>
          )}
        </section>

        {/* 4. Take it with you: standalone embed */}
        <section ref={section(4)} className="home-beat" data-beat="keep">
          <div className="home-beat-words">
            <h2 className="heading">{WORDS.keep.heading}</h2>
            <div className="home-prose">
              <p className="home-sentence">{WORDS.keep.bodyLead}</p>
              <p className="home-sentence">{WORDS.keep.bodyAction}</p>
            </div>
            {narrow && (
              <div className="home-inline-stage">
                <HomeKeepStage
                  entries={entries}
                  approached={approached.keep}
                  active={place.beat === "keep"}
                  still={still}
                  onFocus={onKeepFocus}
                />
              </div>
            )}
          </div>
        </section>

        {/* 5. Finale: closing navigation doors paired with the living hibiscus automaton */}
        <section ref={section(5)} className="home-end" data-beat="end">
          {narrow && (
            <div className="home-narrow-entrance-field">
              {endShown && (
                <HomeMaterial
                  entry={endShown.entry}
                  material={!still && endInitialState ? endShown.material : null}
                  initialState={endInitialState}
                  playing={place.beat === "end"}
                  posterUrl={`${AUTOMATON_RECORD_FOLDER}picture-128.png`}
                  drawRatio={FIELD_DRAW_RATIO}
                  regrowAtTick={HOW_REGROW_AT_TICK}
                  stepsPerSecond={HOME_TICKS_PER_SECOND}
                  onAccent={onEndAccent}
                  onNoReplay={replayFailed}
                />
              )}
            </div>
          )}
          <Link to="/" className="home-title">{SITE_WORDS.frame.wordmark}</Link>
          {links}
          <p className="home-end-note">
            {still ? STILL_WORDS[still] : fillNodes(WORDS.end, {
              burn: <a href={BURN_URL} target="_blank" rel="noreferrer">{WORDS.burn}</a>,
            })}
          </p>
        </section>
      </div>
    </main>
  );
}

/** A drawn chevron, 1 px lines, for the arrows that turn the entrance's automaton and scroll down. */
function Chevron({ direction }: { direction: "left" | "right" | "down" }) {
  const points = direction === "left" ? "10,3 5,8 10,13" : direction === "right" ? "6,3 11,8 6,13" : "3,6 8,11 13,6";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
