// Scene 2 stage: proportional bar of the 16,384-group basis collection over one unexplored basis
// group drawn uniformly at random, showing its three-coordinate patch cloud and four response levels.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import { DRAWN_AT_RANDOM } from "../../grow/random-group";
import type { AtlasBand, AtlasCloud } from "../../library/atlas-cloud";
import { ResetMark } from "../../ui/reset-mark";
import { useLoaded } from "../../ui/use-loaded";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import type { MaterialEntry } from "../gallery/material-index";
import { STRENGTH_BANDS } from "../look/strength-bands";
import { MarkedPatchPicture } from "./home-properties-stage";
import { collectionCoverage, groupsWithAutomata, randomUnexploredGroup } from "./home-specimens";

const WORDS = SITE_WORDS.home.collection;
const CLOUD_BOX = { width: 560, height: 192, margin: 16 } as const;
const BANDS: readonly AtlasBand[] = [0, 1, 2, 3];
const PICTURES_PER_LEVEL = 2;

/** Compact SVG projection of a basis group's sampled library patches in its 3-coordinate space. */
function SpecimenCloudSvg({ cloud, highlightedBand }: {
  cloud: AtlasCloud;
  highlightedBand: AtlasBand | null;
}) {
  const { width, height, margin } = CLOUD_BOX;
  const xMin = Math.min(-cloud.ring, ...cloud.points.map((point) => point.x));
  const xMax = Math.max(cloud.ring, ...cloud.points.map((point) => point.x));
  const yExtent = Math.max(cloud.ring, ...cloud.points.map((point) => Math.abs(point.y)), 0.001);
  const xSpan = Math.max(xMax - xMin, 0.001);
  const scale = Math.min((width - 2 * margin) / xSpan, (height - 2 * margin) / (2 * yExtent));
  const originX = (width - xSpan * scale) / 2 - xMin * scale;
  const originY = height / 2;
  const toX = (value: number) => (originX + value * scale).toFixed(1);
  const toY = (value: number) => (originY - value * scale).toFixed(1);

  return (
    <div className="home-specimen-cloud" data-highlighted={highlightedBand !== null ? String(highlightedBand) : undefined}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={fill(WORDS.cloudSummary, { patches: cloud.wins.toLocaleString("en-US") })}
      >
        <line className="home-specimen-axis" x1={0} x2={width} y1={originY} y2={originY} />
        <circle className="home-specimen-ring" cx={toX(0)} cy={toY(0)} r={(cloud.ring * scale).toFixed(1)} />
        {BANDS.map((band) => {
          const d = cloud.points
            .filter((point) => point.band === band)
            .map((point) => `M${toX(point.x)} ${toY(point.y)}h0`)
            .join("");
          return (
            <path
              key={band}
              className="home-specimen-points"
              data-band={STRENGTH_BANDS[band]}
              data-dimmed={highlightedBand !== null && highlightedBand !== band ? "" : undefined}
              d={d}
            />
          );
        })}
      </svg>
      <span className="home-specimen-cloud-note">
        {fill(WORDS.cloudSummary, { patches: cloud.wins.toLocaleString("en-US") })}
      </span>
    </div>
  );
}

export function HomeCollectionStage({ entries, indexReady, names, approached }: {
  entries: readonly MaterialEntry[];
  indexReady: boolean;
  names: BasisGroupNames;
  approached: boolean;
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

  const coverage = collectionCoverage(entries);
  const cloud = useLoaded(approached ? `collection:${block}` : null, () => (approached ? library.atlasCloud(block) : null));
  const groupName = nameOf(names, block);

  const drawAnother = () => {
    setHighlightedBand(null);
    setBlock((current) => randomUnexploredGroup(entries, Math.random(), current));
  };

  return (
    <div className="home-stage-frame home-collection">
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

      <article className="home-specimen" aria-label={fill(WORDS.specimenHeading, { block })}>
        <header className="home-specimen-header">
          <div className="home-specimen-identity">
            <h3 className="heading">{fill(WORDS.specimenHeading, { block })}</h3>
            <span className="label">
              {groupName ? `${groupName} · ${WORDS.specimenStatus}` : WORDS.specimenStatus}
            </span>
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
            <SpecimenCloudSvg cloud={cloud.value} highlightedBand={highlightedBand} />
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
                    <span className="home-specimen-level-name">{fill(WORDS.levelLabel, { level: band + 1 })}</span>
                    <span className="label">{cloud.value.counts[band].toLocaleString("en-US")}</span>
                  </div>
                );
              })}
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
