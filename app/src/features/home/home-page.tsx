// The home: an entrance and a high-level view. On entrance, the site's name, the
// four links and the automaton, alive, nothing else. The page scrolls natively; as each section's
// words reach the middle, the panel at the right changes and its figure plays: the three
// steps, the model, the basis collection and the automaton, a few sentences each at the left; then
// the end, with the automaton running again. One specimen throughout: the hibiscus thread the How
// page records (features/how/). The header is out of view on the entrance and slides in after it
// (app/frame.tsx). The rules of the scroll are home-scroll.ts, the panel home-panel.tsx; every
// word is in app/site-words.ts.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { fill, fillNodes, SITE_WORDS } from "../../app/site-words";
import { useMediaMatch } from "../../ui/media-match";
import { useLoaded } from "../../ui/use-loaded";
import { explorePath } from "../atlas/atlas-position";
import { useMaterialIndex, usePublishedMaterial } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { featuredMaterials } from "../playground/playground";
import { HOW_AUTOMATON, loadHowStory } from "../how/figures/figure-data";
import { loadAutomatonState } from "../how/automaton-record";
import { HOW_PICTURE } from "../how/how-source";
import { usePrefersReducedMotion } from "../landing/motion";
import type { HomeStill } from "./home-material-view";
import { HomePanel, type Shown } from "./home-panel";
import { approachedBeats, BEAT_PLAY_MS, HOME_BEATS, NARROW_PANEL_SHARE, readingLine, sectionAt, type HomeBeat } from "./home-scroll";
import { ResetMark } from "../../ui/reset-mark";
import "./home.css";

const WORDS = SITE_WORDS.home;
/** The engine's framework, named in the end sentence. */
const BURN_URL = "https://burn.dev";
const HEADER = SITE_WORDS.header;
/** The sentence at the end when the automaton is a still, by the reason. */
const STILL_WORDS: Record<Exclude<HomeStill, null>, string> = {
  "no-webgpu": WORDS.noWebGpu,
  "reduced-motion": WORDS.reducedMotion,
};
/** The three beats' words, in the page's order. */
const BEATS = [
  ["model", WORDS.beats.model],
  ["basis", WORDS.beats.basis],
  ["automaton", WORDS.beats.automaton],
] as const;
/** Under 1024 px the panel sits over the words at the top of the window; the pages land under it (home.css). */
const NARROW = "(max-width: 1023px)";
/** A progress that moved less than this is the same: the panel is not re-rendered for it. */
const PROGRESS_STEP = 0.004;

/** A beat's figure plays from 0 to 1 once the beat has arrived (BEAT_PLAY_MS); with reduced motion it shows its end at once. */
function useBeatPlay(beat: HomeBeat, reducedMotion: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const length = BEAT_PLAY_MS[beat];
    if (length === 0 || reducedMotion) {
      setProgress(1);
      return;
    }
    setProgress(0);
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / length);
      setProgress((previous) => (t < 1 && Math.abs(previous - t) < PROGRESS_STEP ? previous : t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [beat, reducedMotion]);
  return progress;
}

export function HomePage() {
  const home = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const update = () => {
      // Safari can paint the page under floating controls outside its reported viewport.
      // On a full-width touch screen, extend only the entrance background to the screen's extent.
      const fullWidthTouch = window.matchMedia("(pointer: coarse)").matches && Math.abs(screen.width - window.innerWidth) < 2;
      home.current?.style.setProperty("--home-background-height", fullWidthTouch ? `${screen.height}px` : "100lvh");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const library = useLibrary();
  const index = useMaterialIndex();
  const reducedMotion = usePrefersReducedMotion();
  // A browser that offers WebGPU may still have no adapter: the replay then fails before its first frame.
  const [noReplay, setNoReplay] = useState(false);
  const replayFailed = useCallback(() => setNoReplay(true), []);
  const still: HomeStill = !("gpu" in navigator) || noReplay ? "no-webgpu" : reducedMotion ? "reduced-motion" : null;
  // The thread's automaton, basis group 4009's, which the beats tell and the end runs.
  const threadEntry = index.status === "ready" ? index.index.entries.find((candidate) => candidate.id === HOW_AUTOMATON) ?? null : null;
  // The furthest section the reader has reached, and whether the page has scrolled at all. The end's
  // automaton, its recorded grids and the training strip load only as the reader approaches their
  // sections (home-scroll.ts, approachedBeats): about 1 MB that a visitor who stays on the entrance never needs.
  const [reached, setReached] = useState({ furthest: 0, scrolled: false });
  const approached = approachedBeats(reached.furthest, reached.scrolled);
  const threadMaterial = usePublishedMaterial(still || !approached.end ? null : threadEntry);
  const endLoads = still === null && approached.end;
  const recordedState = useLoaded(endLoads, () => (endLoads ? loadAutomatonState() : null));
  // The entrance's automaton: one of the featured pool that met its selection target, drawn per visit,
  // the arrows turning to the next or the previous.
  const pool = useMemo(() => (index.status === "ready" ? featuredMaterials(index.index.entries).filter((candidate) => candidate.fired) : []), [index]);
  const [drawn] = useState(() => Math.random());
  const [turned, setTurned] = useState(0);
  const [reset, setReset] = useState(0);
  const shownEntry: MaterialEntry | null = pool.length > 0 ? pool[(((Math.floor(drawn * pool.length) + turned) % pool.length) + pool.length) % pool.length]! : null;
  const shownMaterial = usePublishedMaterial(still ? null : shownEntry);
  const story = useLoaded("story", loadHowStory);
  const cloud = useLoaded("cloud", () => library.atlasCloud(HOW_PICTURE.block));
  const narrow = useMediaMatch(NARROW);

  // The sections in order, measured on every scroll and resize: the beat follows the reading line.
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [place, setPlace] = useState<{ beat: HomeBeat; scrolled: boolean }>({ beat: "entrance", scrolled: false });
  useEffect(() => {
    const read = () => {
      const tops = sections.current.flatMap((element) => (element ? [element.getBoundingClientRect().top + window.scrollY] : []));
      if (tops.length === 0) return;
      const line = readingLine(window.innerHeight, narrow ? NARROW_PANEL_SHARE : 0);
      const at = sectionAt(tops, window.scrollY, line);
      const next = { beat: HOME_BEATS[at] ?? "entrance", scrolled: window.scrollY > 0 };
      setPlace((previous) => (previous.beat === next.beat && previous.scrolled === next.scrolled ? previous : next));
      // Reached sections stay reached, so a figure that has loaded is not dropped on the way back up.
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
  }, [narrow]);
  const progress = useBeatPlay(place.beat, reducedMotion);
  const section = (at: number) => (element: HTMLElement | null) => {
    sections.current[at] = element;
  };

  const failedLoad = [index, shownMaterial, threadMaterial, recordedState].find((loaded) => loaded.status === "failed");
  let problem: string | null = null;
  if (failedLoad) problem = fill(WORDS.materialFailed, { message: failedLoad.message });
  else if (index.status === "ready" && (!threadEntry || !shownEntry)) {
    problem = fill(WORDS.materialFailed, { message: HOW_AUTOMATON });
  }
  const shown = (entry: MaterialEntry | null, loaded: typeof shownMaterial): Shown | null => (entry ? { entry, material: loaded.status === "ready" ? loaded.value : null } : null);
  const links = (
    <nav className="home-links" aria-label={WORDS.linksName}>
      <Link to={explorePath()}>{HEADER.explore}</Link>
      <Link to="/automata">{HEADER.playground}</Link>
      <Link to="/train">{HEADER.grow}</Link>
      <Link to="/how">{HEADER.how}</Link>
    </nav>
  );
  return (
    <main ref={home} className="home" data-beat={place.beat}>
      <HomePanel
        beat={place.beat}
        progress={progress}
        prefetch={place.scrolled}
        still={still}
        entrance={shown(shownEntry, shownMaterial)}
        thread={shown(threadEntry, threadMaterial)}
        recordedState={recordedState.status === "ready" ? recordedState.value : null}
        reset={reset}
        story={story.status === "ready" ? story.value : null}
        cloud={cloud.status === "ready" ? cloud.value : null}
        onNoReplay={replayFailed}
        approached={approached}
      />
      <div className="home-words">
        <section ref={section(0)} className="home-entrance">
          <Link to="/" className="home-title">{SITE_WORDS.frame.wordmark}</Link>
          {links}
          <div className="home-foot">
            {pool.length > 1 && (
              <div className="home-turn" role="group" aria-label={WORDS.turnName}>
                <button type="button" aria-label={WORDS.previousAutomaton} onClick={() => setTurned((count) => count - 1)}><Chevron direction="left" /></button>
                <button type="button" aria-label={WORDS.resetAutomaton} disabled={still !== null || shownMaterial.status !== "ready"} onClick={() => setReset((count) => count + 1)}><ResetMark /></button>
                <button type="button" aria-label={WORDS.nextAutomaton} onClick={() => setTurned((count) => count + 1)}><Chevron direction="right" /></button>
              </div>
            )}
            {/* The hint that the page goes on: a chevron down, which scrolls to the first beat (its scroll margin clears the narrow panel, home.css). */}
            <button type="button" className="home-down" aria-label={WORDS.nextSection} onClick={() => sections.current[1]?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" })}><Chevron direction="down" /></button>
          </div>
          {problem && <p className="home-note" role="status">{problem}</p>}
        </section>
        {BEATS.map(([beat, words], at) => (
          <section key={beat} ref={section(at + 1)} className="home-beat" data-beat={beat}>
            <div className="home-beat-words">
              <p className="label">{words.label}</p>
              <h2 className="heading">{words.heading}</h2>
              {words.sentences.map((sentence) => <p key={sentence} className="home-sentence">{sentence}</p>)}
            </div>
          </section>
        ))}
        <section ref={section(HOME_BEATS.length - 1)} className="home-end">
          <div className="home-beat-words">
            <p className="home-sentence">{still ? STILL_WORDS[still] : fillNodes(WORDS.end, {
              burn: <a href={BURN_URL} target="_blank" rel="noreferrer">{WORDS.burn}</a>,
            })}</p>
            {links}
          </div>
        </section>
      </div>
    </main>
  );
}

/** A drawn chevron, 1 px lines, for the arrows that turn the entrance's automaton. */
function Chevron({ direction }: { direction: "left" | "right" | "down" }) {
  const points = direction === "left" ? "10,3 5,8 10,13" : direction === "right" ? "6,3 11,8 6,13" : "3,6 8,11 13,6";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
