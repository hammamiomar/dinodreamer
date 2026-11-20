import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./app/routes";
import { installLazyImportRecovery } from "./app/stale-build";
import { MaterialRequestProvider } from "./app/material-request";
import { UploadedPictureProvider, type PictureReaderProgress } from "./app/uploaded-picture";
import { RELEASE_LOCATION } from "./app/config";
import { ReaderClient } from "./reader/client";
import "./styles.css";

// Recover failed lazy-route imports before rendering the router.
installLazyImportRecovery();

/**
 * The image analyzer; with `?engine=fake` or in the fixture release, How's recorded reading instead
 * (reader/recorded-reader.ts), loaded with the first reading so the app's entry does not carry it.
 */
function createPictureReader(onProgress: (progress: PictureReaderProgress) => void) {
  const fake = new URLSearchParams(window.location.search).get("engine") === "fake" || import.meta.env.MODE === "fixtures";
  if (!fake) return new ReaderClient(RELEASE_LOCATION, onProgress);
  return {
    readImage: async () => (await import("./reader/recorded-reader")).readRecordedPicture(),
    dispose: () => {},
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MaterialRequestProvider>
      <UploadedPictureProvider createReader={createPictureReader}>
        <RouterProvider router={router} />
      </UploadedPictureProvider>
    </MaterialRequestProvider>
  </StrictMode>,
);
