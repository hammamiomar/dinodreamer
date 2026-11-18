// The live map on the Train page: what the map draws (live-map.tsx), gathered from the run. The group's
// public sample cloud and its summary come from the library; the target from the run's method and its
// reference patch, or the set the worker prepared; the canvas's patches from the run's latest reading
// (train-run.ts map).

import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../app/library-session";
import { SITE_WORDS, fill } from "../app/site-words";
import { sampleStrengthCuts } from "../features/look/strength-bands";
import type { LookCloud } from "../library/look-cloud";
import { methodReadsTokens, type FigureMethod } from "../materials/material-file";
import type { Code } from "../recipe";
import { LiveMap } from "./live-map";
import { mapTarget } from "./live-map-points";
import { readingRegion, type MaterialKind } from "./material-kind";
import { comparisonOf } from "./train-method";
import { useTrainMap, useTrainSet } from "./train-run";

const WORDS = SITE_WORDS.grow.map;

/** The group's public sample cloud and summary, or null while they load or when they cannot be read. */
function useLookCloud(block: number): LookCloud | null {
  const library = useLibrary();
  const [loaded, setLoaded] = useState<{ block: number; cloud: LookCloud } | null>(null);
  useEffect(() => {
    let current = true;
    void library.lookCloud(block).then(
      (cloud) => { if (current) setLoaded({ block, cloud }); },
      // Without the cloud there is no map; the run goes on.
      () => {},
    );
    return () => { current = false; };
  }, [library, block]);
  return loaded?.block === block ? loaded.cloud : null;
}

export function TrainMap({ block, method, anchorCode, kind, live }: {
  block: number;
  method: FigureMethod;
  /** The reference patch's code: basis-group mean matching's target. */
  anchorCode: Code;
  kind: MaterialKind;
  /** Whether the site's run is this page's: only then are its readings drawn. */
  live: boolean;
}) {
  const cloud = useLookCloud(block);
  const reading = useTrainMap();
  const set = useTrainSet();
  const rows = useMemo(() => cloud && {
    codes: Float32Array.from(cloud.fixture.points.flatMap((point) => point.code)),
    norms: Float32Array.from(cloud.fixture.points.map((point) => point.norm)),
    count: cloud.fixture.points.length,
  }, [cloud]);
  const strength = useMemo(() => cloud && rows && sampleStrengthCuts(cloud.summary.gateMedian, rows.norms), [cloud, rows]);
  const setCodes = live ? set?.codes ?? null : null;
  const target = useMemo(() => mapTarget(method, anchorCode, setCodes), [method, anchorCode, setCodes]);
  if (!cloud || !rows || !strength) return null;
  return <section className="grow-map">
    <h2 className="label">{WORDS.heading}</h2>
    <LiveMap cloud={rows} strength={strength} target={target} comparison={comparisonOf(method)} shadow={methodReadsTokens(method)}
      patchCodes={live ? reading?.patchCodes ?? null : null} region={readingRegion(kind)} medianNorm={cloud.summary.medianNorm}
      label={fill(WORDS.label, { block })} />
  </section>;
}
