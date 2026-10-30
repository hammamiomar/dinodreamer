import { useEffect, useMemo, useRef, useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
  Outlet,
  Navigate,
} from "react-router";
import type { atlasLoader } from "../../app/routes";
import { useLibrary } from "../../app/library-session";
import { useStarredBlocks } from "../../storage/starred-blocks";
import { Select } from "../../ui/select";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { useLoaded } from "../../ui/use-loaded";
import { PictureEntry } from "../look/picture-entry";
import { rememberAtlasPosition } from "./atlas-position";
import { ATLAS_TEXT } from "./atlas-text";
import { NEXT_PAGE_CARDS } from "./card-loading";
import { CloudBlockCard, cardLoader } from "./cloud-card";
import {
  CLOUD_CATEGORIES,
  CLOUD_ORDERS,
  CLOUD_PAGE_SIZE,
  cloudSearch,
  initialCloudSearch,
  parseCategory,
  parseCloudQuery,
  randomCloudPage,
  visibleClouds,
  type CloudQuery,
} from "./cloud-browser";
import "./cloud-atlas.css";
import { useMaterialIndex } from "../gallery/material-gallery";
import { materialCounts } from "../gallery/material-index";

/** The category filter's value for every block; parseCategory reads it as no category. */
const ANY_CATEGORY = "any";
const NO_CATEGORIES: ReadonlyMap<number, string> = new Map();

/** The route loads the index. Cards own their small, lazy record reads. */
export function AtlasPage() {
  const { entries } = useLoaderData<typeof atlasLoader>();
  const [search] = useSearchParams();
  const [initialRandom] = useState(Math.random);
  const initialSearch = initialCloudSearch(search, entries.length, initialRandom);
  const query = parseCloudQuery(search);
  const engine = search.get("engine");
  const navigate = useNavigate();
  const location = useLocation();
  const starred = useStarredBlocks();
  // The material status comes from the gallery's published index.
  const materialIndex = useMaterialIndex();
  const materials = useMemo(() => materialCounts(materialIndex.index), [materialIndex.index]);
  const library = useLibrary();
  // Every block's response category: one small file, read once per session. The filter and the
  // card labels use it; without the file (an older table) neither is shown.
  const categoryFile = useLoaded(library, () => library.provenanceCategories());
  const categories = categoryFile.status === "ready" ? (categoryFile.value.roles.patch ?? null) : null;
  const showCategories = categoryFile.status === "loading" || categories !== null || query.category !== null;
  const waitingForFilters = (query.category !== null && categoryFile.status === "loading")
    || (query.hasMaterial && materialIndex.status === "loading");
  let filterProblem: string | null = null;
  if (query.category !== null && categoryFile.status !== "loading" && categories === null) {
    filterProblem = categoryFile.status === "failed" ? categoryFile.message : ATLAS_TEXT.categoryUnavailable;
  }
  if (query.hasMaterial && materialIndex.status === "failed") filterProblem = materialIndex.message;
  const shown = useMemo(() => {
    if (waitingForFilters || filterProblem) return [];
    return visibleClouds(entries, query, materials, new Set(starred), categories ?? NO_CATEGORIES);
  }, [
    entries,
    query.order,
    query.category,
    query.hasMaterial,
    query.starred,
    query.search,
    materials,
    starred,
    categories,
    waitingForFilters,
    filterProblem,
  ]);
  const pages = Math.max(1, Math.ceil(shown.length / CLOUD_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const first = (page - 1) * CLOUD_PAGE_SIZE;
  const cards = shown.slice(first, first + CLOUD_PAGE_SIZE);
  // With no match, "No blocks match these choices." says it all: a count of nothing and two dead buttons would repeat it.
  const hasResults = shown.length > 0;
  const resultsLine = ATLAS_TEXT.results(first + 1, first + cards.length, shown.length);
  // The next page's first cards are read when the pagination comes within a screen of the view.
  const pagination = useRef<HTMLElement>(null);
  const nextBlocks = shown.slice(first + CLOUD_PAGE_SIZE, first + CLOUD_PAGE_SIZE + NEXT_PAGE_CARDS).map((entry) => entry.block).join(",");
  useEffect(() => {
    const element = pagination.current;
    if (!element || !nextBlocks) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        for (const block of nextBlocks.split(",").map(Number)) void cardLoader(library).load(block, "ahead").catch(() => {});
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [library, nextBlocks, initialSearch]);
  // A shared basis group's address (/basis/N) opens its panel over the Index with no position of its
  // own; it leaves the position the visitor left the Index at.
  const currentSearch = location.search;
  const onIndex = location.pathname.startsWith("/index");
  useEffect(() => {
    if (onIndex && initialSearch === null) rememberAtlasPosition(currentSearch);
  }, [onIndex, currentSearch, initialSearch]);
  // A new choice starts again at the first page.
  const choose = (change: Partial<CloudQuery>, replace = false) => {
    const next = { ...query, page: 1, ...change };
    navigate(`/index${cloudSearch(next, engine)}`, { replace });
  };
  const reset = () =>
    navigate(`/index${engine === "fake" ? "?engine=fake" : ""}`);
  // Random keeps the order and the filters; the page is in the URL, so Back returns to this one.
  const openRandomPage = () => {
    const randomPage = randomCloudPage(pages, page, Math.random());
    if (randomPage === null) return;
    navigate(`/index${cloudSearch({ ...query, page: randomPage }, engine)}`, { preventScrollReset: true });
  };
  if (location.pathname === "/index" && initialSearch !== null) {
    return <Navigate replace to={`/index${initialSearch}${location.hash}`} />;
  }
  return (
    <main className="cloud-atlas">
      <header className="cloud-atlas-heading">
        <h1 className="heading">{ATLAS_TEXT.title}</h1>
        <PictureEntry text={ATLAS_TEXT.upload} />
      </header>
      {/* Two control rows keep the cards in place when the result count changes. */}
      <div className="cloud-atlas-controls">
        <div className="atlas-control-row">
          <label className="atlas-search">
            <input
              className="input"
              inputMode="numeric"
              aria-label={ATLAS_TEXT.search}
              placeholder={ATLAS_TEXT.searchPlaceholder}
              value={query.search}
              onChange={(event) =>
                choose(
                  { search: event.target.value.replace(/\D/g, "").slice(0, 5) },
                  true,
                )
              }
            />
          </label>
          <label className="atlas-sort">
            <span className="label">{ATLAS_TEXT.sort}</span>
            <Select
              value={query.order}
              onChange={(event) =>
                choose({ order: event.target.value as CloudQuery["order"] })
              }
            >
              {CLOUD_ORDERS.map((order) => (
                <option key={order} value={order}>
                  {ATLAS_TEXT.orders[order]}
                </option>
              ))}
            </Select>
          </label>
          {showCategories && (
            <label className="atlas-category">
              <span className="label">{ATLAS_TEXT.category.label}</span>
              <Select
                value={query.category ?? ANY_CATEGORY}
                onChange={(event) => choose({ category: parseCategory(event.target.value) })}
              >
                <option value={ANY_CATEGORY}>{ATLAS_TEXT.category.any}</option>
                {CLOUD_CATEGORIES.map((word) => (
                  <option key={word} value={word}>
                    {ATLAS_TEXT.families[word]}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <div className="atlas-control-row">
          <label className="atlas-check">
            <input type="checkbox" checked={query.hasMaterial} onChange={(event) => choose({ hasMaterial: event.target.checked })} />
            {ATLAS_TEXT.hasMaterial}
          </label>
          <label className="atlas-check">
            <input type="checkbox" checked={query.starred} onChange={(event) => choose({ starred: event.target.checked })} />
            {ATLAS_TEXT.starred}
          </label>
          {hasResults && <span className="atlas-results">{resultsLine}</span>}
          {hasResults && (
            <button className="button atlas-random" disabled={pages === 1} onClick={openRandomPage}>
              {ATLAS_TEXT.random}
            </button>
          )}
        </div>
      </div>
      <div className="atlas-cloud-grid">
        {cards.map((entry) => (
          <CloudBlockCard
            key={entry.block}
            entry={entry}
            category={categories?.get(entry.block) ?? null}
            engine={engine}
          />
        ))}
      </div>
      {waitingForFilters && <div className="atlas-no-results"><LoadingIndicator>{ATLAS_TEXT.loadingFilters}</LoadingIndicator></div>}
      {shown.length === 0 && !waitingForFilters && (
        <div className="atlas-no-results">
          {filterProblem ? <p role="alert">{ATLAS_TEXT.filterFailed(filterProblem)}</p> : <p>{ATLAS_TEXT.emptyResults}</p>}
          <button className="link-control" onClick={reset}>
            {ATLAS_TEXT.reset}
          </button>
        </div>
      )}
      {hasResults && (
        <nav ref={pagination} className="atlas-pagination" aria-label={ATLAS_TEXT.pagination}>
          <button className="button" disabled={page === 1} onClick={() => choose({ page: page - 1 })}>
            ← {ATLAS_TEXT.previous}
          </button>
          <span>{resultsLine}</span>
          <button className="button" disabled={page === pages} onClick={() => choose({ page: page + 1 })}>
            {ATLAS_TEXT.next} →
          </button>
        </nav>
      )}
      <p className="atlas-cloud-footer">{ATLAS_TEXT.footer}</p>
      {/* The basis group panel over the Index, at /index/basis/:id (basis-group-panel.tsx). */}
      <Outlet />
    </main>
  );
}
