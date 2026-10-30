import "./loading-indicator.css";

/** Three patch-sized marks share the site's square grid and monochrome palette. */
export function LoadingIndicator({ children }: { children: string }) {
  return <span className="loading-indicator" role="status">
    <span className="loading-marks" aria-hidden="true"><i /><i /><i /></span>
    <span>{children}</span>
  </span>;
}
