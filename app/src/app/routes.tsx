// The site map. Every screen renders inside the shared frame, so state held by
// the frame survives navigation between the library, the editor and the gallery.
// Library screens load their files in route loaders: a screen renders with its
// data, so Back can restore the scroll position at once.

import { createBrowserRouter, Navigate, redirect, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AtlasPage } from "../features/atlas/atlas-page";
import { hasAtlasQuery } from "../features/atlas/atlas-query";
import type { CloudAtlas } from "../library/atlas-cloud";
import { HomePage } from "../features/home/home-page";
import { AutomataPage } from "../features/automata/automata-page";
import { CreateScreen } from "./create-screen";
import { Frame, FrameError, FrameLoading } from "./frame";
import { SITE_WORDS } from "./site-words";
import { appLibrary, rootLoader, ROOT_ROUTE_ID } from "./library-session";
import { ASSET_BASE_URL } from "./config";
import { readCloudAtlasFiles } from "../library/library";
import { RouteError } from "./route-error";
import { YOURS_PATH } from "../replay/keep-material";
import { BasisGroupPanel } from "../features/look/basis-group-panel";
import { UploadedPicturePage } from "../features/look/picture-page";
import { canonicalPathname, LEGACY_PAGE_PATHS } from "./route-paths";

/** A component redirect keeps the fragment, which router loader requests omit. */
function LegacyRouteRedirect() {
  const { pathname, search, hash, state } = useLocation();
  return <Navigate replace to={`${canonicalPathname(pathname)}${search}${hash}`} state={state} />;
}

/** A legacy root link carrying an Index query opens the Index. */
function HomeRoute() {
  const { search, hash, state } = useLocation();
  if (hasAtlasQuery(new URLSearchParams(search))) {
    return <Navigate replace to={`/index${search}${hash}`} state={state} />;
  }
  return <HomePage />;
}

export const EXPLORE_ROUTE_ID = "explore";

/** One small index; each card loads its own compact cloud near the viewport. */
export async function atlasLoader(): Promise<CloudAtlas> {
  // The index is read beside the release manifest, not after it.
  const started = readCloudAtlasFiles(ASSET_BASE_URL);
  started.catch(() => {});
  return (await appLibrary()).cloudAtlas(started);
}


function notFoundLoader(): never {
  throw new Response(SITE_WORDS.frame.notFoundDetail, { status: 404 });
}

export const router = createBrowserRouter([
  {
    id: ROOT_ROUTE_ID,
    loader: rootLoader,
    // One release per session.
    shouldRevalidate: () => false,
    element: <Frame />,
    hydrateFallbackElement: <FrameLoading />,
    errorElement: <FrameError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { path: "/", element: <HomeRoute /> },
          ...LEGACY_PAGE_PATHS.map((path) => ({ path, element: <LegacyRouteRedirect /> })),
          // Load the Painter's landing page only when opened.
          { path: "/canvas", lazy: async () => ({ Component: (await import("../features/landing/canvas-page")).CanvasPage }) },
          {
            // The same index serves both views and every sort/filter choice.
            id: EXPLORE_ROUTE_ID,
            loader: atlasLoader,
            shouldRevalidate: () => false,
            element: <AtlasPage />,
            children: [
              // The Atlas alone: the layout renders it, so this leaf draws nothing of its own.
              { path: "/index", element: <></> },
              // A basis group in the panel over the Index (basis-group-panel.tsx); the Index stays as it was under it.
              { path: "/index/basis/:id", element: <BasisGroupPanel home="/index" /> },
              // A basis group's own address (a shared link) opens its panel over the Index: every block view is a panel.
              { path: "/basis/:id", element: <BasisGroupPanel home="/index" /> },
            ],
          },
          {
            path: "/picture",
            element: <UploadedPicturePage />,
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/picture" /> }],
          },
          {
            path: "/create",
            // The editor and its canvas load only when a visitor opens Create; a basis group opens in its panel over it.
            lazy: async () => {
              const { CreatePage } = await import("../features/editor/create-page");
              return {
                Component: () => (
                  <CreateScreen>
                    <CreatePage />
                  </CreateScreen>
                ),
              };
            },
            children: [{ index: true, element: <></> }, { path: "basis/:id", element: <BasisGroupPanel home="/create" /> }],
          },
          // The gallery of every basis group and its automata (features/automata/); the address's query names
          // the group and the automaton. The Canvas's pictures keep /gallery.
          {
            path: "/automata",
            element: <AutomataPage />,
            // A basis group in the panel over Automata; the stage keeps playing under it.
            children: [{ index: true, element: <></> }, { path: "basis/:id", element: <BasisGroupPanel home="/automata" /> }],
          },
          // Keep a legacy gallery link's entry when redirecting to the Painter.
          { path: "/gallery", loader: ({ request }: LoaderFunctionArgs) => redirect(`/canvas${new URL(request.url).search}`) },
          // The owner's view of the Automata page: the same wall and screen over every research run (features/owner/).
          // The Worker serves this page only after its owner check (gallery/src/admin.ts).
          {
            path: "/admin/automata",
            lazy: async () => ({ Component: (await import("../features/owner/owner-automata-page")).OwnerAutomataPage }),
            children: [{ index: true, element: <></> }, { path: "basis/:id", element: <BasisGroupPanel home="/admin/automata" /> }],
          },
          // The owner mode of the Playground: the same stage and shelf, under the frame, which reads the library.
          // The Worker serves this page only after its owner check (gallery/src/admin.ts).
          {
            path: "/admin/materials",
            lazy: async () => ({ Component: (await import("../features/owner/owner-materials-page")).OwnerMaterialsPage }),
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/admin/materials" /> }],
          },
          // The owner's research page: every research run, by basis group and condition (features/research/).
          // The Worker serves it only after its owner check (gallery/src/admin.ts).
          {
            path: "/admin/research",
            lazy: async () => ({ Component: (await import("../features/research/research-page")).ResearchPage }),
            children: [
              { index: true, lazy: async () => ({ Component: (await import("../features/research/research-overview")).ResearchOverview }) },
              { path: "group/:block", lazy: async () => ({ Component: (await import("../features/research/research-group")).ResearchGroup }) },
              { path: "run/:id", lazy: async () => ({ Component: (await import("../features/research/research-run")).ResearchRunView }) },
            ],
          },
          // Train trains on this device; its page loads only when a visitor opens it. A basis group opens in its panel over it.
          {
            path: "/train",
            lazy: async () => ({ Component: (await import("../grow/grow-page")).GrowPage }),
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/train" /> }],
          },
          // How it works, one screen, loaded only when a visitor opens it; a basis group opens in the panel over it.
          {
            path: "/how",
            lazy: async () => ({ Component: (await import("../features/how/how-page")).HowPage }),
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/how" /> }],
          },
          // Redirect legacy Saved links to the saved automata.
          { path: "/saved", loader: () => redirect(YOURS_PATH) },
          { path: "*", loader: notFoundLoader },
        ],
      },
    ],
  },
]);
