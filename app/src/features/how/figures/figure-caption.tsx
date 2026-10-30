import type { ReactNode } from "react";

/** Reserve the same caption area for every pane and for every reading it can display. */
export function FigureCaption({ children, reserve, as: Element = "figcaption" }: {
  children: ReactNode;
  reserve: readonly ReactNode[];
  /** A numerical readout can sit between controls and the figure's final caption. */
  as?: "figcaption" | "div";
}) {
  return (
    <Element className="how-caption how-caption-area">
      {reserve.map((content, index) => (
        <div key={index} className="how-caption-reserve" aria-hidden="true">{content}</div>
      ))}
      <div>{children}</div>
    </Element>
  );
}
