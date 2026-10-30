// "?": the one affordance for an explanation on the instrument. A small button sits
// after the thing it explains; the explanation opens in place, where the caller puts
// it, closed by default. The screen carries the numbers; the explanation carries the
// mechanism. No tooltips.

import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface Explanation {
  open: boolean;
  toggle: () => void;
  /** The id of the opened text, for aria-controls. */
  id: string;
}

/** One explanation's open state; it lasts while the component stays mounted. */
export function useExplanation(): Explanation {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, toggle: () => setOpen((was) => !was), id };
}

/** The "?" after a head or a line; `subject` names what it explains, for assistive technology ("Explain the examples"). */
export function ExplainButton({ explanation, subject }: { explanation: Explanation; subject: string }) {
  return (
    <button
      type="button"
      className="explain"
      aria-expanded={explanation.open}
      aria-controls={explanation.id}
      aria-label={`Explain ${subject}`}
      onClick={explanation.toggle}
    >
      ?
    </button>
  );
}

/** The explanation's text, shown while it is open. */
export function ExplanationText({ explanation, children }: { explanation: Explanation; children: ReactNode }) {
  if (!explanation.open) return null;
  return (
    <div id={explanation.id} className="explanation">
      {children}
    </div>
  );
}

/**
 * The explanation's text, eased open and shut in place (styles.css .explanation-reveal). It
 * stays mounted, so the "?" always controls an element; shut, it has no height, and once it
 * has collapsed it is hidden from view and from assistive technology. `style` places it,
 * for example in a stack.
 */
export function ExplanationReveal({ explanation, style, children }: { explanation: Explanation; style?: CSSProperties; children: ReactNode }) {
  return (
    <div id={explanation.id} className="explanation-reveal" data-open={explanation.open || undefined} style={style}>
      <div className="explanation">{children}</div>
    </div>
  );
}
