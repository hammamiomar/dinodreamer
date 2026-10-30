// The Create screen's route element: the editor (features/editor/create-page.tsx,
// loaded only when a visitor opens Create) with the block panel's outlet beside
// it. A request card's block number opens the panel over Create at
// /create/basis/:id; the editor behind is inert while it is open.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Outlet, useMatch } from "react-router";

export function CreateScreen({ children }: { children: ReactNode }) {
  const panelOpen = useMatch("/create/basis/:id") !== null;
  const page = useRef<HTMLDivElement>(null);
  // Behind an open panel the editor is inert: no focus, no clicks, no reading order.
  useEffect(() => {
    page.current?.toggleAttribute("inert", panelOpen);
  }, [panelOpen]);
  return (
    <>
      <div ref={page} style={{ display: "contents" }} aria-hidden={panelOpen || undefined}>
        {children}
      </div>
      <Outlet />
    </>
  );
}
