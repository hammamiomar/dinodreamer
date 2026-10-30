import "./reset-mark.css";

/** The mark on a button that grows an automaton again: a circular arrow. */
export function ResetMark() {
  return (
    <svg className="reset-mark" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
      <path d="M12.5 8 A4.5 4.5 0 1 1 10.4 4.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <polyline points="8.6,2.6 11,4.4 8.9,6.6" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
