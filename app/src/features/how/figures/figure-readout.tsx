import type { ReactNode } from "react";

interface Measurement {
  value: ReactNode;
  label: string;
  /** Other values this row can show, to keep its column stable during interaction. */
  reserve?: readonly ReactNode[];
  marker?: ReactNode;
}

/** Figure readings use aligned values followed by their labels. */
export function FigureReadout({ rows }: { rows: readonly Measurement[] }) {
  return (
    <ul className="how-readout" data-markers={rows.some((row) => row.marker) || undefined} role="list">
      {rows.map(({ value, label, reserve = [], marker }) => (
        <li key={label}>
          {marker}
          <span className="how-readout-value">
            {reserve.map((alternative, index) => (
              <span key={index} className="how-readout-reserve" aria-hidden="true">{alternative}</span>
            ))}
            <span>{value}</span>
          </span>
          <span className="how-readout-label">{label}</span>
        </li>
      ))}
    </ul>
  );
}
