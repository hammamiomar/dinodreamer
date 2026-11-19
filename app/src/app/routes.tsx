// Application router. Every screen renders inside `Frame` so editor state and training runs
// persist across navigation. Library routes load their index in route loaders so Back restores scroll.

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

/** Redirect legacy routes in React so URL fragments are preserved (router loaders omit hashes). */
function LegacyRouteRedirect() {
  const { pathname, search, hash, state } = useLocation();
  return <Navigate replace to={`${canonicalPathname(pathname)}${search}${hash}`} state={state} />;
}

/** Redirect legacy root links carrying an Index query string to `/index`. */
function HomeRoute() {
  const { search, hash, state } = useLocation();
  if (hasAtlasQuery(new URLSearchParams(search))) {
    return <Navigate replace to={`/index${search}${hash}`} state={state} />;
  }
  return <HomePage />;
}

export const INDEX_ROUTE_ID = "index";

/** Load the cloud atlas index in parallel with the release manifest. */
export async function atlasLoader(): Promise<CloudAtlas> {
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
          { path: "/canvas", lazy: async () => ({ Component: (await import("../features/landing/canvas-page")).CanvasPage }) },
          {
            id: INDEX_ROUTE_ID,
            loader: atlasLoader,
            shouldRevalidate: () => false,
            element: <AtlasPage />,
            children: [
              { path: "/index", element: <></> },
              { path: "/index/basis/:id", element: <BasisGroupPanel home="/index" /> },
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
          {
            path: "/automata",
            element: <AutomataPage />,
            children: [{ index: true, element: <></> }, { path: "basis/:id", element: <BasisGroupPanel home="/automata" /> }],
          },
          { path: "/gallery", loader: ({ request }: LoaderFunctionArgs) => redirect(`/canvas${new URL(request.url).search}`) },
          // The Cloudflare Worker gates `/admin/*` behind owner authentication (`gallery/src/admin.ts`).
          {
            path: "/admin/automata",
            lazy: async () => ({ Component: (await import("../features/owner/owner-route")).OwnerAutomataRoute }),
            children: [{ index: true, element: <></> }, { path: "basis/:id", element: <BasisGroupPanel home="/admin/automata" /> }],
          },
          // Legacy owner paths redirect to the unified owner automata view.
          { path: "/admin", loader: () => redirect("/admin/automata") },
          { path: "/admin/materials/*", loader: () => redirect("/admin/automata") },
          { path: "/admin/research/*", loader: () => redirect("/admin/automata") },
          {
            path: "/train",
            lazy: async () => ({ Component: (await import("../grow/grow-page")).GrowPage }),
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/train" /> }],
          },
          {
            path: "/how",
            lazy: async () => ({ Component: (await import("../features/how/how-page")).HowPage }),
            children: [{ path: "basis/:id", element: <BasisGroupPanel home="/how" /> }],
          },
          { path: "/saved", loader: () => redirect(YOURS_PATH) },
          { path: "*", loader: notFoundLoader },
        ],
      },
    ],
  },
]);
