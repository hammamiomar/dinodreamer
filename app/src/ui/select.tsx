// A select in the language (styles.css, "A select is drawn"): the browser's own select, so the
// keyboard, a phone's picker and assistive technology work as everywhere, with no arrow, in a box
// whose ::after draws the square mark. Props go to the select itself.

import type { SelectHTMLAttributes } from "react";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...props} />
    </span>
  );
}
