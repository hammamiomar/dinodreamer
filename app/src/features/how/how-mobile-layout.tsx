import type { ReactNode } from "react";
import "./how-mobile-layout.css";

/** Mobile content belongs to the document; neither region owns a vertical scroll. */
export function HowMobileLayout({ stage, card }: {
  stage: ReactNode;
  card: ReactNode;
}) {
  return (
    <div className="how-mobile-layout">
      {stage}
      {card}
    </div>
  );
}
