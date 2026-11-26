// Scene 2 stage: proportional bar of the 16,384-group basis collection over one open basis group
// drawn uniformly at random, placing its four marked-picture response levels first over an
// interactive, gently orbiting 3-D response cloud.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { ManifoldFocus } from "../../ground/manifold-focus";
import { DRAWN_AT_RANDOM } from "../../grow/random-group";
import type { AtlasBand } from "../../library/atlas-cloud";
import { ResetMark } from "../../ui/reset-mark";
import { RotatingCloud3D } from "../../ui/rotating-cloud-3d";
import { useLoaded } from "../../ui/use-loaded";
import type { MaterialEntry } from "../gallery/material-index";
import { STRENGTH_BANDS } from "../look/strength-bands";
import { MarkedPatchPicture } from "./home-properties-stage";
import { collectionCoverage, groupsWithAutomata, randomUnexploredGroup } from "./home-specimens";

const WORDS = SITE_WORDS.home.collection;
const BANDS: readonly AtlasBand[] = [0, 1, 2, 3];
const PICTURES_PER_LEVEL = 2;

export function HomeCollectionStage({ entries, indexReady, approached, active = true, onFocus }: {
  entries: readonly MaterialEntry[];
  indexReady: boolean;
  approached: boolean;
  active?: boolean;
  onFocus?: (focus: ManifoldFocus) => void;
}) {
  const library = useLibrary();
  const [block, setBlock] = useState(() => randomUnexploredGroup([], Math.random(), null));
  const [highlightedBand, setHighlightedBand] = useState<AtlasBand | null>(null);

  useEffect(() => {
    if (!indexReady) return;
    const explored = new Set(groupsWithAutomata(entries));
    if (explored.has(block)) {
      setBlock((current) => randomUnexploredGroup(entries, Math.random(), current));
    }
  }, [indexReady, entries, block]);

  useEffect(() => {
    onFocus?.({ group: block, accent: null });
  }, [onFocus, block]);

  const coverage = collectionCoverage(entries);
  const cloud = useLoaded(approached ? `collection:${block}` : null, () => (approached ? library.atlasCloud(block) : null));
  const cloudSummary = cloud.status === "ready" ? fill(WORDS.cloudSummary, { patches: cloud.value.nativePoints.length.toLocaleString("en-US") }) : "";

  const drawAnother = () => {
    setHighlightedBand(null);
    setBlock((current) => randomUnexploredGroup(entries, Math.random(), current));
  };

  return (
    <div className="home-stage-frame home-collection">
      <div className="home-coverage-head">
        <div className="home-coverage-meta">
          <span className="label">
            {fill(WORDS.barLabel, {
              lit: coverage.withAutomaton.toLocaleString("en-US"),
              total: coverage.total.toLocaleString("en-US"),
            })}
          </span>
          <span className="label">{`${(coverage.fraction * 100).toFixed(2)}%`}</span>
        </div>
        <div
          className="home-coverage-bar"
          role="img"
          aria-label={fill(WORDS.barLabel, {
            lit: coverage.withAutomaton.toLocaleString("en-US"),
            total: coverage.total.toLocaleString("en-US"),
          })}
        >
          <span
            className="home-coverage-fill"
            style={{ width: indexReady ? `max(3px, ${(coverage.fraction * 100).toFixed(3)}%)` : "3px" }}
          />
        </div>
      </div>

      <article className="home-specimen" aria-label={fill(WORDS.specimenHeading, { block })}>
        <header className="home-specimen-header">
          <div className="home-specimen-identity">
            <h3 className="heading">{fill(WORDS.specimenHeading, { block })}</h3>
            <span className="label">{WORDS.specimenStatus}</span>
          </div>
          <button type="button" className="button" onClick={drawAnother}>
            <ResetMark />
            <span>{WORDS.drawAnother}</span>
          </button>
        </header>

        {cloud.status === "failed" ? (
          <p className="muted">{fill(WORDS.cloudFailed, { block })}</p>
        ) : cloud.status === "ready" ? (
          <>
            <div className="home-specimen-levels" onMouseLeave={() => setHighlightedBand(null)}>
              {BANDS.map((band) => {
                const bandPictures = cloud.value.pictures
                  .filter((picture) => picture.band === band)
                  .slice(0, PICTURES_PER_LEVEL);
                const empty = Math.max(0, PICTURES_PER_LEVEL - bandPictures.length);
                return (
                  <div
                    key={band}
                    className="home-specimen-level"
                    data-band={STRENGTH_BANDS[band]}
                    onMouseEnter={() => setHighlightedBand(band)}
                  >
                    <div className="home-specimen-level-pictures">
                      {bandPictures.map((picture) => (
                        <MarkedPatchPicture
                          key={`${picture.imageId}-${picture.slot}`}
                          picture={picture}
                          block={block}
                        />
                      ))}
                      {Array.from({ length: empty }, (_, index) => (
                        <span key={`empty-${index}`} className="home-patch-picture" aria-hidden="true" />
                      ))}
                    </div>
                    <span className="home-specimen-level-name">{WORDS.levelLabels[band]}</span>
                    <span className="label">{cloud.value.counts[band].toLocaleString("en-US")}</span>
                  </div>
                );
              })}
            </div>
            <div className="home-specimen-cloud">
              <RotatingCloud3D
                cloud={cloud.value}
                highlight={highlightedBand}
                active={active && approached}
                height={208}
                ariaLabel={cloudSummary}
              />
              <span className="home-specimen-cloud-note">{cloudSummary}</span>
            </div>
          </>
        ) : (
          <div className="home-specimen-skeleton" aria-busy="true" />
        )}

        <footer className="home-specimen-actions">
          <Link className="button" to={`/train?block=${block}`} state={DRAWN_AT_RANDOM}>
            {fill(WORDS.trainGroup, { block })}
          </Link>
          <Link className="link-control" to={`/index/basis/${block}`}>
            {WORDS.openInIndex}
          </Link>
        </footer>
      </article>
    </div>
  );
}
