// Line icons for the material stage, drawn on a 20-unit grid with the current text colour.
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const PlayIcon = () => <Icon><path d="M6 4.5v11l9-5.5z" fill="currentColor" stroke="none" /></Icon>;
export const PauseIcon = () => <Icon><path d="M7 4.5v11M13 4.5v11" strokeWidth="2" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16h12" /></Icon>;
export const OptionsIcon = () => <Icon><circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" /></Icon>;
