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

function createPictureReader(onProgress: (progress: PictureReaderProgress) => void) {
  return new ReaderClient(RELEASE_LOCATION, onProgress);
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
