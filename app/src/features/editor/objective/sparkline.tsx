// A term's recent history as one line, stretched to its container.

import type { TermSeries } from "../run/session";

export function Sparkline({ series, colour, width, height }: { series?: TermSeries; colour: string; width: number; height: number }) {
  const values = series?.values ?? [];
  if (values.length < 2) return <svg className="sparkline" width={width} height={height} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 1 - ((value - min) / (max - min || 1)) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    // The line is stretched to its container's width; its stroke keeps its width.
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline">
      <polyline points={points.join(" ")} fill="none" stroke={colour} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
