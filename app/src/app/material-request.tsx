import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MaterialRequest } from "../recipe";

export interface MaterialRequestPicture {
  name: string;
  preview: Blob;
  /** True when the reference patch is the lift from the picture's patch: the nearest Level 4 library patch in its direction. Train says so. */
  lift?: boolean;
}

/**
 * Who chose a request's points: the visitor, on a group's page or their picture's page; or Train, which
 * builds its own request for /train?block=N (the group's strongest level) and for a continuation. Train's
 * set methods take a visitor's selection as their set, and with none the group's strongest pictures.
 */
export type MaterialRequestOrigin = "visitor" | "train";

interface MaterialRequestState {
  request: MaterialRequest | null;
  picture: MaterialRequestPicture | null;
  origin: MaterialRequestOrigin;
  setRequest: (request: MaterialRequest | null, picture?: MaterialRequestPicture | null, origin?: MaterialRequestOrigin) => void;
}
const MaterialRequestContext = createContext<MaterialRequestState | null>(null);

/** The pending Look request survives route changes. JSON is the explicit save for now. */
export function MaterialRequestProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pick<MaterialRequestState, "request" | "picture" | "origin">>({ request: null, picture: null, origin: "visitor" });
  const setRequest = useCallback((request: MaterialRequest | null, picture: MaterialRequestPicture | null = null, origin: MaterialRequestOrigin = "visitor") => {
    // Keep the preview with its request when the user later changes or removes the upload.
    setPending({ request, picture: request ? picture : null, origin });
  }, []);
  const value = useMemo(() => ({ ...pending, setRequest }), [pending, setRequest]);
  return <MaterialRequestContext.Provider value={value}>{children}</MaterialRequestContext.Provider>;
}

export function useMaterialRequest(): MaterialRequestState {
  const state = useContext(MaterialRequestContext);
  if (!state) throw new Error("useMaterialRequest needs MaterialRequestProvider.");
  return state;
}
