// A block's cloud as its Atlas record draws it large (the home's cloud station, How's #cloud): the
// main lobe's axis, the ring, the record's points (at most 512) coloured by band, and one lit
// point at its exact place in the record's plane with a lead down to its label under the figure.
// The figure draws in a fixed space of CLOUD_VIEW; the SVG scales to its box.

import type { ReactNode } from "react";
import type { AtlasCloud } from "../library/atlas-cloud";
import { STRENGTH_BANDS } from "../features/look/strength-bands";
import "./atlas-cloud-figure.css";

/** The figure's drawing space. */
export const CLOUD_VIEW = { width: 576, height: 448, margin: 48 } as const;

/** Where the cloud figure draws a code: x and y in figure pixels, y up the page. */
export interface CloudFit {
  scale: number;
  x(value: number): number;
  y(value: number): number;
}

/**
 * The scale and origin that fit the block's drawn points, its ring and the lit point into a figure of
 * width × height with `margin` on every side; one scale for both axes, so the cloud keeps its shape.
 */
export function fitCloud(cloud: Pick<AtlasCloud, "points" | "ring">, lit: readonly [number, number], width: number, height: number, margin: number, landed: ReadonlyArray<readonly [number, number]> = []): CloudFit {
  const xs = [...cloud.points.map((point) => point.x), -cloud.ring, cloud.ring, lit[0], ...landed.map((point) => point[0])];
  const ys = [...cloud.points.map((point) => point.y), -cloud.ring, cloud.ring, lit[1], ...landed.map((point) => point[1])];
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [bottom, top] = [Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - 2 * margin) / (right - left), (height - 2 * margin) / (top - bottom));
  const originX = (width - (right - left) * scale) / 2 - left * scale;
  const originY = (height + (top + bottom) * scale) / 2;
  return { scale, x: (value) => originX + value * scale, y: (value) => originY - value * scale };
}

/** Another picture's patches landed in the record's plane: every patch, their mean, and the one the reader is on. */
export interface LandedPoints {
  points: ReadonlyArray<readonly [number, number]>;
  mean: readonly [number, number];
  marked: number | null;
}

export function AtlasCloudFigure({ cloud, lit, label, landed = null, meanLabel, distanceLabel }: {
  cloud: Pick<AtlasCloud, "points" | "ring">;
  /** The lit point in the record's plane: (c · a1, c · a2). */
  lit: readonly [number, number];
  /** Under the figure, at the lead's foot. */
  label: ReactNode;
  /** Points landed by another picture, with a line from their mean to the lit point: the distance between them. */
  landed?: LandedPoints | null;
  /** Over the landed mean. */
  meanLabel?: string;
  /** Labels the mean-to-target line, with its full description for assistive technology. */
  distanceLabel?: { text: string; description: string };
}) {
  const { width, height, margin } = CLOUD_VIEW;
  const fit = fitCloud(cloud, lit, width, height, margin, landed ? landed.points : []);
  const [litX, litY] = [fit.x(lit[0]), fit.y(lit[1])];
  const distanceMidpoint = landed ? {
    x: (fit.x(landed.mean[0]) + litX) / 2,
    y: (fit.y(landed.mean[1]) + litY) / 2,
  } : null;
  const distanceLabelY = margin / 2;
  return (
    <div className="cloud-figure">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role={distanceLabel ? "img" : undefined}
        aria-label={distanceLabel?.description}
        aria-hidden={distanceLabel ? undefined : true}
      >
        <line className="cloud-figure-axis" x1={0} x2={width} y1={fit.y(0)} y2={fit.y(0)} />
        <circle className="cloud-figure-ring" cx={fit.x(0)} cy={fit.y(0)} r={cloud.ring * fit.scale} />
        {STRENGTH_BANDS.map((band, index) => (
          <g key={band} className="cloud-figure-band" data-band={band}>
            {cloud.points.filter((point) => point.band === index).map((point, at) => (
              <circle key={at} cx={fit.x(point.x).toFixed(1)} cy={fit.y(point.y).toFixed(1)} r={2.2} />
            ))}
          </g>
        ))}
        {landed && (
          <g className="cloud-figure-landed">
            {landed.points.map((point, at) => (
              <circle key={at} cx={fit.x(point[0]).toFixed(1)} cy={fit.y(point[1]).toFixed(1)} r={at === landed.marked ? 4 : 1.6} data-marked={at === landed.marked || undefined} />
            ))}
            <line className="cloud-figure-distance" x1={fit.x(landed.mean[0])} y1={fit.y(landed.mean[1])} x2={litX} y2={litY} />
            {distanceLabel && distanceMidpoint && (
              <line
                className="cloud-figure-distance-lead"
                x1={distanceMidpoint.x}
                y1={distanceMidpoint.y}
                x2={distanceMidpoint.x}
                y2={distanceLabelY}
              />
            )}
            <circle className="cloud-figure-mean" cx={fit.x(landed.mean[0])} cy={fit.y(landed.mean[1])} r={4.5} />
            {meanLabel && <text className="cloud-figure-mean-label" x={fit.x(landed.mean[0])} y={fit.y(landed.mean[1]) - 10} textAnchor="middle">{meanLabel}</text>}
          </g>
        )}
        {/* The lead runs down from the dot to the figure's edge, where the label hangs under the figure. */}
        <g className="cloud-figure-lit">
          <circle className="cloud-figure-lit-ring" cx={litX} cy={litY} r={10} />
          <circle className="cloud-figure-lit-dot" cx={litX} cy={litY} r={4} />
          <line className="cloud-figure-lead" x1={litX} x2={litX} y1={litY + 12} y2={height} />
        </g>
      </svg>
      {distanceMidpoint && distanceLabel && (
        <div className="cloud-figure-distance-plane" aria-hidden="true" style={{ aspectRatio: `${width} / ${height}` }}>
          <span
            className="cloud-figure-distance-label"
            style={{
              left: `${(distanceMidpoint.x / width) * 100}%`,
              top: `${(distanceLabelY / height) * 100}%`,
            }}
          >
            {distanceLabel.text}
          </span>
        </div>
      )}
      <div className="cloud-figure-label" data-side={litX > width / 2 ? "left" : "right"} style={{ left: `${(litX / width) * 100}%` }}>
        {label}
      </div>
    </div>
  );
}
