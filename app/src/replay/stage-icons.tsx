// Line icons for the material stage, drawn on a 20-unit grid with the current text colour.
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const PlayIcon = () => <Icon><path d="M6 4.5v11l9-5.5z" fill="currentColor" stroke="none" /></Icon>;
export const PauseIcon = () => <Icon><path d="M7 4.5v11M13 4.5v11" strokeWidth="2" /></Icon>;
