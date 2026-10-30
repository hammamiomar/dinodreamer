import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MaterialRequest } from "../recipe";

export interface MaterialRequestPicture {
  name: string;
  preview: Blob;
}

interface MaterialRequestState {
  request: MaterialRequest | null;
  picture: MaterialRequestPicture | null;
  setRequest: (request: MaterialRequest | null, picture?: MaterialRequestPicture | null) => void;
}
const MaterialRequestContext = createContext<MaterialRequestState | null>(null);

/** The pending Look request survives route changes. JSON is the explicit save for now. */
export function MaterialRequestProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pick<MaterialRequestState, "request" | "picture">>({ request: null, picture: null });
  const setRequest = useCallback((request: MaterialRequest | null, picture: MaterialRequestPicture | null = null) => {
    // Keep the preview with its request when the user later changes or removes the upload.
    setPending({ request, picture: request ? picture : null });
  }, []);
  const value = useMemo(() => ({ ...pending, setRequest }), [pending, setRequest]);
  return <MaterialRequestContext.Provider value={value}>{children}</MaterialRequestContext.Provider>;
}

export function useMaterialRequest(): MaterialRequestState {
  const state = useContext(MaterialRequestContext);
  if (!state) throw new Error("useMaterialRequest needs MaterialRequestProvider.");
  return state;
}
