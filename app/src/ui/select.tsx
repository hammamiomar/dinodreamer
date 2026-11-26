// A select in the language (styles.css, "A select is drawn"): the browser's own select, so the
// keyboard, a phone's picker and assistive technology work as everywhere, with no arrow, in a box
// whose ::after draws the square mark. Props go to the select itself.

import type { ReactNode, SelectHTMLAttributes } from "react";

export function Select({ leading, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { leading?: ReactNode }) {
  return (
    <span className="select" data-leading={leading ? "" : undefined}>
      {leading && <span className="select-leading" aria-hidden="true">{leading}</span>}
      <select {...props} />
    </span>
  );
}
